// A prompt for Claude Code to build Resident firmware for the hardware selected on Bench and flash it,
// so the real device comes online on the relay with a device ID that Bench's Real device panel can
// mirror to. Grounded in Resident's own guide (docs/start-building.md) and Bench's profile of the part.

import type { Board } from '../sim/boards';
import type { PartSpec } from '../sim/controls/bench';
import type { DeviceProfile } from '../sim/devices/types';
import { chainWords } from '../sim/leds';
import { gpioName, type Wiring, wiring, wiringLines } from '../sim/wiring';

const RESIDENT = 'https://github.com/inanimate-tech/resident';
const START_BUILDING = 'https://raw.githubusercontent.com/inanimate-tech/resident/main/docs/start-building.md';
const DEVICE_SKILL = 'https://raw.githubusercontent.com/sjunnesson/porous-bench/main/docs/resident/DEVICE-SKILL.md';
const SITE = 'https://bench.porous.systems';

/** Official Resident firmware for these boards: build it as it is. */
const M5_ENVS: Record<string, string> = { 'm5stickc-plus2': 'm5stick', m5sticks3: 'm5sticks3' };

const REPO = 'https://github.com/sjunnesson/porous-bench';

/** Firmware Bench ships in its own repo (firmware/), by output and board: build it as it is. */
const BENCH_FIRMWARE: Record<string, { path: string; tested: boolean; note?: string }> = {
  'waveshare-epd-2.13-v4|waveshare-esp32-epaper-driver': {
    path: 'firmware/epd213/device',
    tested: true,
    note: 'Its panel may be the older V2 (ribbon HINK-E0213A22, controller IL3897): that build drives the V2, which is what the driver boards Bench has seen carry. If partial refreshes flash the whole screen, the panel is the other generation: rebuild with `-DEPD_PANEL=4`.',
  },
  'waveshare-esp32-c6-lcd-1.47|waveshare-esp32-c6-lcd-1.47': {
    path: 'firmware/c6-lcd147/device',
    tested: true,
    note: 'Its first build downloads and compiles ESP-IDF to rebuild the Arduino core with more RAM for apps (several minutes); `firmware/c6-lcd147/device-prebuilt-core` is the same firmware on the prebuilt core, quicker to build with less memory for apps. If the serial port doesn\'t show up, I hold BOOT while plugging it in.',
  },
  'waveshare-esp32-s3-touch-lcd-2|waveshare-esp32-s3-touch-lcd-2': {
    path: 'firmware/s3-lcd2/device',
    tested: true,
    note: 'If the serial port doesn\'t show up, I hold BOOT while pressing RST. Keep the board still for the first second after it boots: the IMU measures its gyro drift then.',
  },
  'seeed-xiao-round-display|seeed-xiao-esp32s3-round-display': {
    path: 'firmware/xiao-round/device',
    tested: true,
    note: 'Check with me that the display\'s power switch (on its rim) is on: it cuts the display\'s power even on USB, and the screen stays dark. If the serial port doesn\'t show up, I hold B (BOOT) on the XIAO while pressing R.',
  },
  'guition-esp32-s3-4848s040|guition-esp32-s3-4848s040': {
    path: 'firmware/guition-4848s040/device',
    tested: false,
    note: 'It compiles but hasn\'t run on hardware yet. Its USB-C goes through a CH340, so the port is `/dev/cu.usbserial-…` or `/dev/cu.wchusbserial-…`; BOOT and RST sit inside the case. Check with me that the status screen fills the glass the right way up, then that the picture stays put after the first app is pushed (saving it writes flash). If anything looks wrong, flash stage 1 (`firmware/guition-4848s040/device-no-resident`) and go through its test card with me, as the README says.',
  },
  'waveshare-epd-2.13-v4|esp32-s3-devkitc-1-n16r8': {
    path: 'firmware/epd213/device-s3',
    tested: false,
    note: 'It compiles but hasn\'t run on hardware yet: wire it as its README says and go through its first-flash checklist with me (PSRAM reported, orientation, partial refreshes in place, BOOT taps).',
  },
};

/** What bringing up Resident on real boards has taught, for hardware without firmware yet. */
const DISPLAY_LESSONS = [
  '- Push only what changed: each LVGL flush its own rectangle, an `lgfx`/`screen` flip only the rows drawn since the last one (a canvas subclass that records them). On the S3-Touch-LCD-2 that, LVGL\'s draw buffer in internal RAM and `-O2` took a flame from 3.4 to 28 fps; `firmware/s3-lcd2/device/lib/drivers/src/Lcd.cpp` in Bench\'s repo does it. Check the glass after changing the panel driver: an esp_lcd DMA driver completed every transfer and showed nothing.',
  '- `flip()` must not wait for a slow panel: Resident aborts a Lua dispatch after 1 s. Snapshot the frame, return, and refresh from the driver\'s `update()`; for e-paper, one refresh at a time, newest frame wins, skip a frame identical to the one on the glass.',
  '- With `lvgl`, stop the outgoing app\'s `lvgl.Timer`s on every app reset: Resident keeps one Lua state for the board\'s life and luavgl keeps timers in its registry, so they outlive their app and call into its deleted objects (an error box on the screen, not on serial). `LvglTimerReaper.h` in Bench\'s S3-Touch-LCD-2 firmware (`firmware/s3-lcd2/device/lib/drivers/`) does it.',
  '- On a 1-bit panel, give the `lgfx` module a `Resident::LgfxTarget` that draws into the same 1-bit canvas as `screen` (luminance >= 50% is white) instead of a full RGB565 sprite.',
];
const LESSONS = [
  '- Check the real part against Bench\'s profile before trusting it: read the ribbon or the back sticker (a "2.13 V4" may turn out to be a V2 with another controller). A test card that looks right can hide the wrong controller; partial refresh is what tells them apart.',
  '- Measure app memory with `heap_caps_get_free_size(MALLOC_CAP_8BIT)` and `heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)`, not `ESP.getFreeHeap()`: on a classic ESP32 that also counts IRAM Lua can\'t use. Without PSRAM about 70 KB is left once Wi-Fi and TLS are up; LVGL\'s first bind keeps ~30 KB, so leave `lvgl` out there.',
  '- Without PSRAM, give Lua a heap of its own: Resident\'s allocator takes whatever is free, and an app that grows (or just fragments the heap with small blocks) leaves TLS without the 16 KB block a reconnect needs, so the board drops off the relay and can\'t be sent the next app. Take one block before Wi-Fi starts, make it a heap with `multi_heap_register`, and point Lua at it with `lua_setallocf` from a driver\'s `registerModule` (`LuaArena.h` in Bench\'s C6 and e-paper firmware, under `firmware/*/device/lib/drivers/`, does this): an app that doesn\'t fit then fails with "not enough memory" and the board stays online.',
  '- Bench sends the time zone its apps run in before each app it mirrors, as `{ channel: "bench", type: "timezone", data: { tz } }`: register `sandbox.onMessageWithChannel("bench", …)` and call `sandbox.setTimezone(tz)`, skipping a zone already applied. A Resident `hello` would set the zone too, but it also makes the board drop un-channelled messages until reboot, which `/resident:push-app` still sends.',
  '- Opening the serial port resets a board with a USB-serial bridge (DTR/RTS); open it with both lines released, or it can stay held in reset.',
  '- Resident keeps the last app for the next boot in NVS by default, and a big app silently fails to save there (`persist_too_big`), so a reboot brings back an older one. Give the sandbox a `persistentStore` that keeps the app on a LittleFS partition (`AppStore.h` in Bench\'s S3-Touch-LCD-2 firmware), and call its `begin()` yourself: Resident only starts its own default store.',
  '- A key on a strapping pin (IO12 on the Waveshare e-Paper Driver Board) may have no pull-up of its own: enable `INPUT_PULLUP` after boot.',
  '- A touch chip\'s INT may pulse rather than stay low while touched (the Round Display for XIAO\'s CHSC6X: ~72 pulses a second, one per report): latch INT\'s falling edges with an interrupt and read the chip after one, or while a finger is down, rather than only when a poll happens to see INT low. Many touch chips don\'t answer at all while idle, so a failed read is "no finger". Give the I2C bus a short timeout (`Wire.setTimeOut`): a display board with its power switched off leaves the bus without pull-ups, and a scan hangs.',
  '- Map an IMU onto Bench\'s frame on the real board: face-up at rest accel ≈ (0, 0, +1) g, the right edge tipped down reads +x and the bottom edge +y, so a ball rolls by (ax, ay). Chips are often mounted turned (the S3-Touch-LCD-2\'s QMI8658 has x and y swapped as well as flipped), and a diagonal tilt can hide a swap: test one edge at a time. Gyros drift a few °/s at rest: average them at boot and subtract.',
  `- When it works, tell me the libraries it has and the app memory you measured, so Bench's board entry (src/sim/boards.ts in ${REPO}) lists the right apps for it.`,
];

const pins = (w: Record<string, number>) =>
  Object.entries(w)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/** The board chosen in Bench for a bare module or an LED chain, still to be confirmed. */
function chosenBoard(board: Board, what: string): string {
  return `- **Board:** a ${board.name}, my choice in Bench (${board.note}). Confirm it with me, and ask ${what} before writing code.`;
}

function hardwareSection(p: DeviceProfile, board?: Board, wired?: Wiring): string[] {
  const lines: string[] = [];
  // A bare module or LED chain wired to a dev board, as Bench's Wiring view shows it.
  const shown = wired?.output && !wired.output.wires.some((w) => w.missing) ? wiringLines({ ...wired, parts: [] })[0] : undefined;
  const dinGpio = wired?.output?.wires.find((w) => w.pin === 'DIN')?.gpio;
  const din = dinGpio !== undefined ? gpioName(wired, dinGpio) : `GPIO ${p.wiring?.DIN ?? 18}`;
  const leds = p.look.leds;
  if (leds) {
    const n = p.width * p.height;
    const shape = leds.layout === 'grid' ? `a ${p.width}×${p.height} matrix, ${chainWords(leds.chain)}` : leds.layout === 'ring' ? `a ring of ${n}` : `a strip of ${n}`;
    lines.push(
      `- **Output:** WS2812B addressable LEDs, ${shape} (${n} LEDs, 800 kHz one-wire, GRB). Bench assumes data in on **${din}** of an ESP32 board.`,
      board ? chosenBoard(board, shown ? 'whether the strip is wired as below' : 'which pin the data line is on') : '- **Board:** any ESP32 dev board. Ask me which one I have (and which pin the data line is on) before writing code.',
    );
    if (shown) lines.push(`- **Wiring, as Bench's Wiring view shows it:** ${shown}.`);
  } else {
    const turned = (p.firmwareRotation ?? 0) % 2 === 1;
    lines.push(
      `- **Display:** ${p.name}: ${p.width}×${p.height} ${p.tech.toUpperCase()} (${turned ? `apps see it as ${p.height}×${p.width}, rotation ${p.firmwareRotation}` : 'apps see it as is'}), ${p.controller} over ${p.bus.kind.toUpperCase()} at ${p.bus.hz >= 1e6 ? `${p.bus.hz / 1e6} MHz` : `${p.bus.hz / 1e3} kHz`}${p.bus.i2cAddress ? `, address 0x${p.bus.i2cAddress.toString(16)}` : ''}.`,
    );
    if (p.ram) lines.push(`- **Controller RAM:** ${p.ram.width}×${p.ram.height}; the visible area starts at x+${p.ram.offsetX}, y+${p.ram.offsetY}.`);
    if (p.wiring) lines.push(`- **Wiring (GPIO):** ${pins(p.wiring)}.`);
    else {
      const part = p.enclosure?.parts?.find((x) => x.kind === 'header');
      const header = part?.kind === 'header' ? part.label : undefined;
      lines.push(
        board
          ? `- **Module:** a bare display module${header ? ` (pins: ${header})` : ''}.`
          : `- **Board:** this is a bare display module${header ? ` (pins: ${header})` : ''}, wired to an ESP32 board. Ask me which board I have and how it's wired before writing code.`,
      );
      if (board) lines.push(chosenBoard(board, shown ? "whether it's wired as below" : "how it's wired"));
      if (shown) lines.push(`- **Wiring, as Bench's Wiring view shows it:** ${shown}.`);
    }
  }
  const buttons = (p.enclosure?.parts ?? []).flatMap((x) => (x.kind === 'button' && x.input !== undefined ? [{ label: x.label ?? 'button', input: x.input }] : []));
  if (buttons.length) lines.push(`- **Buttons:** ${buttons.map((b) => `${b.label} = button ${'AB'[b.input] ?? b.input} (index ${b.input})`).join(', ')}.`);
  if (p.builtins?.length) lines.push(`- **Also on the board:** ${p.builtins.map((b) => (b === 'imu' ? 'an IMU' : 'a buzzer')).join(' and ')}.`);
  for (const note of p.porting ?? []) lines.push(`- ${note}`);
  if (p.url) lines.push(`- Datasheet / docs: ${p.url}`);
  return lines;
}

function planSection(p: DeviceProfile, board?: Board): string[] {
  const shipped = board && BENCH_FIRMWARE[`${p.id}|${board.id}`];
  if (shipped) {
    return [
      `Bench ships firmware for this display on this board: \`${shipped.path}\` in ${REPO} (its README has the wiring, the pins and what was learnt bringing it up). It pulls Resident from GitHub, pinned to the commit it was ${shipped.tested ? 'tested on hardware' : 'built'} against.`,
      `1. Clone ${REPO} and build \`${shipped.path}\` as it is (\`pio run\`).`,
      '2. Find the board\'s port (`pio device list`), confirm it with me, then flash: `pio run -t upload`.',
      ...(shipped.note ? [`3. ${shipped.note}`, '4. Go to step "First boot" below.'] : ['3. Go to step "First boot" below.']),
    ];
  }
  const env = M5_ENVS[p.id];
  if (env) {
    return [
      `Resident ships working firmware for this board: \`examples/m5stick-demo/device\` in ${RESIDENT}, PlatformIO env \`${env}\`${env === 'm5stick' ? ' (or `m5stick-lvgl` for the optional lvgl module)' : ''}.`,
      '1. Clone the Resident repo and build that example as it is (it links Resident from the repo itself).',
      '2. Find the board\'s port (`pio device list`), confirm with me, then flash: `pio run -e ' + env + ' -t upload`.',
      '3. Go to step "First boot" below.',
    ];
  }
  const c6 = /esp32-c6/i.test(p.id);
  const lines = [
    `Follow Resident's guide for new hardware, written for coding agents: ${START_BUILDING}. It has three flashable stages; do them in order and check each with me on the real board before the next:`,
    '1. **Bring-up, no Resident:** the smallest PlatformIO project that boots, prints chip info over serial and ' +
      (p.look.leds ? 'runs a rainbow across every LED (check the count and the colour order).' : 'draws a test card that proves orientation, offsets and colours (red, green, blue bars, a 1 px border on the visible edge).'),
    '2. **Add Resident:** Wi-Fi through WiFiManager\'s captive portal, the WebSocket to `resident.inanimate.tech` at `/devices/<deviceId>` (the guide\'s `onTransportsWillConnect` override), and a status screen showing WiFi → Connecting → Connected → the **device ID**.',
    '3. **Add drivers** (one `Resident::Driver` each, in `lib/drivers/`) so Bench\'s apps run unchanged. Bench\'s device skill is the surface to match: ' +
      DEVICE_SKILL +
      (p.look.leds
        ? '. Implement its `leds` module exactly (`count`, `width`, `height`, `xy`, `set`, `set_rgb`, `get`, `fill`, `clear`, `hsv`, `brightness`, `show`, and `on_frame(fn, fps)` as a frame timer calling the app between ticks; if Resident can\'t call into Lua from a driver timer, say so and document `on_tick` as the fallback).' +
          (p.look.leds.layout === 'grid'
            ? ` Then \`lgfx\` on the matrix, as Bench has it: a ${p.width}×${p.height} canvas (one pixel per LED) whose \`flip()\` copies each pixel to its LED through \`xy\` and shows the chain, so Bench's matrix apps that draw text and shapes run unchanged.`
            : '')
        : '. Start with `screen` (the M5Stick drawing calls) on a full-frame canvas pushed in one transfer by `flip()`, then the board\'s buttons as `tap` / `hold` events, then `lgfx` (the LovyanGFX-style calls Bench apps use). ' +
          (p.touch
            ? `Then the ${p.touch.controller} touch panel as Bench's \`touchscreen\` module: \`read()\` returning \`{ pressed, x, y }\` in the coordinates apps draw in, and \`touch_down\` / \`touch_move\` (at most one per loop) / \`touch_up\` / \`touch_tap\` driver events with \`{ x, y }\` (a tap: released within 500 ms, moved under 10 px). `
            : '') +
          lvglAdvice(board)),
    '',
    'Practicalities:',
    '- Install PlatformIO if it\'s missing (`brew install platformio` or `pipx install platformio`). Put the project in a new folder here, and clone Resident next to it for the `symlink://` lib_dep, as its examples do.',
    '- Resident builds as C++17 (`build_unflags = -std=gnu++11`, `build_flags = -std=gnu++17`), and its firmware is about 1.2 MB: give it a custom `partitions.csv` with a big enough app slot.',
  ];
  if (c6) {
    lines.push(
      '- **ESP32-C6:** the `espressif32@6.x` platform in Resident\'s examples is too old for the C6. Use pioarduino (Arduino core 3.x): `platform = https://github.com/pioarduino/platform-espressif32/releases/download/stable/platform-espressif32.zip`, board `esp32-c6-devkitc-1`.',
      `- Resident's libraries need three fixes on core 3.x, all in \`firmware/c6-lcd147/\` in ${REPO}: Courier's \`esp_websocket_client\` from Espressif's component registry (ESP-IDF 5 moved it out of the core), \`<string>\` force-included for Esp32Lua's C++ wrapper, and Esp32Lua's standalone \`lua.c\`/\`luac.c\` left out of the build (\`core3.py\`). Core 3.x already compiles C++17 and newer, so skip the \`gnu++17\` flags.`,
      '- The C6 has 512 KB of SRAM and no PSRAM: a full RGB565 frame competes with Wi-Fi, TLS and Lua for it. Rebuilding the core with less code in IRAM (pioarduino\'s `custom_sdkconfig`) frees ~36 KB.',
      '- It has native USB: add `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1` or serial stays silent. If the port doesn\'t show up, I hold BOOT while plugging it in.',
    );
  }
  if (board?.id === 'seeed-xiao-esp32s3') {
    lines.push(
      '- **XIAO ESP32S3:** PlatformIO board `seeed_xiao_esp32s3` (8 MB flash, 8 MB octal PSRAM). Its pins are printed D0–D10, not GPIO numbers: the wiring above gives both.',
      '- It has native USB only: add `-DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1` or serial stays silent. If the port doesn\'t show up, I hold B (BOOT) while plugging it in.',
    );
  }
  lines.push('- Flashing replaces whatever is on the board: confirm the port with me before the first upload.');
  lines.push('', 'Lessons from boards Bench has already brought up:', ...(p.look.leds ? [] : DISPLAY_LESSONS), ...LESSONS);
  return lines;
}

function lvglAdvice(board?: Board): string {
  if (!board || board.appRamKb === undefined) return 'The `lvgl` module (luavgl) is optional: only if memory allows.';
  return board.libraries.includes('lvgl')
    ? `Then \`lvgl\` (luavgl, as Resident's \`m5stick-lvgl\` env does it): Bench lists LVGL apps for this board.`
    : 'Skip `lvgl`: this board has no PSRAM and LVGL doesn\'t fit next to Wi-Fi and TLS; Bench lists only `screen` and `lgfx` apps for it.';
}

/** The parts I added to the bench, wired to the board as Bench's Wiring view shows them. */
function partsSection(wired?: Wiring): string[] {
  if (!wired?.parts.length || !wired.pinout) return ['- Sensors and controls (encoder, PIR, light …) come from Bench while it mirrors, so the firmware needs no drivers for them.'];
  const lines = wiringLines({ ...wired, output: undefined });
  return [
    '- **Parts on my bench**, wired as Bench\'s Wiring view shows them. While Bench mirrors, their readings come from Bench, so the firmware needs no drivers for them; if I ask for the real parts to work on their own, put their drivers on exactly these pins:',
    ...lines.map((l) => `  - ${l}`),
    ...[...(wired.pinout.notes ?? []), ...wired.problems].map((p) => `  - ${p}`),
  ];
}

/**
 * The firmware prompt, as Markdown. `board`: the board chosen in Bench for a bare module or LEDs.
 * `hardware`: what's on the bench (`Bench.hardware()`), for the pins its parts go to.
 */
export function firmwarePrompt(device: DeviceProfile, board?: Board, hardware: (PartSpec & { builtin: boolean })[] = []): string {
  const wired = board ? wiring(device, board, hardware) : undefined;
  return [
    `Put Resident firmware on my ${device.look.leds ? `ESP32 driving a ${device.name}` : device.name}, so it comes online on Resident's relay with a device ID. I'll then drive it from porous.systems Bench (${SITE}): its Real device panel mirrors an app onto the device and streams the virtual inputs to it.`,
    '',
    '## The hardware (from Bench)',
    ...hardwareSection(device, board, wired),
    ...partsSection(wired),
    '',
    '## Plan',
    ...planSection(device, board),
    '',
    '## First boot',
    '- The board opens a "Resident …" Wi-Fi hotspot: tell me to join it from my phone and enter my Wi-Fi. Then watch the serial monitor (`pio device monitor`) until it connects and prints its device ID.',
    '- Tell me the device ID. In Bench I paste it into **Real device** and press **Mirror**.',
    board && BENCH_FIRMWARE[`${device.id}|${board.id}`]
      ? `- Its \`DEVICE-SKILL.md\` (next to its \`platformio.ini\`) lists exactly which modules it has: use it when writing apps for it.`
      : '- Write a `DEVICE-SKILL.md` for this firmware (the Resident plugin\'s write-device-skill skill does this), listing exactly which modules it has, so apps can be written for it.',
    '',
    '## Rules',
    '- Ask me before anything that touches the hardware (flashing, erasing) and whenever a pin or board detail isn\'t certain.',
    '- Keep each stage buildable; if a later one breaks, go back to the last one that worked.',
    '',
  ].join('\n');
}
