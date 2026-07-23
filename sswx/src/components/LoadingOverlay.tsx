interface Props {
  progress: number; // 0-1
  label: string;
  done: boolean;
}

export function LoadingOverlay({ progress, label, done }: Props) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#020409] transition-opacity duration-700 ${
        done ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/10 blur-[120px]" />
      </div>
      <div className="relative mb-6 flex h-20 w-20 items-center justify-center">
        <div className="absolute inset-0 animate-spin rounded-full border border-cyan-300/20 border-t-cyan-300/80 [animation-duration:1.6s]" />
        <div className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_18px_4px_rgba(103,232,249,0.7)]" />
      </div>
      <h1 className="text-2xl font-semibold tracking-[0.35em] text-slate-100">
        ORBITLIVE
      </h1>
      <p className="mt-2 text-xs tracking-[0.3em] text-cyan-200/60">全球卫星实时追踪</p>
      <div className="mt-8 h-[3px] w-64 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-sky-500 transition-[width] duration-300"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="mt-3 h-4 text-xs text-slate-400">{label}</p>
      <p className="absolute bottom-8 px-6 text-center text-[11px] leading-5 text-slate-500">
        轨道数据：CelesTrak NORAD GP（TLE） · 推算：satellite.js SGP4（浏览器本地实时计算）
      </p>
    </div>
  );
}
