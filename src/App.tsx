import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { session } from './resident/session';
import { appPrompt } from './resident/prompt';
import { remote } from './resident/remote';
import { folderWatch } from './resident/watch';
import { residentSketch } from './resident/sketch';
import { appHeader, residentApps } from './resident-apps';
import { type AppNeeds, appNeeds, misfits, outputCaps } from './resident/needs';
import { noteRunning, recoverFromFreeze } from './freeze';
import { boardsFor } from './sim/boards';
import { onBoard } from './sim/wiring';
import { SimClock } from './sim/clock';
import { boardBench, DEFAULT_PARTS, type PartSpec } from './sim/controls/bench';
import { benchApp } from './sim/generate';
import { MATRIX_SIZES, type Output, type OutputKind, RING_COUNTS, STRIP_COUNTS } from './sim/leds';
import { devices, outputDevice } from './sim/devices';
import { type LogLine, SketchRun } from './sim/runner';
import type { InputSpecs, Sketch } from './sim/sketch';
import { backToMyBench, keepShared, LONG_LINK, type Opened, openedNote, type Setup, shareLink } from './share';
import { About } from './ui/About';
import { Console } from './ui/Console';
import { Copy } from './ui/Copy';
import { DeviceInfo, type Fact } from './ui/DeviceInfo';
import { DeviceView, type ViewState } from './ui/DeviceView';
import { useClockState, usePersisted } from './ui/hooks';
import { InputPanel } from './ui/InputPanel';
import { Panel } from './ui/Panel';
import { CodePanel } from './ui/CodePanel';
import { RemotePanel } from './ui/RemotePanel';
import { ResidentPanel } from './ui/ResidentPanel';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
const TECH_LABEL = { lcd: 'LCD', amoled: 'AMOLED', oled: 'OLED', epaper: 'E-paper', led: 'LED' } as const;

const GROUPS = ['Your app', 'Bench examples', 'Resident examples'] as const;

/** One Lua app in the Sketch menu. */
interface Entry {
  id: string;
  name: string;
  group: (typeof GROUPS)[number];
  sketch: Sketch<InputSpecs>;
  code: string;
  /** What it needs from the output and its board (your own app runs on whatever is chosen). */
  needs?: AppNeeds;
}

/** The parts you put on the bench, kept in this browser (first visit: a starter set). */
function loadParts(): PartSpec[] {
  try {
    const parts: unknown = JSON.parse(localStorage.getItem('bench:parts') ?? 'null');
    return Array.isArray(parts) ? (parts as PartSpec[]) : DEFAULT_PARTS;
  } catch {
    return DEFAULT_PARTS;
  }
}
function saveParts(parts: PartSpec[]) {
  try {
    localStorage.setItem('bench:parts', JSON.stringify(parts));
  } catch {
    /* not persisted */
  }
}

/** Forget what was saved for a part taken off the bench: connections to it, and its place on each desk. */
function forgetPart(id: string) {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    for (const k of keys) {
      if (k.startsWith('bench:binding:') && localStorage.getItem(k)?.startsWith(`${id}:`)) localStorage.removeItem(k);
      if (k.startsWith('bench:desk:')) {
        const desk = JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>;
        if (id in desk) {
          delete desk[id];
          localStorage.setItem(k, JSON.stringify(desk));
        }
      }
    }
  } catch {
    /* nothing saved to forget */
  }
}

/** What the user connected each of an app's controls to, kept across reloads. */
function loadBinding(sketchId: string, control: string): string | null {
  try {
    return localStorage.getItem(`bench:binding:${sketchId}:${control}`);
  } catch {
    return null;
  }
}
function saveBinding(sketchId: string, control: string, source: string) {
  try {
    localStorage.setItem(`bench:binding:${sketchId}:${control}`, source);
  } catch {
    /* not persisted */
  }
}

const FIRST_APP = 'resident:porous-systems';
/** The app the page froze on last time, if it did: Bench starts on FIRST_APP instead (see freeze.ts). */
const frozeOn = recoverFromFreeze(FIRST_APP);

const bundled: Entry[] = residentApps.map((a) => ({
  id: `resident:${a.id}`,
  name: a.name,
  group: a.origin === 'resident' ? 'Resident examples' : 'Bench examples',
  sketch: residentSketch({ name: a.name, code: a.code, description: a.description || undefined }),
  code: a.code,
  needs: a.needs,
}));

/** `shared`: what a share link opened, until you keep it or go back (a string: why a link didn't open). */
export default function App({ shared = null }: { shared?: Opened | string | null }) {
  const clock = useMemo(() => new SimClock(), []);
  const { paused, speed } = useClockState(clock);
  const [sketchId, setSketchId] = usePersisted('sketch', FIRST_APP);
  const [deviceId, setDeviceId] = usePersisted('device', 'waveshare-esp32-c6-lcd-1.47');
  // The output: a display module, or an LED strip, ring or matrix (kept in this browser).
  const [outputKind, setOutputKind] = usePersisted<OutputKind>('output-kind', 'display');
  const [stripCount, setStripCount] = usePersisted('output-strip', 30);
  const [ringCount, setRingCount] = usePersisted('output-ring', 16);
  const [matrixSize, setMatrixSize] = usePersisted('output-matrix', '8x8');
  // The board driving each output, by output id (unset: the output's default board).
  const [boardChoice, setBoardChoice] = usePersisted<Record<string, string>>('boards', {});
  const [view, setView] = usePersisted<ViewState>('view', { zoom: 'fit', grid: true, rotation: 'auto' });
  const [restarts, setRestarts] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Resident: an app pushed over the relay, dropped on the device or run from the editor.
  useSyncExternalStore(session.subscribe, session.getVersion);
  const live = session.live;
  const liveEntry = useMemo<Entry | null>(
    () =>
      live
        ? {
            id: 'resident:live',
            name: `▶ ${live.name}`,
            group: 'Your app',
            // Its own first comment line describes it, unless whoever sent it gave a description.
            sketch: residentSketch({ ...live, description: live.description ?? (appHeader(live.code).description || undefined), live }),
            code: live.code,
          }
        : null,
    [live],
  );
  const lastLive = useRef(live);
  useEffect(() => {
    if (live && live !== lastLive.current) {
      setSketchId('resident:live');
      // An app that names its output (`-- @output matrix`) and arrives while another kind is chosen
      // switches Bench to it: an LED app pushed at a display would only crash on its first leds call.
      if (/^--\s*@output\s+/m.test(live.code)) {
        const want = appNeeds(live.code).output;
        setOutputKind((k) => (want === (k === 'ring' ? 'strip' : k) ? k : want));
      }
    }
    lastLive.current = live;
  }, [live, setSketchId, setOutputKind]);

  const output = useMemo((): Output => {
    if (outputKind === 'strip') return { kind: 'strip', count: stripCount };
    if (outputKind === 'ring') return { kind: 'ring', count: ringCount };
    if (outputKind === 'matrix') {
      const [w, h] = matrixSize.split('x').map(Number);
      return { kind: 'matrix', w, h };
    }
    return { kind: 'display', device: deviceId };
  }, [outputKind, deviceId, stripCount, ringCount, matrixSize]);
  const device = useMemo(() => outputDevice(output) ?? devices[0], [output]);

  // The board driving the output decides the libraries and memory an app gets.
  const boards = boardsFor(device);
  const board = boards.find((b) => b.id === boardChoice[device.id]) ?? boards[0];
  const caps = useMemo(() => outputCaps(device, board), [device, board]);

  // The App menu shows what this output and its board can run (see src/resident/needs.ts).
  const target = outputKind === 'ring' ? 'strip' : outputKind;
  const allEntries: Entry[] = [...(liveEntry ? [liveEntry] : []), ...bundled];
  const fitting = allEntries.filter((e) => !e.needs || misfits(e.needs, caps).length === 0);
  const entries = fitting.length ? fitting : allEntries;
  // The examples left out, with why: written for another output kind doesn't count, it's expected.
  const leftOut = allEntries
    .filter((e) => e.needs && e.needs.output === caps.output)
    .map((e) => ({ name: e.name, why: misfits(e.needs!, caps) }))
    .filter((e) => e.why.length);
  const entry = entries.find((s) => s.id === sketchId) ?? entries[0];
  // Your own app stays in the menu whatever it needs, but says when this output and board can't run it.
  const liveFit = useMemo(() => {
    if (!live) return { why: [], library: false };
    const needs = appNeeds(live.code);
    // A library the firmware doesn't have stops it on Bench too; the rest only a real board stops.
    return { why: misfits(needs, caps), library: needs.output === caps.output && needs.libraries.some((l) => !caps.libraries.includes(l)) };
  }, [live, caps]);

  // The bench: the board's own hardware plus your parts. It outlives app switches (a new board
  // brings its own built-ins), and every add or remove is saved in this browser.
  const bench = useMemo(() => {
    const b = boardBench(device, clock, loadParts());
    b.onEdit = saveParts;
    b.onRemove = forgetPart;
    return b;
  }, [device, clock]);

  // Why Bench didn't start the app it ran last, if the page froze on it (see freeze.ts).
  const [notice, setNotice] = useState(() => {
    if (!frozeOn) return null;
    const name = frozeOn === 'resident:live' ? session.live?.name : bundled.find((e) => e.id === frozeOn)?.name;
    return `Bench didn't start "${name ?? frozeOn}": the page froze while it ran last time. Pick it in the App menu to run it again.`;
  });
  useEffect(() => {
    if (sketchId !== FIRST_APP) setNotice(null);
  }, [sketchId]);
  // What a share link opened: said on every load until you go back to your bench or keep this one.
  const [shareNote, setShareNote] = useState(shared);

  const [run, setRun] = useState<SketchRun | null>(null);
  // A board with other drawing libraries restarts the app, as flashing that board would.
  useEffect(() => {
    const r = new SketchRun(entry.sketch, device, clock, {
      onLog: (line) => setLogs((l) => [...l.slice(-299), line]),
      onError: (err) => setError(err instanceof Error ? (err.stack ?? err.message) : String(err)),
      // Controls appear as the app declares them; each picks up the hardware chosen last time.
      bindingFor: (control) => loadBinding(entry.id, control),
    }, bench, caps.libraries);
    setRun(r);
    setLogs([]);
    setError(null);
    session.log = (level, text) => r.stopped || setLogs((l) => [...l.slice(-299), { t: r.millis(), text, level: level === 'info' ? 'log' : level }]);
    void r.start();
    noteRunning(entry.id);
    return () => {
      r.stop();
      noteRunning(null);
    };
  }, [entry.sketch, device, clock, bench, restarts, caps.libraries.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard → the app's controls (each knows its keys).
  useEffect(() => {
    if (!run) return;
    const handler = (down: boolean) => (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, select, textarea')) return;
      let handled = false;
      for (const control of run.controls) if (control.handleKey(e.code, down)) handled = true;
      if (handled) e.preventDefault();
    };
    const onDown = handler(true);
    const onUp = handler(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [run]);

  // Mirroring on a real device: it reads this run's controls, and a new run (another app, a
  // restart) is sent to the device too.
  const mirrorSource = useCallback(
    () => ({ controls: run?.controls ?? [], bench, buttons: { a: run?.inputs.a, b: run?.inputs.b }, gestures: session.host?.gestureCounts(), touches: session.host?.touchEvents() }),
    [run, bench],
  );
  useEffect(() => {
    if (run && remote.active) void remote.start({ name: entry.name.replace(/^▶ /, ''), code: entry.code }, mirrorSource, { display: { id: device.id, name: device.name }, tz: session.zone.name });
  }, [run, mirrorSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a share link carries: this output and board, your parts, the app's connections, and the app.
  const shareSetup = (): Setup => ({
    output,
    board: board.id,
    parts: bench.specs(),
    connections: Object.fromEntries((run?.controls ?? []).map((c) => [c.name, c.source])),
    app: entry.id === 'resident:live' && live ? { name: live.name, code: live.code, description: live.description } : { bundled: entry.id.replace(/^resident:/, '') },
  });

  const byTech = (['lcd', 'amoled', 'oled', 'epaper'] as const).map((tech) => ({ tech, list: devices.filter((d) => d.tech === tech) }));

  return (
    <div className="app">
      <header className="toolbar">
        <a className="brand" href="https://porous.systems" title="porous.systems">
          <span>porous.systems</span> Bench
        </a>

        <div className="group">
          <button onClick={() => setRestarts((n) => n + 1)} title="Reboot: run setup() again">
            ↻ Restart
          </button>
          <button onClick={() => (clock.paused = !paused)} className={paused ? 'active' : ''}>
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button onClick={() => clock.advance(1000 / 60)} disabled={!paused} title="Advance one 60 Hz frame">
            Step
          </button>
          <select value={speed} onChange={(e) => ((clock.speed = Number(e.target.value)), e.target.blur())} title="Simulation speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>

        <div className="group">
          <div className="segmented small-seg">
            <button className={(view.mode ?? '3d') === '3d' ? 'active' : ''} onClick={() => setView({ ...view, mode: '3d' })} title="The device as a 3D wireframe">
              3D
            </button>
            <button className={view.mode === 'flat' ? 'active' : ''} onClick={() => setView({ ...view, mode: 'flat' })} title="Just the glass, pixel-exact">
              Flat
            </button>
            <button className={view.mode === 'wiring' ? 'active' : ''} onClick={() => setView({ ...view, mode: 'wiring' })} title="The bench as a wiring diagram: which pin each part goes to on the real board">
              Wiring
            </button>
          </div>
          <select
            disabled={view.mode !== 'flat'}
            value={String(view.zoom)}
            onChange={(e) => (setView({ ...view, zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) }), e.target.blur())}
            title="Zoom"
          >
            <option value="fit">Fit</option>
            {[1, 2, 3, 4, 5, 6, 8].map((z) => (
              <option key={z} value={z}>
                {z}×
              </option>
            ))}
          </select>
          <button disabled={view.mode !== 'flat'} className={view.grid ? 'active' : ''} onClick={() => setView({ ...view, grid: !view.grid })} title="Show pixel grid">
            Grid
          </button>
          <button
            disabled={view.mode === 'wiring'}
            onClick={() => setView({ ...view, rotation: view.rotation === 'auto' ? 0 : view.rotation === 3 ? 'auto' : view.rotation + 1 })}
            title="How the module is mounted. Auto follows the sketch's setRotation()."
          >
            ⟳ {view.rotation === 'auto' ? 'Auto' : `${view.rotation * 90}°`}
          </button>
          <span className="toolbar-gap" />
          <Copy
            className=""
            label="Share"
            done={(link) => (link.length > LONG_LINK ? 'Long link copied' : 'Link copied')}
            title={`Copy a link that opens this setup in anyone's Bench: the output and board, your parts, the connections and the app (your own goes in as its code). A link over ${LONG_LINK.toLocaleString('en')} characters is too long for chat apps with a message limit, like Discord; email, Slack and iMessage take it whole.`}
            text={() => shareLink(shareSetup(), location.origin + location.pathname)}
          />
          <About />
        </div>
      </header>

      <main className="main">
        {/* Left: the code — which app, its source, the relay, its logs. */}
        <aside className="sidebar sidebar-info" aria-label="App and code">
          <Panel id="app" title="App">
            <select className="wide" value={entry.id} onChange={(e) => (setSketchId(e.target.value), e.target.blur())} aria-label="App">
              {GROUPS.filter((group) => entries.some((e) => e.group === group)).map((group) => (
                <optgroup key={group} label={group}>
                  {entries
                    .filter((e) => e.group === group)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </optgroup>
              ))}
              {leftOut.length > 0 && (
                <optgroup label="Won't run on this display and board">
                  {leftOut.map((e) => (
                    <option key={e.name} disabled>
                      {e.name} · {e.why.join(', ')}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {entry.sketch.description && <p className="sketch-desc">{entry.sketch.description}</p>}
            {entry.id === 'resident:live' && liveFit.why.length > 0 && (
              <p className="hint warn">
                It won't run on this {device.tech === 'led' ? 'output' : 'display'} and board as it is: {liveFit.why.join(', ')}.{' '}
                {liveFit.library
                  ? `Like a real ${board.name.replace(/ \(.*\)$/, '')}, Bench gives it only the libraries that board's firmware has.`
                  : `Bench runs it anyway, but a real ${board.name.replace(/ \(.*\)$/, '')} wouldn't.`}
              </p>
            )}

            <h3>New app</h3>
            <div className="app-actions">
              <button
                onClick={() =>
                  session.setLive({
                    name: 'My bench',
                    code: benchApp(target, bench.hardware(), caps.libraries),
                    source: 'editor',
                    description: 'Every input on your bench, shown live. Edit the code below to make it your own.',
                  })
                }
                title="Write a Lua app with a control for every part on your bench, connected and shown live: a starting point to edit"
              >
                Start from my bench
              </button>
              <Copy
                label="Copy a prompt for Claude"
                done="Prompt copied"
                title="Copy a prompt for Claude to write a new Lua app for this output and bench, with the right skills, ready to paste"
                text={() =>
                  appPrompt({
                    device,
                    board,
                    parts: bench.hardware(),
                    controls: (run?.controls ?? []).map((c) => ({ label: c.label, kind: c.kind, source: c.source })),
                    app: { id: entry.id, name: entry.name.replace(/^▶ /, ''), description: entry.sketch.description, code: entry.code, bundled: entry.id !== 'resident:live' },
                    deviceId: session.deviceId,
                    online: session.status === 'online',
                    watching: folderWatch.folder?.name ?? null,
                    skillInFolder: folderWatch.skill,
                  })
                }
              />
            </div>
          </Panel>
          <CodePanel code={entry.code} appName={entry.name.replace(/^▶ /, '')} />
          <ResidentPanel />
          {run && <RemotePanel device={device} board={board} app={{ name: entry.name.replace(/^▶ /, ''), code: entry.code }} source={mirrorSource} onShow={(id) => (setOutputKind('display'), setDeviceId(id))} tz={session.zone.name} />}
          <Console lines={logs} onClear={() => setLogs([])} />
        </aside>
        {run && (
          <DeviceView
            run={run}
            clock={clock}
            board={board}
            view={view}
            error={error}
            onDropApp={(name, code) => session.setLive({ name: name.replace(/\.lua$/, ''), code, source: 'file' })}
            onViewFailed={() => setView((v) => ({ ...v, mode: 'flat' }))}
            notice={
              shareNote && typeof shareNote === 'object'
                ? {
                    text: openedNote(shareNote),
                    actions: [
                      { label: 'Back to my bench', run: backToMyBench },
                      { label: 'Keep this one', run: () => (keepShared(), setShareNote(null)) },
                    ],
                  }
                : (shareNote ?? notice)
            }
            onDismiss={() => (shareNote ? setShareNote(null) : setNotice(null))}
          />
        )}
        {/* Right: the hardware — controls, the display, and the parts on the desk. */}
        <aside className="sidebar sidebar-controls" aria-label="Controls and hardware">
          {run && (
            <InputPanel
              run={run}
              output={
                <DeviceInfo
                  device={onBoard(device, board)}
                  facts={
                    board
                      ? [
                          ...(boards.length === 1 ? ([['board', board.name.replace(/ \(on the board\)$/, ', built in')]] as Fact[]) : []),
                          ['libraries', caps.libraries.join(', '), board.note],
                          ['app memory', board.appRamKb === undefined ? 'not measured' : board.appRamKb >= 1024 ? `${board.appRamKb / 1024} MB PSRAM` : `~${board.appRamKb} KB`, board.note],
                        ]
                      : []
                  }
                >
                  <div className="output-pick">
                    <select className="wide" value={outputKind} onChange={(e) => (setOutputKind(e.target.value as OutputKind), e.target.blur())} aria-label="Output">
                      <option value="display">Display</option>
                      <option value="strip">LED strip</option>
                      <option value="ring">LED ring</option>
                      <option value="matrix">LED matrix</option>
                    </select>
                    {outputKind === 'display' && (
                      <select className="wide" value={device.id} onChange={(e) => (setDeviceId(e.target.value), e.target.blur())} aria-label="Display">
                        {byTech.map(({ tech, list }) => (
                          <optgroup key={tech} label={TECH_LABEL[tech]}>
                            {list.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                    {outputKind === 'strip' && (
                      <select className="wide" value={stripCount} onChange={(e) => (setStripCount(Number(e.target.value)), e.target.blur())} aria-label="LEDs on the strip">
                        {STRIP_COUNTS.map((n) => (
                          <option key={n} value={n}>
                            {n} LEDs
                          </option>
                        ))}
                      </select>
                    )}
                    {outputKind === 'ring' && (
                      <select className="wide" value={ringCount} onChange={(e) => (setRingCount(Number(e.target.value)), e.target.blur())} aria-label="LEDs on the ring">
                        {RING_COUNTS.map((n) => (
                          <option key={n} value={n}>
                            {n} LEDs
                          </option>
                        ))}
                      </select>
                    )}
                    {outputKind === 'matrix' && (
                      <select className="wide" value={matrixSize} onChange={(e) => (setMatrixSize(e.target.value), e.target.blur())} aria-label="Matrix size">
                        {MATRIX_SIZES.map(([w, h]) => (
                          <option key={`${w}x${h}`} value={`${w}x${h}`}>
                            {w} × {h}
                          </option>
                        ))}
                      </select>
                    )}
                    {boards.length > 1 ? (
                      <select
                        className="wide"
                        value={board.id}
                        onChange={(e) => (setBoardChoice({ ...boardChoice, [device.id]: e.target.value }), e.target.blur())}
                        aria-label="Board"
                        title={board.note}
                      >
                        {boards.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </DeviceInfo>
              }
              onBind={(control, source) => {
                control.bind(source);
                saveBinding(entry.id, control.name, source);
              }}
            />
          )}
        </aside>
      </main>
    </div>
  );
}
