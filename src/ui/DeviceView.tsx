import { lazy, type PointerEvent as ReactPointerEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '../sim/boards';
import type { SimClock } from '../sim/clock';
import { canvasToNative, fitZoom, PanelRenderer, type ViewOptions } from '../sim/renderer';
import type { SketchRun } from '../sim/runner';
import { ErrorBoundary } from './ErrorBoundary';
import { useAnimationFrame } from './hooks';
import { WiringView } from './WiringView';

// three.js is big: load the 3D view on demand.
const Device3D = lazy(() => import('./Device3D').then((m) => ({ default: m.Device3D })));

export interface ViewState {
  /** '3d' = the device as a ghosted wireframe; 'flat' = just the glass, pixel-exact with zoom and grid;
   *  'wiring' = the bench as a wiring diagram, to build it for real. */
  mode?: '3d' | 'flat' | 'wiring';
  zoom: number | 'fit';
  grid: boolean;
  /** How the module is mounted. 'auto' turns it so whatever setRotation() the sketch chose reads upright. */
  rotation: number | 'auto';
}

interface Props {
  run: SketchRun;
  clock: SimClock;
  /** The board driving the output: the wiring view wires the bench to it. */
  board: Board;
  view: ViewState;
  error: string | null;
  /** A .lua file was dropped on the device. */
  onDropApp?(name: string, code: string): void;
  /** The 3D or Wiring view failed (no WebGL, its code didn't load, it threw): switch to flat. */
  onViewFailed?(): void;
  /** A note from Bench over the stage, until it's dismissed (a string: click it) or one of its actions is taken. */
  notice?: string | { text: string; actions: { label: string; run(): void }[] } | null;
  onDismiss?(): void;
}

interface Stats {
  fps: number;
  busPct: number;
  frameKB: number;
}

export function DeviceView({ run, clock, board, view, error, onDropApp, onViewFailed, notice, onDismiss }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState({ w: 600, h: 600 });
  const [stats, setStats] = useState<Stats>({ fps: 0, busPct: 0, frameKB: 0 });
  const [simTime, setSimTime] = useState(0);
  const device = run.device;
  const renderer = useMemo(() => new PanelRenderer(device), [device]);
  const threeD = (view.mode ?? '3d') === '3d';
  const wiringMode = view.mode === 'wiring';
  const [canvas3d, setCanvas3d] = useState<HTMLCanvasElement | null>(null);
  // The wiring diagram, once drawn (none when there's nothing to wire).
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  // Why the 3D or Wiring view gave way to the flat one, shown until either is picked again.
  const [viewNote, setViewNote] = useState<string | null>(null);
  useEffect(() => {
    if (threeD || wiringMode) setViewNote(null);
  }, [threeD, wiringMode]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mount = () => (view.rotation === 'auto' ? (4 - run.display.getRotation()) % 4 : view.rotation);
  const options: ViewOptions = {
    zoom: view.zoom === 'fit' ? fitZoom(device, mount(), avail.w - 16, avail.h - 16) : view.zoom,
    grid: view.grid,
    rotation: mount(),
  };
  const optionsRef = useRef({ options, mount });
  optionsRef.current = { options, mount };

  // A touch panel: press, drag and lift on the drawn glass.
  const touch = run.display.touch;
  const touchAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const { options: o, mount: m } = optionsRef.current;
    return canvasToNative(device, { ...o, rotation: m() }, e.clientX - r.left, e.clientY - r.top);
  };
  const touchHandlers = touch
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => {
          const p = touchAt(e);
          if (!p) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          touch.press(...p);
        },
        onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => {
          if (!touch.isPressed()) return;
          const p = touchAt(e);
          if (p) touch.move(...p);
        },
        onPointerUp: () => touch.release(),
        onPointerCancel: () => touch.release(),
      }
    : {};

  const draw = useCallback(() => {
    const { options: o, mount: m } = optionsRef.current;
    if (canvasRef.current && canvasRef.current.isConnected) renderer.draw(canvasRef.current, run.display.panel, clock.now(), { ...o, rotation: m() });
  }, [renderer, run, clock]);
  useAnimationFrame(draw);

  // Frame rate and bus load, measured in simulated time.
  useEffect(() => {
    setStats({ fps: 0, busPct: 0, frameKB: 0 });
    setSimTime(0);
    let prev = { t: clock.now(), ...run.display.stats };
    const id = setInterval(() => {
      const t = clock.now();
      const s = run.display.stats;
      const dt = t - prev.t;
      if (dt > 0) {
        const shows = s.shows - prev.shows;
        setStats({
          fps: (shows * 1000) / dt,
          busPct: (100 * (s.busMs - prev.busMs)) / dt,
          frameKB: shows ? (s.bytes - prev.bytes) / shows / 1024 : 0,
        });
      }
      setSimTime(run.millis());
      prev = { t, ...s };
    }, 500);
    return () => clearInterval(id);
  }, [run, clock]);

  const screenshot = () => {
    if (wiringMode) {
      if (!svg) return;
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      download(blob, `${device.id}-wiring.svg`);
      return;
    }
    (threeD ? canvas3d : canvasRef.current)?.toBlob((blob) => {
      if (blob) download(blob, `${device.id}-${run.sketch.name.replace(/\W+/g, '-').toLowerCase()}.png`);
    });
  };

  const busLabel =
    device.bus.kind === 'ws2812' ? `WS2812 ${device.bus.hz / 1e3} kHz` : device.bus.kind !== 'i2c' ? `${device.bus.kind.toUpperCase()} ${device.bus.hz / 1e6} MHz` : `I2C ${device.bus.hz / 1e3} kHz`;

  return (
    <section className="stage-wrap">
      <div
        className={`stage ${threeD ? 'stage-3d' : ''} ${wiringMode ? 'stage-wiring' : ''} ${dragOver ? 'drop-target' : ''}`}
        ref={stageRef}
        onDragOver={(e) => {
          if (!onDropApp) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void file.text().then((code) => onDropApp?.(file.name, code));
          else {
            const text = e.dataTransfer.getData('text/plain');
            if (text) onDropApp?.('Dropped app', text);
          }
        }}
      >
        {wiringMode ? (
          <ErrorBoundary
            key={`${device.id}|${board.id}`}
            onError={(err) => {
              setViewNote(`The wiring diagram didn't draw (${err instanceof Error ? err.message : String(err)}): showing the flat view. Pick Wiring to try again.`);
              onViewFailed?.();
            }}
          >
            <WiringView run={run} board={board} onSvg={setSvg} />
          </ErrorBoundary>
        ) : threeD ? (
          <ErrorBoundary
            onError={(err) => {
              setViewNote(/webgl/i.test(String(err)) ? "3D needs WebGL, which this browser didn't give Bench: showing the flat view." : "The 3D view stopped: showing the flat view. Pick 3D to try again.");
              onViewFailed?.();
            }}
          >
            <Suspense fallback={null}>
              <Device3D run={run} clock={clock} board={board} mount={() => optionsRef.current.mount()} onCanvas={setCanvas3d} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <canvas
            ref={canvasRef}
            className={`device-canvas ${touch ? 'touchable' : ''}`}
            title={touch ? `Touch screen (${device.touch?.controller}): click to tap, drag to swipe` : undefined}
            {...touchHandlers}
          />
        )}
        {notice && typeof notice === 'object' ? (
          <div className="stage-note">
            {notice.text}
            <span className="stage-note-actions">
              {notice.actions.map((a) => (
                <button key={a.label} className="link" onClick={a.run}>
                  {a.label}
                </button>
              ))}
            </span>
          </div>
        ) : notice ? (
          <button className="stage-note" onClick={onDismiss} title="Dismiss">
            {notice}
          </button>
        ) : (
          viewNote &&
          !threeD &&
          !wiringMode && (
            <button className="stage-note" onClick={() => setViewNote(null)} title="Dismiss">
              {viewNote}
            </button>
          )
        )}
        {error && (
          <div className="error-overlay">
            <strong>App crashed</strong>
            <pre>{error}</pre>
            <span>Fix the code and save; it restarts automatically.</span>
          </div>
        )}
      </div>
      <div className="statusbar">
        <span title="Frames pushed per second (simulated time)">{stats.fps.toFixed(0)} fps</span>
        <span title="Share of time the display bus is busy">bus {Math.min(100, stats.busPct).toFixed(0)}%</span>
        <span title="Average bytes per show()">{stats.frameKB.toFixed(1)} KB/frame</span>
        <span>{busLabel}</span>
        <span>
          {device.width}×{device.height}
          {threeD || wiringMode ? '' : ` @ ${options.zoom}×`}
        </span>
        <span title="millis()">t = {(simTime / 1000).toFixed(1)} s</span>
        <button
          className="link"
          onClick={screenshot}
          disabled={wiringMode && !svg}
          title={wiringMode ? (svg ? 'Save the wiring diagram as an SVG, to print or share' : 'Nothing to wire on this bench yet') : 'Save a PNG of the display'}
        >
          {wiringMode ? 'Save diagram' : 'Screenshot'}
        </button>
      </div>
    </section>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
