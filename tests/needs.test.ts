import { describe, expect, it } from 'vitest';
import { residentApps } from '../src/resident-apps';
import { firmwarePrompt } from '../src/resident/firmware';
import { appNeeds, misfits, outputCaps } from '../src/resident/needs';
import { appPrompt, type PromptInput } from '../src/resident/prompt';
import { boardsFor, findBoard } from '../src/sim/boards';
import { devices, findDevice } from '../src/sim/devices';
import { ledProfile } from '../src/sim/leds';

const epaper = findDevice('waveshare-epd-2.13-v4')!;
const driverBoard = findBoard('waveshare-esp32-epaper-driver')!;
const s3 = findBoard('esp32-s3-devkitc-1-n16r8')!;

/** The bundled apps that run on this output and board. */
const runs = (profile = epaper, board = boardsFor(profile)[0]) =>
  residentApps.filter((a) => misfits(a.needs, outputCaps(profile, board)).length === 0).map((a) => a.id);

describe('app needs', () => {
  it('reads libraries from the code and the rest from the @needs line', () => {
    const n = appNeeds('-- Spin: a spinner\n-- @needs motion color 240x135\nlocal h = lvgl.bind("main")\nscreen.clear()\n');
    expect(n.output).toBe('display');
    expect(n.libraries).toEqual(['lvgl', 'screen']);
    expect(n).toMatchObject({ motion: true, color: true, min: { w: 240, h: 135 } });
    expect(n.ramKb).toBeGreaterThanOrEqual(30); // LVGL's first bind alone
    const plain = appNeeds('-- @output strip\nleds.fill(0xff0000) leds.show()\n');
    expect(plain).toMatchObject({ output: 'strip', libraries: ['leds'], motion: false, color: false });
    expect(plain.min).toBeUndefined();
  });

  it('does not take screens.get for the screen module', () => {
    expect(appNeeds('local s = screens.get("main")\nlocal g = lgfx.bind("main")\n').libraries).toEqual(['lgfx']);
  });

  it("estimates more memory for bigger apps, LVGL and datetime", () => {
    const small = appNeeds('local g = lgfx.bind("main")\n').ramKb;
    expect(appNeeds('local g = lgfx.bind("main")\n' + '-- x\nlocal a = 1\n'.repeat(400)).ramKb).toBeGreaterThan(small);
    expect(appNeeds('local g = lgfx.bind("main")\nlocal t = datetime.now()\n').ramKb).toBeGreaterThan(small + 30);
  });
});

describe('output capabilities', () => {
  it('gives e-paper no motion and no colour, and the board its libraries and memory', () => {
    expect(outputCaps(epaper, driverBoard)).toMatchObject({ output: 'display', w: 122, h: 250, color: false, motion: false, libraries: ['screen', 'lgfx'], appRamKb: 52 });
    expect(outputCaps(epaper, s3).libraries).toContain('lvgl');
  });

  it('measures the screen as apps see it', () => {
    expect(outputCaps(findDevice('m5stickc-plus2')!, findBoard('m5stickc-plus2'))).toMatchObject({ w: 240, h: 135, color: true, motion: true });
  });

  it('offers the paired boards for the e-paper module, and generic ones for bare modules and LEDs', () => {
    expect(boardsFor(epaper).map((b) => b.id)).toEqual(['waveshare-esp32-epaper-driver', 'esp32-s3-devkitc-1-n16r8']);
    expect(boardsFor(findDevice('m5stickc-plus2')!).map((b) => b.id)).toEqual(['m5stickc-plus2']);
    const generic = ['esp32-s3-devkitc-1-n16r8', 'esp32-devkitc', 'seeed-xiao-esp32s3'];
    expect(boardsFor(findDevice('ssd1306-128x64')!).map((b) => b.id)).toEqual(generic);
    expect(boardsFor(ledProfile({ kind: 'strip', count: 30 })).map((b) => b.id)).toEqual(generic);
    expect(outputCaps(ledProfile({ kind: 'strip', count: 30 }), s3).libraries).toEqual(['leds']);
    expect(outputCaps(ledProfile({ kind: 'matrix', w: 8, h: 8 }), s3).libraries).toEqual(['leds', 'lgfx']);
  });

  it('says why an app does not fit', () => {
    const caps = outputCaps(epaper, driverBoard);
    expect(misfits(appNeeds('-- @needs motion color\nlocal h = lvgl.bind("main")\n'), caps)).toEqual(['needs lvgl', 'animates', 'needs colour', 'needs ~46 KB']);
    expect(misfits(appNeeds('-- @needs 196x96\nscreen.text(40, 80, "from Resident")\n'), caps)).toEqual(['needs 196×96']);
    expect(misfits(appNeeds('-- @output matrix\nleds.show()\n'), caps)).toEqual(['written for an LED matrix']);
  });
});

describe('the App menu', () => {
  it('opens on the porous.systems logo, first on every display whose board has the memory', () => {
    expect(residentApps[0].id).toBe('porous-systems');
    for (const d of devices.filter((d) => d.tech !== 'led')) {
      for (const b of boardsFor(d)) {
        // Boards without PSRAM can't take it with the dial stand-in the encoder needs.
        if (b.appRamKb === undefined || b.appRamKb >= 1024) expect(runs(d, b)[0], `${d.id} on ${b.id}`).toBe('porous-systems');
      }
    }
  });

  it('lists only e-paper apps for the 2.13" e-paper, and only what its board can run', () => {
    // The Waveshare driver board: no LVGL, ~52 KB.
    expect(runs(epaper, driverBoard)).toEqual(['lgfx-hello']);
    // An S3 with PSRAM: Bench's adaptive LVGL apps too, still nothing that animates.
    const onS3 = runs(epaper, s3);
    expect(onS3).toEqual(expect.arrayContaining(['hello-display', 'patterns', 'characters', 'knob-menu', 'ld2410-radar', 'devil', 'lgfx-hello']));
    for (const moving of ['accel', 'bounce', 'tilt-ball', 'lvgl-motion', 'water-sim', 'rainbow']) expect(onS3).not.toContain(moving);
  });

  it('keeps colour apps to colour screens and fixed layouts to screens they fit', () => {
    const oled = runs(findDevice('ssd1306-128x64')!, s3);
    expect(oled).not.toContain('rainbow');
    expect(oled).not.toContain('hello'); // its text runs to x = 196
    expect(oled).toContain('tilt-ball');
    expect(runs(findDevice('m5stickc-plus2')!)).toEqual(expect.arrayContaining(['rainbow', 'hello', 'water-sim', 'hello-display']));
  });

  it('keeps LED apps to their LED output', () => {
    const strip = runs(ledProfile({ kind: 'strip', count: 30 }));
    expect(strip.length).toBeGreaterThan(0);
    expect(strip.every((id) => id.startsWith('led-'))).toBe(true);
    expect(runs(ledProfile({ kind: 'matrix', w: 8, h: 8 }))).toEqual(expect.arrayContaining(['led-marquee', 'led-life', 'led-plasma']));
  });

  it('leaves no bundled app without an output that runs it', () => {
    const outputs = [...devices, ledProfile({ kind: 'strip', count: 30 }), ledProfile({ kind: 'ring', count: 16 }), ledProfile({ kind: 'matrix', w: 8, h: 8 })];
    for (const app of residentApps) {
      const somewhere = outputs.some((d) => boardsFor(d).some((b) => misfits(app.needs, outputCaps(d, b)).length === 0));
      expect(somewhere, app.id).toBe(true);
    }
  });
});

describe('the round AMOLED board', () => {
  const amoled = findDevice('waveshare-esp32-s3-touch-amoled-1.32')!;

  it('runs every display app that fits 466 × 466 in colour, LVGL included', () => {
    const caps = outputCaps(amoled, boardsFor(amoled)[0]);
    expect(caps).toMatchObject({ w: 466, h: 466, color: true, motion: true, libraries: ['screen', 'lgfx', 'lvgl'] });
    expect(runs(amoled)).toEqual(expect.arrayContaining(['hello-display', 'patterns', 'tilt-ball', 'rainbow', 'hello']));
  });

  it('lists the Touch app only where there is a touch panel', () => {
    expect(appNeeds('-- @needs touch motion\nlocal g = lgfx.bind("main")\n')).toMatchObject({ touch: true, motion: true });
    expect(outputCaps(amoled, boardsFor(amoled)[0]).touch).toBe(true);
    expect(runs(amoled)).toContain('touch');
    for (const d of devices.filter((x) => !x.touch)) {
      for (const b of boardsFor(d)) expect(misfits(residentApps.find((a) => a.id === 'touch')!.needs, outputCaps(d, b))).toContain('needs a touchscreen');
    }
  });

  it('tells the app writer the glass is round AMOLED, and the firmware writer its pins and quirks', () => {
    const app = appPrompt({ device: amoled, board: boardsFor(amoled)[0], parts: [], controls: [], app: { id: 'x', name: 'x', code: '', bundled: false }, deviceId: 'sim-1', online: false });
    expect(app).toContain('466×466 pixels');
    expect(app).toContain('16-bit colour');
    expect(app).toContain('The glass is round');
    expect(app).toContain('AMOLED: every pixel emits');
    expect(app).toContain('touch panel (CST820)');
    expect(app).toContain('`touch_tap`');
    const fw = firmwarePrompt(amoled, boardsFor(amoled)[0]);
    expect(fw).toContain('CO5300 over QSPI at 40 MHz');
    expect(fw).toContain('Column offset 6');
    expect(fw).toContain('QSPI CS 10');
    expect(fw).toContain('GPIO18 (BAT_EN)');
    expect(fw).toContain("CST820 touch panel as Bench's `touchscreen` module");
    expect(fw).toContain("Follow Resident's guide");
  });
});

describe('prompts follow the board', () => {
  const base: PromptInput = {
    device: epaper,
    parts: [],
    controls: [],
    app: { id: 'resident:lgfx-hello', name: 'lgfx hello', code: '-- x', bundled: true },
    deviceId: 'sim-abc12345',
    online: false,
  };

  it('tells the app writer what the board has', () => {
    const p = appPrompt({ ...base, board: driverBoard });
    expect(p).toContain('There is no `lvgl` on this board');
    expect(p).toContain('~52 KB of heap');
    expect(p).toContain('`-- @needs motion color touch 240x135`');
    expect(appPrompt({ ...base, board: s3 })).toContain('optional `lvgl` module');
  });

  it('names the chosen board in the firmware prompt and says whether to build lvgl', () => {
    const oled = findDevice('ssd1306-128x64')!;
    const p = firmwarePrompt(oled, findBoard('esp32-devkitc'));
    expect(p).toContain('ESP32 DevKitC (WROOM-32, no PSRAM), my choice in Bench');
    expect(p).toContain('Skip `lvgl`');
    expect(firmwarePrompt(oled, s3)).toContain('Then `lvgl`');
    expect(p).toContain('Lessons from boards Bench has already brought up');
    expect(p).toContain('MALLOC_CAP_8BIT');
  });

  it("builds Bench's own firmware for the e-paper on the boards it has firmware for", () => {
    const p = firmwarePrompt(epaper, driverBoard);
    expect(p).toContain('Waveshare ESP32 e-Paper Driver Board, my choice in Bench');
    expect(p).toContain('`firmware/epd213/device` in https://github.com/sjunnesson/porous-bench');
    expect(p).toContain('tested on hardware');
    expect(p).toContain('-DEPD_PANEL=4');
    expect(p).not.toContain("Follow Resident's guide");
    expect(p).toContain('Its `DEVICE-SKILL.md`');
    const onS3 = firmwarePrompt(epaper, s3);
    expect(onS3).toContain('`firmware/epd213/device-s3`');
    expect(onS3).toContain("hasn't run on hardware yet");
  });
});
