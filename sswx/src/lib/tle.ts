import { twoline2satrec } from 'satellite.js';
import type { SatRec } from 'satellite.js';

export interface SatRecord {
  rec: SatRec;
  name: string;
  norad: number;
  group: string; // group key
  groupIdx: number; // GROUPS 数组下标
  bufIdx: number; // 在所属组 position buffer 中的下标（元素下标，非字节）
}

// 解析 3 行 TLE 文本；若非 TLE 格式（如限频提示）返回 null
export function parseTleText(
  text: string,
  groupsMap: Record<string, string>,
  groupIndexOf: (key: string) => number,
): SatRecord[] | null {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const sats: SatRecord[] = [];
  let i = 0;
  let sawAny = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      sawAny = true;
      const tle1 = line;
      const tle2 = lines[i + 1];
      const name = (lines[i - 1] && !lines[i - 1].startsWith('1 ') ? lines[i - 1] : '').trim();
      try {
        const rec = twoline2satrec(tle1, tle2);
        if (rec && rec.no > 0) {
          const norad = parseInt(tle1.substring(2, 7), 10);
          const group = groupsMap[String(norad)] ?? 'other';
          sats.push({
            rec,
            name: name || `NORAD ${norad}`,
            norad,
            group,
            groupIdx: groupIndexOf(group),
            bufIdx: -1,
          });
        }
      } catch {
        /* 跳过坏记录 */
      }
      i += 2;
    } else {
      i += 1;
    }
  }
  if (!sawAny || sats.length < 100) return null;
  return sats;
}

const LIVE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle';

export async function fetchLiveTle(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(LIVE_URL, { signal, cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    // 校验：限频时 CelesTrak 返回提示文本而非 TLE
    if (!text.includes('\n1 ') && !text.startsWith('1 ')) return null;
    return text;
  } catch {
    return null;
  }
}
