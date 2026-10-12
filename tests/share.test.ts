// A share link carries a setup to someone else's Bench: it has to come out as it went in, open every
// bundled app, survive nothing worse than a clear "damaged", and leave a way back to your own bench.

import { describe, expect, it } from 'vitest';
import { residentApps } from '../src/resident-apps';
import { boardsFor } from '../src/sim/boards';
import { DEFAULT_PARTS } from '../src/sim/controls/bench';
import { findDevice, outputDevice } from '../src/sim/devices';
import { applySetup, LONG_LINK, readLink, restore, type Setup, shareLink, snapshot } from '../src/share';

/** localStorage, in memory. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  all() {
    return Object.fromEntries(this.map);
  }
}

const BASE = 'https://bench.porous.systems/';
const C6 = 'waveshare-esp32-c6-lcd-1.47';
const json = (store: Storage, key: string) => JSON.parse(store.getItem(`bench:${key}`) ?? 'null');

const code = residentApps.find((a) => a.id === 'patterns')!.code;
const description = 'A fire that roars when you turn the knob';
const ownApp: Setup = {
  output: { kind: 'display', device: C6 },
  board: boardsFor(findDevice(C6)!)[0].id,
  parts: [...DEFAULT_PARTS, { id: 'ld2410-1', kind: 'ld2410', label: 'Radar 1' }],
  connections: { speed: 'knob-1:rotate', next: 'button-1:press', level: 'none' },
  app: { name: 'flame', code, description },
};

describe('share links', () => {
  it('carry a setup there and back, in characters nothing rewrites', async () => {
    const link = await shareLink(ownApp, BASE);
    expect(link).toMatch(/^https:\/\/bench\.porous\.systems\/#share=1\.[A-Za-z0-9_-]+$/);
    expect(await readLink(link.slice(BASE.length))).toEqual(ownApp);
  });

  it('name a bundled app instead of carrying its code, so the link stays short', async () => {
    const link = await shareLink({ ...ownApp, app: { bundled: 'swiss-clock' } }, BASE);
    expect(link.length).toBeLessThan(LONG_LINK / 4);
  });

  it('open every bundled app', async () => {
    for (const a of residentApps) {
      const store = new MemoryStorage();
      const link = await shareLink({ ...ownApp, app: { bundled: a.id } }, BASE);
      const { live, opened } = applySetup((await readLink(link.slice(BASE.length)))!, store);
      // App lists bundled apps as `resident:<id>` and starts on bench:sketch.
      expect(json(store, 'sketch')).toBe(`resident:${a.id}`);
      expect([live, opened.app, opened.missing]).toEqual([null, a.name, []]);
    }
  });

  it('read as damaged when cut short or mangled, not as half a setup', async () => {
    const hash = (await shareLink(ownApp, BASE)).slice(BASE.length);
    expect(await readLink(hash.slice(0, hash.length / 2))).toBeNull();
    expect(await readLink(hash.slice(0, -1) + '!')).toBeNull();
    expect(await readLink('#share=1.')).toBeNull();
    expect(await readLink('#share=9.abc')).toBeNull();
    // Valid JSON, compressed right, but not a setup.
    const notSetup = (await shareLink({ hello: 'there' } as unknown as Setup, BASE)).slice(BASE.length);
    expect(await readLink(notSetup)).toBeNull();
  });

  it('write the output, board, parts, connections and your own app where Bench reads them', () => {
    const store = new MemoryStorage();
    store.setItem('bench:binding:resident:live:old', 'pot-1:position');
    store.setItem('bench:boards', JSON.stringify({ 'ws2812-strip-30': 'esp32-devkitc' }));
    const { live, opened } = applySetup(ownApp, store);
    expect(live).toEqual({ name: 'flame', code, description, source: 'link' });
    expect(json(store, 'sketch')).toBe('resident:live');
    expect([json(store, 'output-kind'), json(store, 'device')]).toEqual(['display', C6]);
    expect(json(store, 'boards')).toEqual({ 'ws2812-strip-30': 'esp32-devkitc', [C6]: ownApp.board });
    expect(json(store, 'parts')).toEqual(ownApp.parts);
    // The link's connections replace the app's old ones, stored as App stores them (unencoded).
    expect(store.getItem('bench:binding:resident:live:old')).toBeNull();
    expect(store.getItem('bench:binding:resident:live:speed')).toBe('knob-1:rotate');
    expect(store.getItem('bench:binding:resident:live:level')).toBe('none');
    expect(opened).toEqual({ app: 'flame', output: findDevice(C6)!.name, missing: [] });
  });

  it('open LED strips, rings and matrices on the board chosen', () => {
    const outputs: [Setup['output'], string, unknown][] = [
      [{ kind: 'strip', count: 60 }, 'output-strip', 60],
      [{ kind: 'ring', count: 24 }, 'output-ring', 24],
      [{ kind: 'matrix', w: 32, h: 8 }, 'output-matrix', '32x8'],
    ];
    for (const [output, key, value] of outputs) {
      const device = outputDevice(output)!;
      const board = boardsFor(device).at(-1)!.id;
      const store = new MemoryStorage();
      applySetup({ ...ownApp, output, board }, store);
      expect([json(store, 'output-kind'), json(store, key), json(store, 'boards')]).toEqual([output.kind, value, { [device.id]: board }]);
    }
  });

  it("leave out what this Bench doesn't have, and say so", () => {
    const store = new MemoryStorage();
    store.setItem('bench:device', JSON.stringify(C6));
    store.setItem('bench:sketch', JSON.stringify('resident:hello'));
    const { opened } = applySetup(
      {
        output: { kind: 'display', device: 'future-display' },
        board: 'future-board',
        parts: [...DEFAULT_PARTS, { id: 'lidar-1', kind: 'lidar', label: 'Lidar 1' }, { id: 'lidar-2', kind: 'lidar', label: 'Lidar 2' }] as Setup['parts'],
        connections: {},
        app: { bundled: 'future-app' },
      },
      store,
    );
    expect(opened.missing).toEqual(['the display "future-display"', 'the part "lidar"', 'the app "future-app"']);
    expect(json(store, 'device')).toBe(C6);
    expect(json(store, 'sketch')).toBe('resident:hello');
    expect(json(store, 'parts')).toEqual(DEFAULT_PARTS);

    const board = applySetup({ ...ownApp, board: 'future-board' }, new MemoryStorage()).opened.missing;
    expect(board).toEqual(['the board "future-board"']);
  });

  it('can be undone: what the link added goes, what it changed comes back, the rest is untouched', () => {
    const store = new MemoryStorage();
    store.setItem('bench:sketch', JSON.stringify('resident:hello'));
    store.setItem('bench:parts', JSON.stringify([{ id: 'pot-1', kind: 'pot', label: 'Mine' }]));
    store.setItem('bench:resident:live', JSON.stringify({ name: 'mine', code: '-- mine', source: 'editor' }));
    store.setItem('bench:binding:resident:live:speed', 'pot-1:position');
    store.setItem('bench:view', JSON.stringify({ mode: 'flat' }));
    const before = store.all();
    const kept = snapshot(store);
    applySetup(ownApp, store);
    // The shared app boots and the session saves it as yours.
    store.setItem('bench:resident:live', JSON.stringify({ name: 'flame', code: '-- theirs', source: 'link' }));
    store.setItem('bench:view', JSON.stringify({ mode: '3d' }));
    restore(store, kept);
    expect(store.all()).toEqual({ ...before, 'bench:view': JSON.stringify({ mode: '3d' }) });
  });
});
