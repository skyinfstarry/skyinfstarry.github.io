// 近似太阳方向（精度 ~0.01°，光照视觉足够）
// 返回场景坐标（ECEF 映射：three = (x, z, -y)）
export function sunDirection(date: Date, gmst: number): [number, number, number] {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = ((280.46 + 0.9856474 * n) % 360) * (Math.PI / 180);
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const lon = ra - gmst; // ECI → ECEF
  const x = Math.cos(dec) * Math.cos(lon);
  const y = Math.cos(dec) * Math.sin(lon);
  const z = Math.sin(dec);
  return [x, z, -y];
}
