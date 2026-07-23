// 卫星分组定义：颜色 / 标签 / 点大小
export interface GroupDef {
  key: string;
  label: string;
  en: string;
  color: string;   // three.js 颜色
  size: number;    // 点基准尺寸（px）
}

export const GROUPS: GroupDef[] = [
  { key: 'starlink', label: '星链', en: 'Starlink', color: '#7dd3fc', size: 2.1 },
  { key: 'oneweb', label: '一网', en: 'OneWeb', color: '#c084fc', size: 2.3 },
  { key: 'stations', label: '空间站', en: 'Stations', color: '#ffffff', size: 5.2 },
  { key: 'gps', label: 'GPS', en: 'GPS', color: '#4ade80', size: 3.0 },
  { key: 'beidou', label: '北斗', en: 'BeiDou', color: '#facc15', size: 3.0 },
  { key: 'glonass', label: '格洛纳斯', en: 'GLONASS', color: '#fb923c', size: 3.0 },
  { key: 'galileo', label: '伽利略', en: 'Galileo', color: '#818cf8', size: 3.0 },
  { key: 'iridium', label: '铱星', en: 'Iridium', color: '#f472b6', size: 2.8 },
  { key: 'weather', label: '气象', en: 'Weather', color: '#2dd4bf', size: 3.2 },
  { key: 'other', label: '其他', en: 'Others', color: '#8ea2c0', size: 1.9 },
];

export const GROUP_MAP = new Map(GROUPS.map((g) => [g.key, g]));

export const EARTH_R_KM = 6371;
export const INV_R = 1 / EARTH_R_KM; // 场景单位 = 地球半径
