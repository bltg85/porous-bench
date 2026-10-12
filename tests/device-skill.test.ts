// Bench's device skill (docs/resident/DEVICE-SKILL.md) is how other Claude sessions learn Bench, so
// it must say what the code does. These tests compare it with the device profiles, the boards, the
// Lua modules the sandbox defines, the stand-ins the mirror shim carries and the share links Bench
// opens.

import { describe, expect, it } from 'vitest';
import skill from '../docs/resident/DEVICE-SKILL.md?raw';
import prelude from '../src/resident/lua/prelude.lua?raw';
import shim from '../src/resident/lua/remote.lua?raw';
import { MAX_DATA } from '../api/_share.js';
import { applySetup, readLink, type Setup } from '../src/share';
import { BOARDS, boardsFor, GENERIC_BOARDS } from '../src/sim/boards';
import { SimClock } from '../src/sim/clock';
import { CHANNELS } from '../src/sim/controls/bench';
import { devices } from '../src/sim/devices';
import { Display } from '../src/sim/display';
import { MATRIX_SIZES, RING_COUNTS, STRIP_COUNTS } from '../src/sim/leds';
import { MemoryStorage } from './memory-storage';

/** A section's text, from its heading to the next heading at the same level or above. */
function section(heading: string): string {
  const lines = skill.split('\n');
  const start = lines.findIndex((l) => /^#+ /.test(l) && l.replace(/^#+ /, '').startsWith(heading));
  if (start < 0) throw new Error(`DEVICE-SKILL.md has no section "${heading}"`);
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && /^#+ /.test(l) && l.match(/^#+/)![0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** A Markdown table's body rows, as cells. */
function rows(text: string): string[][] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l))
    .slice(1)
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

/** The size apps see: the panel after the rotation the firmware sets. */
function appSize(d: (typeof devices)[number]): string {
  const display = new Display(d, new SimClock());
  display.setRotation(d.firmwareRotation ?? 0);
  return `${display.width()}×${display.height()}`;
}

const displays = devices.filter((d) => d.tech !== 'led');

/** The ids in a table cell (`a dev board`: any of them). */
const ids = (cell: string) => (cell === 'a dev board' ? GENERIC_BOARDS : [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
/** "8, 16 or 30", as the skill lists choices. */
const choices = (list: string[]) => `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;

describe('DEVICE-SKILL.md', () => {
  it('lists every display at the size apps see, and nothing that is gone', () => {
    const table = rows(section('Hardware'));
    const sizes = table.flatMap((r) => r[1].match(/\d+×\d+/g) ?? []);
    for (const d of displays) expect(sizes, `${d.name} (${appSize(d)}) is missing from the Hardware table`).toContain(appSize(d));
    for (const s of sizes) expect(displays.map(appSize), `the Hardware table lists ${s}, which no display has`).toContain(s);
  });

  it('names every display with a touch panel under touchscreen', () => {
    const text = section('touchscreen');
    for (const d of displays.filter((d) => d.touch)) expect(text, `${d.name} is missing under touchscreen`).toContain(d.name.replace(/^Waveshare /, ''));
  });

  it("gives every board's libraries and memory as boards.ts does", () => {
    const table = rows(section('Boards: libraries and memory'));
    for (const b of BOARDS) {
      // A chip on a module goes by the module's name; any other board by its own, less the chip in brackets.
      const module = b.name.endsWith('(on the board)') ? devices.find((d) => d.id === b.id) : undefined;
      const name = module?.name ?? b.name.replace(/\s*\(.*\)$/, '');
      const row = table.find((r) => r[0].includes(name));
      expect(row, `${name} is missing from the Boards table`).toBeDefined();
      const [, libraries, memory] = row!;
      const listed = [...libraries.matchAll(/(no )?`(\w+)`/g)].filter((m) => !m[1]).map((m) => m[2]);
      expect(listed.sort(), `${name}'s libraries`).toEqual([...b.libraries].sort());
      const expected = b.appRamKb === undefined ? 'not measured' : b.appRamKb >= 1024 ? 'PSRAM' : `~${b.appRamKb} KB`;
      expect(memory, `${name}'s memory for apps`).toContain(expected);
    }
  });

  it('documents every Lua module the sandbox defines, and none it does not', () => {
    const sandbox = prelude.slice(0, prelude.indexOf('the sandbox boundary'));
    const modules = new Set([...sandbox.matchAll(/^\s*([a-z][a-z0-9_]*) = (?:\{|setmetatable)/gm)].map((m) => m[1]));
    const headings = [...skill.matchAll(/^### (.+)$/gm)].flatMap((m) => m[1].replace(/\(.*\)/, '').split(',')).map((h) => h.trim());
    for (const m of modules) expect(headings.includes(m) || skill.includes(`\`${m}\``), `the Lua module \`${m}\` is not in the skill`).toBe(true);
    for (const h of headings) expect([...modules], `the skill has a section for \`${h}\`, which the sandbox doesn't define`).toContain(h);
  });

  it('gives the id of every display and the boards that can drive it, as share links name them', () => {
    const text = section('Share links');
    const table = rows(text.slice(0, text.indexOf('| Part')));
    for (const d of displays) {
      const row = table.find((r) => ids(r[1]).includes(d.id));
      expect(row, `${d.name} (${d.id}) is missing from the share links' display table`).toBeDefined();
      expect(ids(row![2]).sort(), `the boards for ${d.name}`).toEqual(boardsFor(d).map((b) => b.id).sort());
    }
    for (const id of table.flatMap((r) => ids(r[1]))) expect(displays.map((d) => d.id), `the share links' table lists ${id}, which no display has`).toContain(id);
    for (const id of GENERIC_BOARDS) expect(text, `the dev board ${id} is missing`).toContain(`\`${id}\``);
    expect(text).toContain(`${choices(STRIP_COUNTS.map(String))} LEDs`);
    expect(text).toContain(choices(RING_COUNTS.map(String)));
    expect(text).toContain(`at ${choices(MATRIX_SIZES.map(([w, h]) => `${w}×${h}`))}`);
  });

  it('gives every part kind with the channels a dial or a trigger can connect to', () => {
    const text = section('Share links');
    const table = rows(text.slice(text.indexOf('| Part')));
    for (const [kind, channels] of Object.entries(CHANNELS)) {
      const row = table.find((r) => ids(r[0])[0] === kind);
      expect(row, `the part kind ${kind} is missing`).toBeDefined();
      expect(ids(row![1]), `${kind}'s dial channels`).toEqual(channels.filter((c) => c.kind !== 'momentary').map((c) => c.id));
      expect(ids(row![2]), `${kind}'s trigger channels`).toEqual(channels.filter((c) => c.kind === 'momentary').map((c) => c.id));
    }
    expect(table.length, 'the part table lists a kind Bench has no part for').toBe(Object.keys(CHANNELS).length);
  });

  it('shows how to make a share link that Bench opens as written', async () => {
    const text = section('Share links');
    // The example, run as the skill runs it, with Node's modules (loaded by name: the tests have no Node types).
    const literal = /const setup = (\{[\s\S]*?\n\});/.exec(text)![1];
    const setup = new Function('fs', `return (${literal})`)({ readFileSync: () => '-- Flame: a flame the knob fans\n' }) as Setup;
    const node = (name: string) => import(/* @vite-ignore */ `node:${name}`);
    const zlib = await node('zlib');
    const { Buffer } = await node('buffer');
    const prefix = 'https://bench.porous.systems/#share=1.';
    expect(text).toContain(`console.log("${prefix}" + zlib.deflateRawSync(JSON.stringify(setup)).toString("base64url"))`);
    const link = prefix + zlib.deflateRawSync(JSON.stringify(setup)).toString('base64url');
    expect(await readLink(link.slice(link.indexOf('#')))).toEqual(setup);
    expect(applySetup(setup, new MemoryStorage()).opened.missing, 'the example names something Bench does not have').toEqual([]);
    // And the way back, for a link the user pastes.
    expect(text).toContain('zlib.inflateRawSync(Buffer.from(data.slice(2), "base64url"))');
    const data = link.slice(link.indexOf('#share=') + '#share='.length);
    expect(JSON.parse(zlib.inflateRawSync(Buffer.from(data.slice(2), 'base64url')).toString())).toEqual(setup);
  });

  it('gives short links as the server keeps them', () => {
    const text = section('Share links');
    expect(text).toContain('https://bench.porous.systems/s/<id>');
    expect(text).toContain('curl -s https://bench.porous.systems/api/share --data-binary "1.<data>"');
    expect(text).toContain('curl -s https://bench.porous.systems/api/share/<id>');
    expect(text).toContain(`up to ${MAX_DATA.toLocaleString('en')} characters of data`);
  });

  it("names every stand-in the mirror shim carries to a real board", () => {
    const text = section('On a real board');
    for (const [, part] of shim.matchAll(/^-- @@part (\w+)$/gm)) expect(text, `the shim's \`${part}\` stand-in is missing`).toContain(`\`${part}\``);
  });
});
