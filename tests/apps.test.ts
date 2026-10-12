import { LuaFactory } from 'wasmoon';
import { describe, expect, it } from 'vitest';
import { ResidentHost, resetScreen, type ResidentBoard } from '../src/resident/host';
import { AppStore } from '../src/resident/store';
import { Zone } from '../src/resident/zone';
import { SimClock } from '../src/sim/clock';
import { Bench, DEFAULT_PARTS, PART_KINDS, type PartSpec } from '../src/sim/controls/bench';
import { Dial, Trigger } from '../src/sim/controls/controls';
import { findDevice } from '../src/sim/devices';
import type { DeviceProfile } from '../src/sim/devices/types';
import { Display } from '../src/sim/display';
import { appNeeds, misfits, outputCaps } from '../src/resident/needs';
import { boardsFor, type Library } from '../src/sim/boards';
import { benchApp } from '../src/sim/generate';
import { ledProfile, MATRIX_SIZES } from '../src/sim/leds';
import { Imu } from '../src/sim/inputs/imu';
import { LD2410 } from '../src/sim/inputs/ld2410';

// Every bundled app must boot and run without a Lua error on each kind of output it's written for:
// display apps on a colour LCD in landscape and portrait, a portrait touch LCD, a round AMOLED, a small round touch LCD, a landscape touch AMOLED,
// a tiny 1-bit OLED and e-paper; strip apps on a strip and a ring; matrix apps on every matrix size.
const OUTPUTS: Record<'display' | 'strip' | 'matrix', DeviceProfile[]> = {
  display: ['m5stickc-plus2', 'waveshare-esp32-c6-lcd-1.47', 'waveshare-esp32-s3-touch-lcd-2', 'waveshare-esp32-s3-touch-amoled-1.32', 'seeed-xiao-round-display', 'waveshare-esp32-s3-touch-amoled-1.91', 'ssd1306-128x32', 'waveshare-epd-2.13-v4'].map(
    (id) => findDevice(id)!,
  ),
  strip: [ledProfile({ kind: 'strip', count: 30 }), ledProfile({ kind: 'ring', count: 12 })],
  matrix: MATRIX_SIZES.map(([w, h]) => ledProfile({ kind: 'matrix', w, h })),
};
const files = import.meta.glob<string>('../src/resident-apps/*.lua', { query: '?raw', import: 'default', eager: true });
const apps = Object.entries(files).map(([path, code]) => ({
  name: path.split('/').pop()!,
  code,
  target: (/^--\s*@output\s+(display|strip|matrix)\b/m.exec(code)?.[1] ?? 'display') as keyof typeof OUTPUTS,
}));
const factory = new LuaFactory();

async function runApp(code: string, device: DeviceProfile, ms: number, parts: PartSpec[] = DEFAULT_PARTS, controls: (Dial | Trigger)[] = [], libraries?: readonly Library[]) {
  const clock = new SimClock();
  clock.paused = true;
  const display = new Display(device, clock);
  display.setRotation(device.firmwareRotation ?? 0);
  const bench = new Bench(clock);
  bench.load(parts);
  const problems: string[] = [];
  const board: ResidentBoard = {
    display,
    now: () => clock.now(),
    zone: () => new Zone('Europe/Stockholm'),
    buttons: [new Trigger({}, bench), new Trigger({}, bench)],
    imu: new Imu({}, clock),
    store: new AppStore('apps-test', false),
    libraries,
    dial: (_name, opts) => {
      const d = new Dial(opts, bench);
      controls.push(d);
      return d;
    },
    trigger: (_name, opts) => {
      const t = new Trigger(opts, bench);
      controls.push(t);
      return t;
    },
    radar: (opts) => new LD2410(opts, clock),
    sensor: (kind) => bench.ensure(kind).part,
    log: (level, text) => level === 'error' && problems.push(text),
    telemetry: () => {},
    publish: () => 'sent',
  };
  // Showing a frame finishes in sim time (an e-paper refresh takes seconds): run the clock until it has.
  const until = async (p: Promise<unknown>) => {
    let done = false;
    void p.then(() => (done = true));
    for (let k = 0; k < 2000 && !done; k++) {
      clock.advance(5);
      await Promise.resolve();
    }
  };
  await until(resetScreen(display));
  const { host, error } = await ResidentHost.boot(factory, board, { code });
  if (error) return [error];
  for (let t = 0; t < ms; t += 20) {
    clock.advance(20);
    host.step();
    await until(host.settle());
  }
  host.close();
  return problems;
}

describe('bundled apps', () => {
  for (const app of apps) {
    it(`${app.name} runs on every kind of ${app.target}`, async () => {
      const needs = appNeeds(app.code);
      for (const device of OUTPUTS[app.target]) {
        if (needs.touch && !device.touch) continue; // listed only where there's a touch panel
        // With only the libraries of a board that has what it binds, as Bench runs it.
        const libraries = boardsFor(device)
          .map((b) => outputCaps(device, b).libraries)
          .find((libs) => needs.libraries.every((l) => libs.includes(l)));
        if (!libraries) continue; // listed only on other boards
        expect(await runApp(app.code, device, 600, DEFAULT_PARTS, [], libraries), `${app.name} on ${device.id}`).toEqual([]);
      }
    }, 60_000);
  }
});

describe('the porous.systems logo', () => {
  // The words are rasterised after the spokes, ~1.3 s in: run past the end of the intro.
  it('runs its whole intro on every display', async () => {
    const app = apps.find((a) => a.name === 'porous-systems.lua')!;
    for (const device of OUTPUTS.display) expect(await runApp(app.code, device, 2500), device.id).toEqual([]);
  }, 60_000);
});

describe('apps generated from the bench', () => {
  // One of everything, and two encoders, so each control has to find its own part.
  const parts: PartSpec[] = [
    ...PART_KINDS.map(({ kind, label }) => ({ id: `${kind}-1`, kind, label: `${label} 1` })),
    { id: 'knob-2', kind: 'knob', label: 'Encoder 2' },
  ];
  for (const target of ['display', 'strip', 'matrix'] as const) {
    it(`runs on every kind of ${target}`, async () => {
      const code = benchApp(target, parts);
      for (const device of OUTPUTS[target]) {
        // An LED chain's own libraries (a strip has no lgfx); the display app here is the LVGL one.
        const libraries = target === 'display' ? undefined : outputCaps(device, boardsFor(device)[0]).libraries;
        expect(await runApp(code, device, 600, parts, [], libraries), `bench app on ${device.id}`).toEqual([]);
      }
    }, 60_000);
  }

  it('connects each control to the part it was written for', async () => {
    const controls: (Dial | Trigger)[] = [];
    expect(await runApp(benchApp('display', parts), OUTPUTS.display[0], 100, parts, controls)).toEqual([]);
    const sources = controls.map((c) => c.source);
    expect(sources).toContain('knob-2:rotate');
    expect(sources).toContain('knob-2:push');
    expect(sources).toContain('imu-1:tilt-y');
    expect(sources).toContain('climate-1:humidity');
    expect(sources).not.toContain('none');
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('writes lgfx instead of LVGL for a board without it, and fits that board', async () => {
    const code = benchApp('display', parts, ['screen', 'lgfx']);
    expect(code).not.toContain('lvgl');
    for (const device of OUTPUTS.display) expect(await runApp(code, device, 600, parts, [], ['screen', 'lgfx']), `lgfx bench app on ${device.id}`).toEqual([]);
    // The two boards Bench ships tested firmware for, neither with LVGL.
    for (const id of ['waveshare-epd-2.13-v4', 'waveshare-esp32-c6-lcd-1.47']) {
      const device = findDevice(id)!;
      const board = boardsFor(device)[0];
      expect(misfits(appNeeds(benchApp('display', DEFAULT_PARTS, board.libraries)), outputCaps(device, board)), id).toEqual([]);
    }
  }, 60_000);

  it('still runs with an empty bench', async () => {
    expect(await runApp(benchApp('matrix', []), OUTPUTS.matrix[0], 200, [])).toEqual([]);
  });
});
