import { LuaFactory } from 'wasmoon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResidentHost, type ResidentBoard } from '../src/resident/host';
import { RemoteMirror, remoteApp, SnapshotReader } from '../src/resident/remote';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { Bench, DEFAULT_PARTS } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { Button } from '../src/sim/inputs/button';
import type { Knob } from '../src/sim/inputs/knob';
import type { Pir } from '../src/sim/inputs/pir';

const factory = new LuaFactory();

/** A real Resident device, as far as the shim can tell: none of Bench's drivers. */
const FIRMWARE = 'dial, trigger, light, pir, climate, touch, ld2410 = nil, nil, nil, nil, nil, nil, nil\n';

/** `wrap: false` runs the app as Bench itself does, without the mirror's shim. */
async function device(app: string, firmware = FIRMWARE, displayId = 'waveshare-esp32-c6-lcd-1.47', wrap = true) {
  const clock = new SimClock();
  clock.paused = true;
  const display = new Display(findDevice(displayId)!, clock);
  display.setRotation(display.profile.firmwareRotation ?? 0); // as Bench's sketch does
  const logs: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/London'),
    buttons: [new Button({}, clock), new Button({}, clock)],
    store: new AppStore('remote-test', false),
    log: (level, text) => logs.push(level === 'info' ? text : `${level}: ${text}`),
    telemetry: () => {},
    publish: () => 'sent',
  };
  const { host, error } = await ResidentHost.boot(factory, board, { code: wrap ? firmware + remoteApp(app) : app });
  const run = async (ms: number) => {
    for (let i = 0; i < ms; i += 10) {
      clock.advance(10);
      host.step();
      // Showing a frame takes sim time (the bus transfer): run the clock until it's done.
      let done = false;
      void host.settle().then(() => (done = true));
      for (let k = 0; k < 500 && !done; k++) {
        clock.advance(1);
        await Promise.resolve();
      }
    }
  };
  return { host, error, logs, run, board, display, clock };
}

const send = (host: ResidentHost, data: unknown) => host.queue({ name: 'bench', data: data as Record<string, unknown>, from: 'bench', channel: 'app' });

describe('remote mirror', () => {
  it("drives a real device's dial, trigger and sensors from Bench's updates", async () => {
    const t = await device(`
      local speed = dial.new("speed", { start = 3 })
      local go = trigger.new("go")
      function on_tick(ctx)
        local d = speed:delta()
        if d ~= 0 or go:was_pressed() then log.info("tick", speed:value(), d, tostring(pir.motion())) end
      end
      function on_event(ctx, e) log.info("event", e.name, e.channel, tostring(e.data.name or e.data.index or e.data.moving)) end`);
    expect(t.error).toBeUndefined();
    send(t.host, { d: { speed: [3, 0.3, 0] }, t: { go: [0, 0, 0] }, s: { pir: { motion: false } }, g: [[0, 0, 0], [0, 0, 0]] });
    await t.run(150);
    expect(t.logs).toEqual([]); // the first update is a baseline: nothing fires
    send(t.host, { d: { speed: [5, 0.5, 2] }, t: { go: [1, 1, 0] }, s: { pir: { motion: true } }, g: [[0, 0, 0], [0, 0, 0]] });
    await t.run(150);
    expect(t.logs).toContain('event\tdial\tdriver\tspeed');
    expect(t.logs).toContain('event\ttrigger\tdriver\tgo');
    expect(t.logs).toContain('event\tmotion\tdriver\ttrue');
    expect(t.logs).toContain('tick\t5\t2\ttrue');
    t.logs.length = 0;
    send(t.host, { d: { speed: [5, 0.5, 2] }, t: { go: [1, 1, 0] }, s: { pir: { motion: true } }, g: [[1, 0, 0], [0, 0, 0]] });
    await t.run(150);
    expect(t.logs).toContain('event\ttap\tdriver\t0'); // Bench's button A: a tap on the device
  });

  it("replays Bench's taps and holds, and lets the board's own keys through, counted with them", async () => {
    const t = await device(`
      function on_event(ctx, e)
        if e.name == "tap" then log.info("tap", e.data.index, button.press_count()) end
        if e.name == "hold" then log.info("hold", e.data.index, tostring(e.data.held)) end
      end`);
    expect(t.error).toBeUndefined();
    const g = (a: number[], b: number[]) => send(t.host, { d: {}, t: {}, s: {}, g: [a, b] });
    g([0, 0, 0], [0, 0, 0]); // baseline
    await t.run(50);
    g([2, 0, 0], [0, 1, 0]); // two taps on A; B held down
    await t.run(50);
    g([2, 0, 0], [0, 1, 1]); // B let go
    await t.run(50);
    expect(t.logs).toEqual(['tap\t0\t1', 'tap\t0\t2', 'hold\t1\ttrue', 'hold\t1\tfalse']);
    // The board's own key: a press on the real board always reaches the app, its tap counted after Bench's.
    t.logs.length = 0;
    t.host.queue({ name: 'tap', channel: 'driver', data: { index: 0, count: 1 } });
    t.host.queue({ name: 'hold', channel: 'driver', data: { index: 0, held: true } });
    await t.run(50);
    expect(t.logs).toEqual(['tap\t0\t3', 'hold\t0\ttrue']);
  });

  it("leaves the device's own events to the app", async () => {
    const t = await device(`function on_event(ctx, e) log.info("got", e.name) end`);
    t.host.queue({ name: 'note', data: {}, from: 'phone', channel: 'app' });
    await t.run(100);
    expect(t.logs).toEqual(['got\tnote']);
  });

  it("raises the radar's presence events on the board, gives the IMU's rotation, and keeps a reading an update left out", async () => {
    const t = await device(`
      ld2410.begin()
      function on_tick(ctx)
        local r = ld2410.read()
        local _, gy = imu.gyro()
        log.info("tick", tostring(r.moving), r.distance_cm, gy)
      end
      function on_event(ctx, e) if e.name == "presence" then log.info("presence", tostring(e.data.moving), e.data.distance_cm) end end`,
      `imu = nil\n${FIRMWARE}`);
    expect(t.error).toBeUndefined();
    const radar = (moving: boolean, cm: number) => ({ connected: true, moving, still: false, distance_cm: cm, moving_cm: cm, moving_energy: 50, still_cm: 0, still_energy: 0, out: moving });
    send(t.host, { s: { radar: radar(false, 0), imu: [0, 0, 1, 0, 0, 0] } });
    await t.run(100);
    expect(t.logs.filter((l) => l.startsWith('presence'))).toEqual([]); // the first reading is where it starts
    send(t.host, { s: { radar: radar(true, 120), imu: [0, 0, 1, 0, 12.5, 0] } });
    await t.run(100);
    expect(t.logs).toContain('presence\ttrue\t120');
    expect(t.logs.at(-1)).toBe('tick\ttrue\t120\t12.5');
    // An update too big for the relay goes without the radar: the board keeps the last reading.
    t.logs.length = 0;
    send(t.host, { s: { imu: [0, 0, 1, 0, 0, 0] } });
    await t.run(100);
    expect(t.logs.at(-1)).toBe('tick\ttrue\t120\t0');
    expect(t.logs.filter((l) => l.startsWith('presence'))).toEqual([]);
  });

  it('sends only the stand-ins the app names', () => {
    const plain = remoteApp('function init(ctx) log.info("hi") end');
    for (const name of ['dial', 'trigger', 'light', 'pir', 'climate', 'touch', 'ld2410', 'imu', 'buzzer']) {
      expect(plain, name).not.toContain(`if not ${name} then`);
    }
    expect(plain).toContain('__bench_apply'); // Bench's buttons still arrive as taps
    const knob = remoteApp('local d = dial.new("speed")\nfunction on_tick(ctx) log.info(pir.motion()) end');
    expect(knob).toContain('if not dial then');
    expect(knob).toContain('if not pir then');
    expect(knob).not.toContain('if not trigger then');
  });

  it('gives a board without a buzzer a silent one', async () => {
    const t = await device(`function init(ctx) buzzer.beep(440, 50) buzzer.tone(880) buzzer.stop() log.info("beeped") end`, `buzzer = nil\n${FIRMWARE}`);
    expect(t.error).toBeUndefined();
    await t.run(50);
    expect(t.logs).toEqual(['beeped']);
  });

  it('counts every quick tap on Bench\'s e-paper, refreshing in the background as the board does', async () => {
    const t = await device(
      `local g = lgfx.bind("main")
      local taps = 0
      local function draw() g:fillScreen(0xFFFFFF) g:setCursor(4, 4) g:print("taps " .. taps) g:flip() end
      function init(ctx) draw() end
      function on_event(ctx, e) if e.name == "tap" then taps = taps + 1 draw() log.info("taps", taps) end end`,
      FIRMWARE,
      'waveshare-epd-2.13-v4',
      false,
    );
    expect(t.error).toBeUndefined();
    const a = t.board.buttons[0] as Button;
    await t.run(50); // the first (full, 2 s) refresh is under way
    expect(t.display.refreshing()).toBe(true);
    // Five quick clicks, faster than the panel refreshes, some between two passes of the loop.
    for (let i = 0; i < 5; i++) {
      a.setDown(true);
      a.setDown(false);
      if (i % 2) await t.run(20);
    }
    await t.run(50);
    expect(t.logs.at(-1)).toBe('taps\t5'); // none lost, even while the panel was BUSY
    expect(t.display.stats.shows).toBeLessThan(6); // the frames in between were never refreshed
  });

  it('turns presses on the touch panel into touch events for apps, a quick one into a tap', async () => {
    const t = await device(
      `function on_event(ctx, e)
        if e.name:sub(1, 6) == "touch_" then log.info(e.name, e.data.x, e.data.y, tostring(touchscreen.pressed())) end
      end`,
      FIRMWARE,
      'waveshare-esp32-s3-touch-amoled-1.32',
      false,
    );
    expect(t.error).toBeUndefined();
    const panel = t.display.touch!;
    panel.press(100, 120);
    panel.release();
    await t.run(30);
    expect(t.logs).toEqual(['touch_down\t100\t120\tfalse', 'touch_up\t100\t120\tfalse', 'touch_tap\t100\t120\tfalse']);
    // A drag: its moves within one pass arrive as one, and it isn't a tap.
    t.logs.length = 0;
    panel.press(50, 50);
    panel.move(60, 50);
    panel.move(90, 60);
    await t.run(30);
    panel.release();
    await t.run(30);
    expect(t.logs).toEqual(['touch_down\t50\t50\ttrue', 'touch_move\t90\t60\ttrue', 'touch_up\t90\t60\tfalse']);
    // Held past 500 ms: not a tap either.
    t.logs.length = 0;
    panel.press(10, 10);
    await t.run(600);
    panel.release();
    await t.run(30);
    expect(t.logs.map((l) => l.split('\t')[0])).toEqual(['touch_down', 'touch_up']);
  });

  it('turns touches with the display on a rotated touch panel (the 1.91" AMOLED runs landscape)', async () => {
    const t = await device(
      `local s = screens.get("main")
      function init(ctx) log.info("screen", s.w, s.h) end
      function on_event(ctx, e) if e.name == "touch_tap" then log.info("tap", e.data.x, e.data.y) end end`,
      FIRMWARE,
      'waveshare-esp32-s3-touch-amoled-1.91',
      false,
    );
    expect(t.error).toBeUndefined();
    const panel = t.display.touch!;
    panel.press(0, 0); // the panel's native top-left corner (portrait)
    panel.release();
    panel.press(239, 535); // its native bottom-right
    panel.release();
    await t.run(30);
    expect(t.logs).toEqual(['screen\t536\t240', 'tap\t0\t239', 'tap\t535\t0']);
  });

  it('has no touchscreen module on a display without a touch panel', async () => {
    const t = await device('function init(ctx) log.info(tostring(touchscreen)) end', FIRMWARE, 'waveshare-esp32-c6-lcd-1.47', false);
    expect(t.logs).toEqual(['nil']);
  });

  it("replays Bench's touches on a real board in order, and lets the board's own touch panel through", async () => {
    const t = await device(`
      function on_event(ctx, e)
        if e.name:sub(1, 6) == "touch_" then log.info(e.name, e.data.x, e.data.y, tostring(touchscreen.read().pressed)) end
      end`);
    expect(t.error).toBeUndefined();
    const te = (events: [number, string, number, number][]) => send(t.host, { d: {}, t: {}, s: {}, te: events });
    te([]); // baseline: nothing yet
    await t.run(30);
    te([[1, 'd', 5, 6], [2, 'm', 7, 8]]);
    await t.run(30);
    te([[1, 'd', 5, 6], [2, 'm', 7, 8], [3, 'u', 7, 8], [4, 't', 7, 8]]); // the first two again: already seen
    await t.run(30);
    expect(t.logs).toEqual(['touch_down\t5\t6\ttrue', 'touch_move\t7\t8\ttrue', 'touch_up\t7\t8\tfalse', 'touch_tap\t7\t8\tfalse']);
    t.logs.length = 0;
    t.host.queue({ name: 'touch_tap', channel: 'driver', data: { x: 1, y: 1 } }); // the board's own panel
    await t.run(30);
    expect(t.logs.map((l) => l.split('\t').slice(0, 3).join(' '))).toEqual(['touch_tap 1 1']);
  });

  it('tells apps on the round AMOLED that the screen is round and in colour', async () => {
    const t = await device(
      `local s = screens.get("main")
      function init(ctx) log.info(s.shape, s.w, s.h, s.depth, s.scheme, s.tech) end`,
      FIRMWARE,
      'waveshare-esp32-s3-touch-amoled-1.32',
      false,
    );
    expect(t.error).toBeUndefined();
    expect(t.logs).toEqual(['round\t466\t466\t16\tdark\tamoled']);
  });

  it('counts every press on a button, however quick, and sends A and B as gestures', () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load(DEFAULT_PARTS);
    const a = new Trigger({ builtin: 0 }, bench);
    const button = bench.resolve(a.connection)!.part as Button;
    expect(button.kind).toBe('button');
    for (let i = 0; i < 3; i++) {
      button.setDown(true);
      button.setDown(false);
    }
    a.isPressed();
    expect([a.presses, a.releases]).toEqual([3, 3]);
    const snap = new SnapshotReader().read([a], bench, { a }, [[3, 0, 0], [0, 0, 0]]);
    expect(snap.t).toEqual({}); // A travels as Bench's gestures, not raw presses
    expect(snap.g).toEqual([[3, 0, 0], [0, 0, 0]]);
  });

  it("reads Bench's controls and sensors into an update, counting dial steps", () => {
    const clock = new SimClock();
    clock.paused = true;
    const bench = new Bench(clock);
    bench.load(DEFAULT_PARTS);
    const pir = bench.add('pir') as Pir;
    const speed = new Dial({ min: 0, max: 10, start: 5 }, bench);
    speed.name = 'speed';
    const a = new Trigger({ builtin: 0 }, bench);
    const reader = new SnapshotReader();
    expect(reader.read([speed, a], bench, { a }).d.speed).toEqual([5, 0.5, 0]);
    (bench.part('knob-1') as Knob).turn(3);
    pir.wave();
    const snap = reader.read([speed, a], bench, { a });
    expect(snap.d.speed).toEqual([8, 0.8, 3]);
    expect(snap.t['@a']).toBeUndefined();
    expect(snap.s.pir).toEqual({ motion: true });
    // The IMU sends its rotation rate after the acceleration.
    bench.add('imu');
    const imu = reader.read([speed, a], bench, { a }).s.imu as number[];
    expect(imu).toHaveLength(6);
    expect(imu[2]).toBeCloseTo(1, 1); // face up: 1 g on z
  });

  it('boots every bundled display app wrapped for a real device', async () => {
    const files = import.meta.glob<string>('../src/resident-apps/*.lua', { query: '?raw', import: 'default', eager: true });
    for (const [path, code] of Object.entries(files)) {
      if (/^--\s*@output\s+(strip|matrix)/m.test(code)) continue; // LED apps need an LED chain
      const t = await device(code);
      expect(t.error, path).toBeUndefined();
      await t.run(200);
      expect(t.logs.filter((l) => l.startsWith('error')), path).toEqual([]);
      t.host.close();
    }
  }, 60_000);
});

describe('saved boards', () => {
  /** A fresh mirror over its own storage, with the relay answering `status`. */
  function mirror(status: number, stored: Record<string, string> = {}) {
    const store = new Map(Object.entries(stored));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const sent: { channel: string; type: string; data?: unknown }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { status };
    });
    return { m: new RemoteMirror(), store, sent };
  }
  const app = { name: 'hello', code: 'function init(ctx) end' };
  const source = () => ({ controls: [], bench: new Bench(new SimClock()), buttons: {} });
  const c6 = { id: 'waveshare-esp32-c6-lcd-1.47', name: 'Waveshare ESP32-C6-LCD-1.47' };
  const epaper = { id: 'waveshare-epd-2.13-v4', name: 'Waveshare 2.13" e-Paper' };

  afterEach(() => vi.unstubAllGlobals());

  it('keeps a board once the relay has delivered to it, newest first, with its display', async () => {
    const { m, store } = mirror(200);
    m.setDeviceId('78bf172a');
    await m.start(app, source, { display: epaper });
    m.stop();
    m.setDeviceId('94e41dfe');
    await m.start(app, source, { display: c6 });
    m.stop();
    expect(m.saved).toEqual([
      { id: '94e41dfe', display: c6.id, displayName: c6.name },
      { id: '78bf172a', display: epaper.id, displayName: epaper.name },
    ]);
    // Mirroring the older one again moves it back to the top.
    m.setDeviceId('78bf172a');
    await m.start(app, source, { display: epaper });
    m.stop();
    expect(m.saved.map((d) => d.id)).toEqual(['78bf172a', '94e41dfe']);
    expect(new RemoteMirror().saved).toEqual(JSON.parse(store.get('bench:remote-devices')!));
  });

  it("doesn't keep an ID the relay couldn't reach, and forgets on request", async () => {
    const { m } = mirror(503);
    m.setDeviceId('typo1234');
    await m.start(app, source, { display: c6 });
    m.stop();
    expect(m.saved).toEqual([]);

    const ok = mirror(200).m;
    ok.setDeviceId('94e41dfe');
    await ok.start(app, source, { display: c6 });
    ok.stop();
    ok.forget('94e41dfe');
    expect(ok.saved).toEqual([]);
  });

  it("sends Bench's time zone on its own channel before the app, never as a hello", async () => {
    const { m, sent } = mirror(200);
    m.setDeviceId('94e41dfe');
    await m.start(app, source, { display: c6, tz: 'Europe/Stockholm' });
    m.stop();
    expect(sent.map((b) => `${b.channel}:${b.type}`)).toEqual(['bench:timezone', 'system:app']);
    expect(sent[0].data).toEqual({ tz: 'Europe/Stockholm' });
  });

  it('lists the one ID Bench remembered before it kept a list', () => {
    expect(mirror(200, { 'bench:remote-device': '94e41dfe' }).m.saved).toEqual([{ id: '94e41dfe' }]);
  });
});
