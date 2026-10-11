// A starting prompt for Claude to write a Resident Lua app outside Bench, for exactly what's set up
// here: the output, the parts on the bench (with the ids `connect` uses), how the open app's controls
// are connected, that app as a reference, and where to push the result.

import { CHANNELS, type PartKind, type PartSpec } from '../sim/controls/bench';
import type { Board } from '../sim/boards';
import type { DeviceProfile } from '../sim/devices/types';
import { chainWords } from '../sim/leds';

const REPO = 'https://github.com/sjunnesson/porous-bench';
const DEVICE_SKILL = 'https://raw.githubusercontent.com/sjunnesson/porous-bench/main/docs/resident/DEVICE-SKILL.md';
const SITE = 'https://bench.porous.systems';

export interface PromptInput {
  device: DeviceProfile;
  /** The board driving the output: its libraries and memory bound what the app can use. */
  board?: Board;
  /** Everything on the bench: the board's own hardware and the parts added to it. */
  parts: (PartSpec & { builtin: boolean })[];
  /** The open app's controls and what each is connected to ('part:channel' or 'none'). */
  controls: { label: string; kind: 'dial' | 'trigger'; source: string }[];
  app: { id: string; name: string; description?: string; code: string; bundled: boolean };
  deviceId: string;
  online: boolean;
  /** The folder Bench is watching for .lua files, if any (just its name: the browser doesn't reveal paths). */
  watching?: string | null;
  /** Bench wrote its DEVICE-SKILL.md into the watched folder. */
  skillInFolder?: boolean;
}

/** What a part offers besides dials and triggers: its own Lua module. */
const MODULE: Partial<Record<PartKind, string>> = {
  imu: '`imu.accel()` (g) and `imu.gyro()` (°/s)',
  ld2410: '`ld2410.begin({ mode = "wander" })`, then `ld2410.read()` for distances and energies',
  pir: '`pir.motion()`, plus a `motion` driver event on each change',
  light: '`light.level()` (0..1)',
  climate: '`climate.temperature()` (°C) and `climate.humidity()` (%)',
  touch: '`touch.touched()`, plus a `touch` driver event on each change',
  buzzer: '`buzzer.beep(hz, ms)`, `buzzer.tone(hz)`, `buzzer.stop()`',
};

/** The board driving the output, and what that means for the app. */
function boardLines(board: Board | undefined): string[] {
  if (!board) return [];
  const memory =
    board.appRamKb === undefined
      ? 'its app memory hasn\'t been measured'
      : board.appRamKb >= 1024
        ? `${board.appRamKb / 1024} MB of PSRAM for apps`
        : `only ~${board.appRamKb} KB of heap to receive, compile and run the app`;
  const lines = [`- It's driven by a ${board.name}: its firmware has ${board.libraries.join(', ')}; ${memory}.`];
  if (board.appRamKb !== undefined && board.appRamKb < 1024) {
    lines.push(`- Keep the app small: receiving and compiling it takes ~6x its size, so stay under ~${Math.floor((board.appRamKb * 0.75) / 6 - 2)} KB of Lua, and skip \`datetime\` unless it matters (~35 KB).`);
  }
  return lines;
}

const NEEDS_LINE =
  "- If the app animates, only makes sense in colour, needs the touch panel, or has a fixed layout, say so on the line after `@output`: `-- @needs motion color touch 240x135` (any of them; WxH is the smallest screen it fits). Bench then lists it only for outputs that can run it.";

function outputSection(p: DeviceProfile, board?: Board): string[] {
  const leds = p.look.leds;
  if (leds) {
    const n = p.width * p.height;
    const shape =
      leds.layout === 'grid'
        ? `a ${p.width}×${p.height} WS2812B matrix (${n} LEDs, ${chainWords(leds.chain)}: find an LED with \`leds.xy(x, y)\`, never \`y * width + x\`, so the app runs on any panel)`
        : leds.layout === 'ring'
          ? `a WS2812B ring of ${n} LEDs (LED 0 at the top, clockwise)`
          : `a WS2812B strip of ${n} LEDs`;
    return [
      leds.layout === 'grid'
        ? `The output is ${shape}, not a screen: there is no \`screen\` or \`lvgl\`, but the matrix is also an \`lgfx\` display, ${p.width}×${p.height} pixels, one per LED: text and shapes work with \`lgfx.bind("main")\` and \`g:flip()\` (the built-in 5×7 font fits 8 rows).`
        : `The output is ${shape}, not a screen: there is no lgfx, screen or lvgl drawing.`,
      '- Use the `leds` module: `leds.set(i, rgb)`, `leds.set_rgb(i, r, g, b)`, `leds.fill`, `leds.hsv(h, s, v)`, `leds.brightness(0..255)`, then `leds.show()`.',
      '- Animate in `leds.on_frame(function(ctx, dt_ms) … end[, fps])`, the LED driver\'s own frame timer (50 fps by default), not in the 10 Hz `on_tick`.',
      `- At full white each LED draws about 60 mA (${((n * 60) / 1000).toFixed(1)} A for all of them): keep brightness moderate.`,
      `- Put \`-- @output ${leds.layout === 'grid' ? 'matrix' : 'strip'}\` on the app's second line.`,
      ...boardLines(board),
    ];
  }
  const turned = (p.firmwareRotation ?? 0) % 2 === 1;
  const [w, h] = turned ? [p.height, p.width] : [p.width, p.height];
  const color = p.tech === 'lcd' || p.tech === 'amoled';
  const lines = [
    `The output is the display of a ${p.name}: ${w}×${h} pixels as apps see them, ${p.tech.toUpperCase()}, ${color ? '16-bit colour' : '1-bit (pixels are lit or not)'}, ${p.tech === 'epaper' ? 'light' : 'dark'} scheme, ${p.controller} over ${p.bus.kind.toUpperCase()}.`,
    '- Read the screen\'s facts from `screens.get("main")` rather than hard-coding them, so the app adapts.',
    board && !board.libraries.includes('lvgl')
      ? '- Draw with `lgfx` (or the `screen` verbs). There is no `lvgl` on this board.'
      : '- Draw with `lgfx`, or with the optional `lvgl` module. For motion, use `lvgl.Anim`: LVGL runs it on its own timer pump, smoother than the 10 Hz `on_tick`.',
    ...boardLines(board),
  ];
  if (p.shape === 'round') {
    lines.push(`- The glass is round: only the circle of radius ${Math.min(w, h) / 2} px around the centre shows (\`screens.get("main").shape\` is "round"). Lay out from the centre and keep text inside the circle.`);
  } else if (p.look.cornerRadiusPx) lines.push(`- The glass has rounded corners (radius ${p.look.cornerRadiusPx} px): keep content clear of them.`);
  if (p.touch) {
    lines.push(
      `- It has a touch panel (${p.touch.controller}), one finger: \`touchscreen.read()\` gives \`{ pressed, x, y }\`, and \`on_event\` gets \`touch_down\`, \`touch_move\`, \`touch_up\` and \`touch_tap\` (released within 500 ms, moved under 10 px), each with \`e.data.x\` / \`e.data.y\` in the coordinates the app draws in. In Bench I tap by clicking the screen. Hit-test your own layout; LVGL widgets don't receive touches.`,
    );
  }
  if (p.tech === 'amoled') lines.push('- AMOLED: every pixel emits its own light and black is off, so a black background looks like no screen at all; it suits dark, high-contrast designs.');
  if (!color && p.tech !== 'epaper') lines.push('- 1-bit: use pure white on black; colours become lit or unlit at 50% brightness.');
  if (p.epaper) lines.push(`- E-paper: every \`flip()\` is a refresh (about ${p.epaper.fullRefreshMs / 1000} s full, ${p.epaper.partialRefreshMs / 1000} s partial). Change the screen rarely and don't animate.`);
  lines.push('- Put `-- @output display` on the app\'s second line.', NEEDS_LINE);
  return lines;
}

function benchSection(parts: PromptInput['parts']): string[] {
  const lines: string[] = [];
  for (const p of parts) {
    const channels = (CHANNELS[p.kind] ?? []).map((c) => `${c.label} → ${c.kind === 'momentary' ? 'trigger' : 'dial'} \`connect = "${p.id}:${c.id}"\``);
    const own = p.builtin ? ' (built into the board)' : '';
    const ab = p.id.endsWith('-0') ? 'A (index 0)' : p.id.endsWith('-1') ? 'B (index 1)' : null;
    const button = p.builtin && p.kind === 'button' && ab ? `; by default it's button ${ab}, which arrives as \`tap\` / \`hold\` events in \`on_event\`` : '';
    const module = MODULE[p.kind] ? `; module: ${MODULE[p.kind]}` : '';
    lines.push(`- **${p.label}**${own}${channels.length ? `: ${channels.join(', ')}` : ''}${button}${module}`);
  }
  return lines.length ? lines : ['- Nothing yet besides the board itself.'];
}

function connectionsSection(input: PromptInput): string[] {
  const named = (source: string) => {
    if (source === 'none') return 'keyboard only';
    const [id, ch] = source.split(':');
    const part = input.parts.find((p) => p.id === id);
    const channel = part && CHANNELS[part.kind]?.find((c) => c.id === ch);
    return `${part?.label ?? id} ${channel?.label ?? ch} (\`${source}\`)`;
  };
  return input.controls.map((c) => `- ${c.label} (${c.kind}) ← ${named(c.source)}`);
}

function appSection(app: PromptInput['app']): string[] {
  const lines = [`The app open on the bench now is **${app.name}**${app.description ? `: ${app.description}` : '.'}`];
  if (app.bundled) {
    lines.push(`Its source: ${REPO}/blob/main/src/resident-apps/${app.id.replace(/^resident:/, '')}.lua`);
  } else if (app.code.length <= 16_000) {
    lines.push('Its source:', '', '```lua', app.code.trimEnd(), '```');
  }
  lines.push('Use it as a starting point or a reference if it helps; otherwise start fresh.');
  return lines;
}

function deliverSection({ deviceId, online, watching }: PromptInput): string[] {
  const save = 'Save the app as `<app-name>.lua` in the current folder (create-app `--out`), so I can keep it.';
  if (watching) {
    return [
      `- ${save}`,
      `- That's all the delivery it needs: Bench is watching my folder \`${watching}\` (the one I'm running you in) and runs any .lua file the moment it's saved there. No push, nothing over the network. If the current folder isn't \`${watching}\`, tell me.`,
    ];
  }
  return [
    `- ${save} If I point Bench at this folder (Receive apps → Watch a folder for apps), it runs the moment it's saved, with nothing over the network.`,
    `- Then push it to my Bench with push-app: \`--device-id ${deviceId}\` (the default relay, https://resident.inanimate.tech, passes it to my own Bench tab; the ID is mine). ${online ? 'Bench is connected to the relay.' : "I'll press Connect in Bench's Receive apps panel first."} If push.sh exits 1, Bench isn't connected: say so and stop.`,
    '- If the push is blocked by a permission check or fails, don\'t look for another way to send it: show me the exact push command so I can run it myself.',
  ];
}

/** The prompt, as Markdown. */
export function appPrompt(input: PromptInput): string {
  const skill =
    input.watching && input.skillInFolder
      ? `Bench keeps it in my folder as \`./DEVICE-SKILL.md\`, written by the Bench I'm running, so it matches exactly: use that copy and don't download one.`
      : `Download it fresh into the current folder as \`./DEVICE-SKILL.md\`, replacing any copy already there (an old one can be out of date): ${DEVICE_SKILL}.`;
  return [
    'Write a Resident Lua app for my porous.systems Bench setup, for the hardware described below.',
    '',
    '## Skills and references',
    '- Use the Resident Claude Code plugin\'s skills: create-app to write the app (it validates it too), push-app to send it. If they\'re missing: `/plugin marketplace add inanimate-tech/agent-plugins`, then `/plugin install resident@inanimate`.',
    `- Bench's device skill describes this board, its Lua modules and the Bench drivers. ${skill} Both skills pick it up from there (without it, push-app falls back to the plain M5Stick surface for \`sim-\` devices).`,
    "- Its sections *Which outputs list an app*, *Boards: libraries and memory* and *On a real board (Bench's Mirror)* say how Bench matches apps to hardware and runs them on a real board: follow them.",
    `- Bench itself: ${SITE} (source: ${REPO}).`,
    '',
    '## Output',
    ...outputSection(input.device, input.board),
    '',
    '## Inputs on the bench',
    'Declare what the app needs with `dial.new(name, opts)` (a value) and `trigger.new(name, opts)` (a moment). `via` asks for a kind of hardware, so the app works on any bench; `connect = "part:channel"` pins a control to one of these parts. I can rewire either in Bench\'s Connections panel.',
    ...benchSection(input.parts),
    ...(input.controls.length ? ['', '## How the open app is connected', ...connectionsSection(input)] : []),
    '',
    '## The app open now',
    ...appSection(input.app),
    '',
    '## Rules',
    '- One Lua file in the Resident sandbox: `init(ctx)`, `on_tick(ctx, dt_ms)` at 10 Hz, `on_event(ctx, e)`.',
    '- First line: `-- Name: one-sentence description` (Bench shows it in the App menu).',
    "- Keep each callback well under a second. A board stops init, a tick or an event still running after 1000 ms (`execution deadline exceeded (1000 ms)`). Nothing stops an LVGL callback, a coroutine that never yields, or code that catches that error with pcall and carries on: those hang a board, and Bench halts the app.",
    "- Bench runs Lua far faster than a board. For an animation to keep 10 fps on the glass, each tick (with its `flip()`) has to finish in under 100 ms: follow the device skill's *Speed on a real board* section, which says how (an ESP32-C6 has no FPU).",
    '',
    '## Deliver',
    ...deliverSection(input),
    '',
    '## What to build',
    '[Describe the app: what it shows, and what each input should do.]',
    '',
  ].join('\n');
}
