import { useEffect, useRef, useState } from 'react';
import { SimEngine } from '../state/engine';
import type { UiStats, SatLiveInfo } from '../state/engine';
import type { SatRecord } from '../lib/tle';
import { GlobeScene } from '../three/scene';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { TopBar, SearchBox, GroupPanel, TimeControls, InfoPanel, Footer } from '../components/Hud';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SimEngine | null>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const [engine, setEngine] = useState<SimEngine | null>(null);
  const [loading, setLoading] = useState({ p: 0, label: '初始化…' });
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<UiStats | null>(null);
  const [selInfo, setSelInfo] = useState<SatLiveInfo | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [groups, setGroups] = useState<{ key: string; visible: boolean; count: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const eng = new SimEngine();
    engineRef.current = eng;
    setEngine(eng);
    eng.events.onUiTick = (st, info) => {
      if (cancelled) return;
      setStats(st);
      setSelInfo(info);
    };
    eng.events.onGroupsChanged = (g) => {
      if (!cancelled) setGroups(g);
    };

    (async () => {
      try {
        await eng.init((p, label) => {
          if (!cancelled) setLoading({ p: p * 0.8, label });
        });
        if (cancelled || !canvasRef.current || !hostRef.current) return;
        const scene = new GlobeScene(canvasRef.current, eng, hostRef.current);
        sceneRef.current = scene;
        await scene.init((p, label) => {
          if (!cancelled) setLoading({ p: 0.8 + p * 0.2, label });
        });
        if (cancelled) {
          scene.dispose();
          return;
        }
        eng.emitUi();
        setReady(true);
        // 支持 ?sel=NORAD 直接选中（演示/分享）
        const selParam = new URLSearchParams(window.location.search).get('sel');
        if (selParam && eng.findByNorad(parseInt(selParam, 10))) {
          eng.select(parseInt(selParam, 10));
          eng.emitUi();
          scene.markOrbitDirty();
          setHasSelection(true);
        }
      } catch (e) {
        if (!cancelled) {
          setLoading({ p: 1, label: `加载失败：${e instanceof Error ? e.message : String(e)}` });
        }
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        eng.select(null);
        setHasSelection(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // 点击拾取（区分拖拽旋转）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    let downX = 0;
    let downY = 0;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const sat = sceneRef.current?.pick(e.clientX, e.clientY);
      if (sat) {
        setHasSelection(true);
        engineRef.current?.emitUi();
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [ready]);

  const handleSelect = (s: SatRecord) => {
    engineRef.current?.select(s.norad);
    engineRef.current?.emitUi();
    sceneRef.current?.markOrbitDirty();
    setHasSelection(true);
  };

  return (
    <div ref={hostRef} className="relative h-screen w-screen overflow-hidden bg-[#010208]">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      <LoadingOverlay progress={loading.p} label={loading.label} done={ready} />
      {ready && (
        <>
          <TopBar stats={stats} />
          <SearchBox engine={engine} onSelect={handleSelect} />
          <GroupPanel engine={engine} groups={groups} />
          <TimeControls engine={engine} stats={stats} />
          <InfoPanel
            info={hasSelection ? selInfo : null}
            onClose={() => {
              engineRef.current?.select(null);
              setHasSelection(false);
            }}
          />
          <Footer />
        </>
      )}
    </div>
  );
}
