import { propagate, gstime, eciToGeodetic } from 'satellite.js';
import { GROUPS, GROUP_MAP, INV_R, EARTH_R_KM } from '../lib/groups';
import type { GroupDef } from '../lib/groups';
import { parseTleText, fetchLiveTle } from '../lib/tle';
import type { SatRecord } from '../lib/tle';
import { TimeEngine } from '../lib/time';

export interface GroupRuntime {
  def: GroupDef;
  positions: Float32Array;
  sats: SatRecord[];
  visible: boolean;
  alive: number;
}

export interface UiStats {
  clock: string;
  speed: number;
  playing: boolean;
  total: number;
  visibleCount: number;
  tleAgeMin: number | null;
  dataStatus: 'snapshot' | 'live' | 'snapshot-stale';
}

export interface SatLiveInfo {
  name: string;
  norad: number;
  group: string;
  groupLabel: string;
  groupColor: string;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  velKmS: number;
  periodMin: number;
  inclDeg: number;
  tleAgeDays: number;
}

export interface EngineEvents {
  onUiTick?: (stats: UiStats, selInfo: SatLiveInfo | null) => void;
  onGroupsChanged?: (groups: { key: string; visible: boolean; count: number }[]) => void;
  onDataStatus?: (status: UiStats['dataStatus']) => void;
  onRebuilt?: () => void; // 卫星集合热更新后通知 scene 重建点云
}

const JD_UNIX_EPOCH = 2440587.5;

type Vec = { x: number; y: number; z: number };

export class SimEngine {
  time = new TimeEngine();
  groups: GroupRuntime[] = [];
  totalSats = 0;
  dataStatus: UiStats['dataStatus'] = 'snapshot';
  selected: SatRecord | null = null;
  events: EngineEvents = {};

  private allSats: SatRecord[] = [];
  private cursor = 0;
  private groupsMap: Record<string, string> = {};
  private tleEpochMs = Date.now(); // TLE 数据抓取/同步时间
  private liveAbort: AbortController | null = null;

  get groupIndexOf() {
    return (key: string) => {
      const idx = GROUPS.findIndex((g) => g.key === key);
      return idx >= 0 ? idx : GROUPS.length - 1;
    };
  }

  /** 从快照初始化（可分块让出主线程，onProgress 0-1） */
  async init(onProgress?: (p: number, label: string) => void) {
    onProgress?.(0.05, '正在加载 TLE 快照…');
    const [tleRes, groupsRes, metaRes] = await Promise.all([
      fetch('./data/tle-active.txt'),
      fetch('./data/groups.json'),
      fetch('./data/meta.json').catch(() => null),
    ]);
    const text = await tleRes.text();
    this.groupsMap = await groupsRes.json();
    if (metaRes?.ok) {
      const meta = await metaRes.json();
      if (meta?.fetchedAt) this.tleEpochMs = new Date(meta.fetchedAt).getTime();
    }
    onProgress?.(0.35, `解析 ${(text.length / 1024 / 1024).toFixed(1)} MB 轨道根数…`);
    await new Promise((r) => setTimeout(r, 30)); // 让 UI 渲染一帧
    const sats = parseTleText(text, this.groupsMap, this.groupIndexOf);
    if (!sats) throw new Error('TLE 快照解析失败');
    onProgress?.(0.7, `构建 ${sats.length.toLocaleString()} 颗卫星轨道模型…`);
    await new Promise((r) => setTimeout(r, 30));
    this.buildGroups(sats);
    this.dataStatus = 'snapshot';
    this.events.onDataStatus?.(this.dataStatus);
    onProgress?.(0.95, '即将进入轨道…');
    // 后台异步同步最新 TLE
    void this.syncLive();
  }

  /** 在线拉取 CelesTrak 最新 TLE 并热替换 */
  async syncLive() {
    this.liveAbort?.abort();
    this.liveAbort = new AbortController();
    const text = await fetchLiveTle(this.liveAbort.signal);
    if (!text) {
      if (this.dataStatus === 'snapshot') {
        this.dataStatus = 'snapshot-stale';
        this.events.onDataStatus?.(this.dataStatus);
      }
      return;
    }
    const sats = parseTleText(text, this.groupsMap, this.groupIndexOf);
    if (!sats) return;
    this.buildGroups(sats);
    this.tleEpochMs = Date.now();
    this.dataStatus = 'live';
    this.events.onDataStatus?.(this.dataStatus);
    this.events.onRebuilt?.();
  }

  private buildGroups(sats: SatRecord[]) {
    const buckets = new Map<string, SatRecord[]>();
    for (const g of GROUPS) buckets.set(g.key, []);
    for (const s of sats) {
      const b = buckets.get(s.group) ?? buckets.get('other')!;
      s.bufIdx = b.length * 3;
      b.push(s);
    }
    const prevVisible = new Map(this.groups.map((g) => [g.def.key, g.visible]));
    this.groups = GROUPS.map((def) => {
      const arr = buckets.get(def.key) ?? [];
      return {
        def,
        positions: new Float32Array(arr.length * 3),
        sats: arr,
        visible: prevVisible.get(def.key) ?? true,
        alive: arr.length,
      };
    });
    this.allSats = sats;
    this.totalSats = sats.length;
    this.cursor = 0;
    // 选中对象若仍存在则保留引用一致的新记录
    if (this.selected) {
      const found = this.findByNorad(this.selected.norad);
      this.selected = found;
    }
    this.emitGroups();
  }

  /** 每帧推进一个时间切片：约 1/6 的卫星完成 SGP4 推算（圆轮转） */
  propagateSlice(date: Date) {
    const N = this.allSats.length;
    if (!N) return;
    const slice = Math.ceil(N / 6);
    const g = gstime(date);
    const cosG = Math.cos(g);
    const sinG = Math.sin(g);
    for (let k = 0; k < slice; k++) {
      const s = this.allSats[this.cursor];
      this.cursor = (this.cursor + 1) % N;
      const grp = this.groups[s.groupIdx];
      const buf = grp.positions;
      let ok = false;
      try {
        const pv = propagate(s.rec, date);
        const p = pv?.position as Vec | false | undefined;
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
          const xE = cosG * p.x + sinG * p.y; // ECI → ECEF
          const yE = -sinG * p.x + cosG * p.y;
          buf[s.bufIdx] = xE * INV_R;
          buf[s.bufIdx + 1] = p.z * INV_R;
          buf[s.bufIdx + 2] = -yE * INV_R;
          ok = true;
        }
      } catch {
        /* 衰变等异常 */
      }
      if (!ok) {
        buf[s.bufIdx] = 0;
        buf[s.bufIdx + 1] = -1e5; // 藏到视野外
        buf[s.bufIdx + 2] = 0;
      }
    }
    return g;
  }

  /** 精确推算单颗卫星当前场景坐标（ECEF 映射） */
  propagateOne(s: SatRecord, date: Date): { x: number; y: number; z: number } | null {
    try {
      const pv = propagate(s.rec, date);
      const p = pv?.position as Vec | false | undefined;
      if (!p || !Number.isFinite(p.x)) return null;
      const g = gstime(date);
      const cosG = Math.cos(g);
      const sinG = Math.sin(g);
      return {
        x: (cosG * p.x + sinG * p.y) * INV_R,
        y: p.z * INV_R,
        z: (-(-sinG * p.x + cosG * p.y)) * INV_R,
      };
    } catch {
      return null;
    }
  }

  getLiveInfo(s: SatRecord, date: Date): SatLiveInfo | null {
    try {
      const pv = propagate(s.rec, date);
      const p = pv?.position as Vec | false | undefined;
      const v = pv?.velocity as Vec | false | undefined;
      if (!p || !v) return null;
      const g = gstime(date);
      const geo = eciToGeodetic(p as never, g);
      const vel = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      const epochMs = (s.rec.jdsatepoch - JD_UNIX_EPOCH) * 86400000;
      return {
        name: s.name,
        norad: s.norad,
        group: s.group,
        groupLabel: GROUP_MAP.get(s.group)?.label ?? s.group,
        groupColor: GROUP_MAP.get(s.group)?.color ?? '#fff',
        latDeg: (geo.latitude * 180) / Math.PI,
        lonDeg: (geo.longitude * 180) / Math.PI,
        altKm: geo.height,
        velKmS: vel,
        periodMin: (2 * Math.PI) / s.rec.no,
        inclDeg: (s.rec.inclo * 180) / Math.PI,
        tleAgeDays: (Date.now() - epochMs) / 86400000,
      };
    } catch {
      return null;
    }
  }

  findByNorad(norad: number): SatRecord | null {
    for (const g of this.groups) {
      // 组内通常有序，直接线性找（组最大 1 万，仅选中时调用）
      const hit = g.sats.find((s) => s.norad === norad);
      if (hit) return hit;
    }
    return null;
  }

  search(q: string, limit = 9): SatRecord[] {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const starts: SatRecord[] = [];
    const contains: SatRecord[] = [];
    for (const s of this.allSats) {
      const n = s.name.toLowerCase();
      if (n.startsWith(query)) starts.push(s);
      else if (n.includes(query)) contains.push(s);
      if (starts.length >= limit) break;
    }
    return [...starts, ...contains].slice(0, limit);
  }

  select(norad: number | null) {
    this.selected = norad == null ? null : this.findByNorad(norad);
  }

  setGroupVisible(key: string, visible: boolean) {
    const g = this.groups.find((x) => x.def.key === key);
    if (g) {
      g.visible = visible;
      this.emitGroups();
    }
  }

  private emitGroups() {
    this.events.onGroupsChanged?.(
      this.groups.map((g) => ({ key: g.def.key, visible: g.visible, count: g.sats.length })),
    );
  }

  emitUi() {
    const now = this.time.now();
    const visibleCount = this.groups.reduce(
      (acc, g) => acc + (g.visible ? g.sats.length : 0),
      0,
    );
    const stats: UiStats = {
      clock: now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      speed: this.time.speed,
      playing: this.time.playing,
      total: this.totalSats,
      visibleCount,
      tleAgeMin: (Date.now() - this.tleEpochMs) / 60000,
      dataStatus: this.dataStatus,
    };
    const selInfo = this.selected ? this.getLiveInfo(this.selected, now) : null;
    this.events.onUiTick?.(stats, selInfo);
  }
}

export { EARTH_R_KM };
