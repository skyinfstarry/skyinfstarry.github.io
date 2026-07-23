import { useEffect, useRef, useState } from 'react';
import type { SimEngine, UiStats, SatLiveInfo } from '../state/engine';
import type { SatRecord } from '../lib/tle';
import { GROUP_MAP } from '../lib/groups';

/* ---------------- 顶栏 ---------------- */

export function TopBar({ stats }: { stats: UiStats | null }) {
  const tleAge = stats?.tleAgeMin;
  const ageText =
    tleAge == null
      ? ''
      : tleAge < 1
        ? '刚刚'
        : tleAge < 60
          ? `${Math.round(tleAge)} 分钟前`
          : tleAge < 2880
            ? `${Math.round(tleAge / 60)} 小时前`
            : `${Math.round(tleAge / 1440)} 天前`;
  return (
    <header className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-3 p-4 md:p-5">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-[0.28em] text-slate-100 md:text-xl">
            ORBITLIVE
          </h1>
          <span
            className={`glass hidden rounded-full px-2.5 py-1 text-[10px] tracking-wider sm:inline-block ${
              stats?.dataStatus === 'live' ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            {stats?.dataStatus === 'live' ? '● CelesTrak 实时 TLE 已同步' : '● 内置 TLE 快照'}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] tracking-wider text-slate-400">
          {stats
            ? `${stats.visibleCount.toLocaleString()} / ${stats.total.toLocaleString()} 颗在轨目标 · TLE 更新于 ${ageText}`
            : '…'}
        </p>
      </div>
    </header>
  );
}

/* ---------------- 搜索 ---------------- */

export function SearchBox({
  engine,
  onSelect,
}: {
  engine: SimEngine | null;
  onSelect: (s: SatRecord) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SatRecord[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={boxRef} className="absolute right-4 top-4 z-30 w-60 md:right-5 md:top-5 md:w-72">
      <div className="glass flex items-center gap-2 rounded-xl px-3 py-2">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-cyan-300/70" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setResults(engine ? engine.search(e.target.value) : []);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜索卫星：ISS / STARLINK-…"
          className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
        />
        {q && (
          <button
            onClick={() => {
              setQ('');
              setResults([]);
            }}
            className="text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="glass mt-2 max-h-72 overflow-auto rounded-xl py-1">
          {results.map((s) => {
            const g = GROUP_MAP.get(s.group);
            return (
              <li key={s.norad}>
                <button
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-cyan-400/10"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: g?.color ?? '#fff', boxShadow: `0 0 6px ${g?.color}` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-200">{s.name}</span>
                    <span className="block text-[10px] text-slate-500">
                      #{s.norad} · {g?.label ?? s.group}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------- 分组面板 ---------------- */

export function GroupPanel({
  engine,
  groups,
}: {
  engine: SimEngine | null;
  groups: { key: string; visible: boolean; count: number }[];
}) {
  const [open, setOpen] = useState(true);
  return (
    <aside className="absolute right-4 top-1/2 z-20 -translate-y-1/2 md:right-5">
      <div className="glass w-44 rounded-2xl p-2.5 md:w-48">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-1.5 pb-1 text-[11px] tracking-[0.2em] text-slate-400"
        >
          星座分组
          <span className="text-slate-500">{open ? '−' : '+'}</span>
        </button>
        {open && (
          <ul className="space-y-0.5">
            {groups.map((g) => {
              const def = GROUP_MAP.get(g.key);
              if (!def) return null;
              return (
                <li key={g.key}>
                    <button
                    onClick={() => engine?.setGroupVisible(g.key, !g.visible)}
                    className={`group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-cyan-400/10 ${
                      g.visible ? '' : 'opacity-45'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: def.color,
                        boxShadow: g.visible ? `0 0 7px ${def.color}` : 'none',
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                      {def.label}
                      <span className="ml-1 text-[10px] text-slate-500">{def.en}</span>
                    </span>
                    <span className="font-num text-[10px] text-slate-500">
                      {g.count.toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

/* ---------------- 时间控制 ---------------- */

const SPEEDS = [1, 10, 60, 300, 1000];

export function TimeControls({
  engine,
  stats,
}: {
  engine: SimEngine | null;
  stats: UiStats | null;
}) {
  return (
    <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 md:bottom-5">
      <div className="glass flex items-center gap-1.5 rounded-2xl px-3 py-2 md:gap-2 md:px-4">
        <button
          onClick={() => {
            engine?.time.resetToNow();
            engine?.emitUi();
          }}
          title="回到当前真实时间"
          className="rounded-lg px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-cyan-400/15 hover:text-cyan-200"
        >
          ⏮ 现在
        </button>
        <button
          onClick={() => {
            engine?.time.toggle();
            engine?.emitUi();
          }}
          title={stats?.playing ? '暂停' : '播放'}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-200 transition-colors hover:bg-cyan-400/25"
        >
          {stats?.playing ? '❚❚' : '▶'}
        </button>
        <div className="mx-0.5 h-5 w-px bg-slate-600/50" />
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => {
              engine?.time.setSpeed(s);
              engine?.emitUi();
            }}
            className={`rounded-lg px-2 py-1 font-num text-[11px] transition-colors ${
              stats?.speed === s
                ? 'bg-cyan-400/20 text-cyan-200'
                : 'text-slate-400 hover:bg-cyan-400/10 hover:text-slate-200'
            }`}
          >
            {s}×
          </button>
        ))}
        <div className="mx-0.5 hidden h-5 w-px bg-slate-600/50 sm:block" />
        <span className="hidden min-w-[148px] text-center font-num text-[11px] tracking-wider text-slate-300 sm:block">
          {stats?.clock ?? ''}
        </span>
      </div>
    </div>
  );
}

/* ---------------- 选中卫星信息 ---------------- */

function Row({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11px] text-slate-500">{k}</span>
      <span className={`text-xs text-slate-200 ${mono ? 'font-num' : ''}`}>{v}</span>
    </div>
  );
}

export function InfoPanel({
  info,
  onClose,
}: {
  info: SatLiveInfo | null;
  onClose: () => void;
}) {
  if (!info) return null;
  const fmtLat = `${Math.abs(info.latDeg).toFixed(2)}° ${info.latDeg >= 0 ? 'N' : 'S'}`;
  const fmtLon = `${Math.abs(info.lonDeg).toFixed(2)}° ${info.lonDeg >= 0 ? 'E' : 'W'}`;
  return (
    <div className="glass absolute bottom-20 left-4 z-20 w-64 rounded-2xl p-4 md:bottom-5 md:left-5 md:w-72">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-100">{info.name}</h3>
          <p className="mt-0.5 text-[10px] tracking-wider text-slate-500">NORAD #{info.norad}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px]"
            style={{
              color: info.groupColor,
              background: `${info.groupColor}22`,
              border: `1px solid ${info.groupColor}44`,
            }}
          >
            {info.groupLabel}
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            ✕
          </button>
        </div>
      </div>
      <div className="mt-2 divide-y divide-slate-700/30">
        <Row k="高度" v={`${info.altKm.toFixed(1)} km`} />
        <Row k="速度" v={`${info.velKmS.toFixed(2)} km/s`} />
        <Row k="纬度 / 经度" v={`${fmtLat} / ${fmtLon}`} />
        <Row k="轨道周期" v={`${info.periodMin.toFixed(1)} min`} />
        <Row k="轨道倾角" v={`${info.inclDeg.toFixed(2)}°`} />
        <Row
          k="TLE 龄期"
          v={info.tleAgeDays < 1 ? `${(info.tleAgeDays * 24).toFixed(1)} 小时` : `${info.tleAgeDays.toFixed(1)} 天`}
        />
      </div>
      <p className="mt-2 text-[10px] leading-4 text-slate-500">
        轨道线与地面覆盖圈基于 SGP4 对整周期 220 点采样推算
      </p>
    </div>
  );
}

/* ---------------- 底部署名 ---------------- */

export function Footer() {
  return (
    <p className="pointer-events-none absolute bottom-4 right-4 z-10 hidden text-[10px] leading-4 text-slate-600 md:block">
      数据：CelesTrak NORAD GP · SGP4 本地推算 · 无 API key
    </p>
  );
}
