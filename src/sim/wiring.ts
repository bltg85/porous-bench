// Wiring: where each part on the bench goes on a real board, so the bench can be built on a desk.
// A part kind carries the pins of the module Bench draws for it (a KY-040's CLK, DT, SW, + and GND);
// a board lists the GPIOs its headers reach and what each can do. Parts take pins in bench order,
// each pin the free GPIO that fits with the least to spare (a button leaves the ADC pins to the
// pots), so the same bench always wires the same way and adding a part moves no wire.

import { type Board, GENERIC_BOARDS } from './boards';
import type { PartKind, PartSpec } from './controls/bench';
import type { DeviceProfile } from './devices/types';

/** What a part's pin needs from the GPIO it goes to. */
export type Need =
  /** A digital input the part drives (an input-only pin will do). */
  | 'in'
  /** A switch to GND: an input with the chip's pull-up. */
  | 'pullup'
  /** Driven by the board, or both ways (DHT22 data). */
  | 'out'
  /** An analog voltage, on ADC1: an ESP32's ADC2 stops reading once Wi-Fi is up. */
  | 'adc'
  /** A capacitive touch channel. */
  | 'touch'
  /** The I2C bus, shared by every part on it. */
  | 'sda'
  | 'scl';

export type Rail = '3V3' | '5V' | 'GND';

export interface ModulePin {
  /** As printed on the module. */
  name: string;
  /** Where it goes; null: leave it unconnected. */
  to: Need | Rail | null;
  note?: string;
}

export interface Module {
  /** The module Bench draws for the part. */
  name: string;
  pins: ModulePin[];
  /** What to know before powering it up. */
  notes?: string[];
}

export const MODULES: Record<PartKind, Module> = {
  button: {
    name: '12 mm tactile switch',
    pins: [
      { name: '1', to: 'pullup' },
      { name: '2', to: 'GND' },
    ],
    notes: ['Reads LOW while pressed (INPUT_PULLUP). On a four-legged switch, use two legs diagonally across.'],
  },
  knob: {
    name: 'KY-040 rotary encoder',
    pins: [
      { name: 'CLK', to: 'pullup' },
      { name: 'DT', to: 'pullup' },
      { name: 'SW', to: 'pullup' },
      { name: '+', to: '3V3' },
      { name: 'GND', to: 'GND' },
    ],
    notes: ['Power it from 3V3, not 5V: its pull-ups go to +, and an ESP32 pin takes 3.3 V at most.'],
  },
  pot: {
    name: 'Slide potentiometer, 10 kΩ',
    pins: [
      { name: 'VCC', to: '3V3' },
      { name: 'OUT', to: 'adc' },
      { name: 'GND', to: 'GND' },
    ],
    notes: ['From 3V3, so the wiper stays within what the ADC reads.'],
  },
  touch: {
    name: 'Touch pad',
    pins: [{ name: 'PAD', to: 'touch' }],
    notes: ['One wire, as short as you can make it: the pin senses the pad\'s capacitance.'],
  },
  imu: {
    name: 'MPU-6050 IMU (GY-521)',
    pins: [
      { name: 'VCC', to: '3V3' },
      { name: 'GND', to: 'GND' },
      { name: 'SCL', to: 'scl' },
      { name: 'SDA', to: 'sda' },
    ],
    notes: ['I2C address 0x68 (AD0 low).'],
  },
  ld2410: {
    name: 'HLK-LD2410C radar',
    pins: [
      { name: 'VCC', to: '5V' },
      { name: 'GND', to: 'GND' },
      { name: 'TX', to: 'in', note: 'the board\'s UART RX' },
      { name: 'RX', to: 'out', note: 'the board\'s UART TX' },
      { name: 'OUT', to: 'in' },
    ],
    notes: ['5 V supply, 3.3 V serial at 256 000 baud: TX goes to the board\'s RX and RX to its TX. An ESP32 routes a second UART to any free pins.'],
  },
  pir: {
    name: 'HC-SR501 PIR',
    pins: [
      { name: 'VCC', to: '5V' },
      { name: 'OUT', to: 'in' },
      { name: 'GND', to: 'GND' },
    ],
    notes: ['It needs 4.5 V or more, so 5V; OUT is 3.3 V, safe for the pin.'],
  },
  light: {
    name: 'LDR light sensor module',
    pins: [
      { name: 'VCC', to: '3V3' },
      { name: 'GND', to: 'GND' },
      { name: 'DO', to: null },
      { name: 'AO', to: 'adc' },
    ],
    notes: ['AO carries the light level; DO (the comparator) isn\'t needed.'],
  },
  climate: {
    name: 'DHT22 temperature / humidity',
    pins: [
      { name: 'VCC', to: '3V3' },
      { name: 'DATA', to: 'out' },
      { name: 'NC', to: null },
      { name: 'GND', to: 'GND' },
    ],
    notes: ['A bare DHT22 needs 10 kΩ from DATA to VCC; on a three-pin module it\'s already there.'],
  },
  buzzer: {
    name: 'Passive piezo buzzer',
    pins: [
      { name: '+', to: 'out' },
      { name: '−', to: 'GND' },
    ],
    notes: ['Passive: the board makes the tone (`tone()` or `ledcWriteTone`).'],
  },
};

/** A touch pad on a chip without touch sensing (the ESP32-C6): a TTP223 module does the sensing. */
const TTP223: Module = {
  name: 'TTP223 touch module',
  pins: [
    { name: 'VCC', to: '3V3' },
    { name: 'I/O', to: 'in' },
    { name: 'GND', to: 'GND' },
  ],
  notes: ['This chip has no touch sensing: the TTP223 senses the pad and drives I/O high while it\'s touched.'],
};

// ---- boards --------------------------------------------------------------------------------

export interface Gpio {
  gpio: number;
  /** On ADC1 (channel). */
  adc?: number;
  /** Capacitive touch channel. */
  touch?: number;
  /** No output and no pull-up (an ESP32's 34–39). */
  inputOnly?: boolean;
  /** Usable, but handed out only when nothing else fits (a serial port's pin). */
  last?: boolean;
}

export interface Pinout {
  /** The GPIOs free for parts, in the order to hand them out (one header before the other). */
  pins: Gpio[];
  /**
   * The I2C bus for sensors (and an I2C display). `own`: what the board itself has on it; its pins
   * then carry only I2C (a button there would pull the touch panel's bus low).
   */
  i2c: { sda: number; scl: number; own?: string };
  /** A bare display module or an LED chain's pins on a dev board; `bl`: an LCD's backlight, dimmed by PWM. */
  display?: { sclk: number; mosi: number; cs?: number; dc: number; rst: number; busy?: number; bl?: number; leds: number };
  /**
   * The keys Bench's own firmware for this board reads as buttons A and B, to GND (`firmware/`).
   * `onBoard`: the board's own key; `output`: only with that output (the firmware written for it).
   */
  keys?: { gpio: number; onBoard?: string; output?: string }[];
  /** The 5 V pin as printed, if a header has one. */
  fiveVolt?: string;
  /** How the board prints a GPIO's name. */
  printed?: (gpio: number) => string;
  /** What to know about this board's pins before wiring it. */
  notes?: string[];
  /** Where the pins come from. */
  source: string;
}

const pins = (list: (number | Gpio)[]): Gpio[] => list.map((p) => (typeof p === 'number' ? { gpio: p } : p));

/** The XIAO ESP32S3's D0–D10, by GPIO. */
const XIAO_D = [1, 2, 3, 4, 5, 6, 43, 44, 7, 8, 9];

export const PINOUTS: Record<string, Pinout> = {
  'esp32-s3-devkitc-1-n16r8': {
    // The plain pins on J3 first (42–39 sit together), then J1. Left out: strapping 0, 3, 45, 46;
    // USB 19, 20; UART0 43, 44; octal PSRAM 35–37; the RGB LED (38 on v1.1, 48 on v1.0).
    // ADC1 is 1–10, touch 1–14.
    pins: pins([
      42,
      41,
      40,
      39,
      { gpio: 1, adc: 0, touch: 1 },
      { gpio: 2, adc: 1, touch: 2 },
      47,
      21,
      { gpio: 4, adc: 3, touch: 4 },
      { gpio: 5, adc: 4, touch: 5 },
      { gpio: 6, adc: 5, touch: 6 },
      { gpio: 7, adc: 6, touch: 7 },
      15,
      16,
      17,
      18,
      { gpio: 8, adc: 7, touch: 8 },
      { gpio: 9, adc: 8, touch: 9 },
      { gpio: 10, adc: 9, touch: 10 },
      { gpio: 11, touch: 11 },
      { gpio: 12, touch: 12 },
      { gpio: 13, touch: 13 },
      { gpio: 14, touch: 14 },
    ]),
    // Not Arduino's 8/9: the e-paper firmware's BUSY is on 9.
    i2c: { sda: 16, scl: 17 },
    // The e-paper pins are firmware/epd213/device-s3's.
    display: { sclk: 12, mosi: 11, cs: 10, dc: 13, rst: 14, busy: 9, bl: 15, leds: 18 },
    // firmware/epd213/device-s3: key A is BOOT, key B a button on GPIO 4.
    keys: [
      { gpio: 0, onBoard: 'the BOOT button', output: 'waveshare-epd-2.13-v4' },
      { gpio: 4, output: 'waveshare-epd-2.13-v4' },
    ],
    fiveVolt: '5V',
    source: 'Espressif ESP32-S3-DevKitC-1 user guide and ESP32-S3 datasheet',
  },
  'esp32-devkitc': {
    // Right header J3 first, then J2. Left out: strapping 0, 2, 5, 12, 15; UART0 1, 3; flash 6–11.
    // ADC2 (4, 13, 14, 25–27) stops reading once Wi-Fi is up, so only ADC1 counts.
    pins: pins([
      23,
      22,
      21,
      19,
      18,
      17,
      16,
      { gpio: 4, touch: 0 },
      { gpio: 36, adc: 0, inputOnly: true },
      { gpio: 39, adc: 3, inputOnly: true },
      { gpio: 34, adc: 6, inputOnly: true },
      { gpio: 35, adc: 7, inputOnly: true },
      { gpio: 32, adc: 4, touch: 9 },
      { gpio: 33, adc: 5, touch: 8 },
      25,
      26,
      { gpio: 27, touch: 7 },
      { gpio: 14, touch: 6 },
      { gpio: 13, touch: 4 },
    ]),
    i2c: { sda: 21, scl: 22 },
    display: { sclk: 18, mosi: 23, dc: 16, rst: 17, bl: 19, leds: 18 },
    fiveVolt: '5V',
    source: 'Espressif ESP32-DevKitC V4 user guide and ESP32 datasheet',
  },
  'seeed-xiao-esp32s3': {
    // D0–D3, D8–D10, then I2C on D4/D5 and the serial port's D7/D6 last: the chip prints its boot
    // log on D6 (GPIO 43) at reset. Every other pin has ADC1 and touch. GPIO 3 (D2) is a strap
    // only once an eFuse selects pad JTAG, which a XIAO doesn't.
    pins: pins([
      ...[1, 2, 3, 4, 7, 8, 9, 5, 6].map((g) => ({ gpio: g, adc: g - 1, touch: g })),
      { gpio: 44, last: true },
      { gpio: 43, last: true },
    ]),
    i2c: { sda: 5, scl: 6 },
    // SPI on D8 (SCK) and D10 (MOSI), DC on D9, reset on D3, backlight on D1; LED data on D0.
    display: { sclk: 7, mosi: 9, dc: 8, rst: 4, bl: 2, leds: 1 },
    fiveVolt: '5V',
    printed: (g) => `D${XIAO_D.indexOf(g)} (GPIO ${g})`,
    notes: ['The XIAO prints its pins as D0–D10: the diagram gives both names.', 'D6 and D7 are the chip\'s serial port, and it prints its boot log on D6 at reset: Bench uses them last.'],
    source: 'Seeed Studio XIAO ESP32S3 pinout and ESP32-S3 datasheet',
  },
  'seeed-xiao-esp32s3-round-display': {
    // The Round Display takes every pin: SPI on D8–D10, the LCD's CS and DC on D1 and D3, the SD
    // card's CS on D2, touch INT on D7, and, through its KE switch, the backlight on D6 and the
    // battery divider on D0. Its I2C bus on D4/D5 (touch, RTC) takes sensors and nothing else.
    pins: pins([
      { gpio: 5, adc: 4, touch: 5 },
      { gpio: 6, adc: 5, touch: 6 },
    ]),
    i2c: { sda: 5, scl: 6, own: 'the touch panel and the RTC' },
    keys: [{ gpio: 0, onBoard: "the XIAO's B (BOOT) key" }],
    fiveVolt: '5V',
    printed: (g) => `D${XIAO_D.indexOf(g)} (GPIO ${g})`,
    notes: [
      'The display takes every XIAO pin but the I2C bus (D4, D5), which an I2C sensor can share with the touch panel and the RTC; solder to the XIAO\'s pads, its pins are in the display\'s sockets.',
      'Turn the KE switch\'s 1 off and D0 is free too, without the battery reading.',
    ],
    source: 'Seeed Studio Round Display for XIAO v1.1 schematic and the XIAO ESP32S3 pinout',
  },
  'waveshare-esp32-epaper-driver': {
    // The DevKitC's header layout (J4, then J3), less the e-paper's 13–15 and 25–27, the BOOT key
    // on 0, the LED on 2, the key on 12 (to GND, a strap: measured on the board, see
    // firmware/epd213) and strapping 5. Its last three pins each side are NC.
    pins: pins([
      23,
      22,
      21,
      19,
      18,
      17,
      16,
      { gpio: 4, touch: 0 },
      { gpio: 36, adc: 0, inputOnly: true },
      { gpio: 39, adc: 3, inputOnly: true },
      { gpio: 34, adc: 6, inputOnly: true },
      { gpio: 35, adc: 7, inputOnly: true },
      { gpio: 32, adc: 4, touch: 9 },
      { gpio: 33, adc: 5, touch: 8 },
    ]),
    i2c: { sda: 21, scl: 22 },
    // firmware/epd213/device: key A is the IO12 key; there is no key B.
    keys: [{ gpio: 12, onBoard: 'the IO12 key' }],
    fiveVolt: '5V',
    source: 'Waveshare e-Paper ESP32 Driver Board V3 schematic, and the board itself (firmware/epd213)',
  },
  'waveshare-esp32-c6-lcd-1.47': {
    // The right row, then the left. Left out: the TF card's 4 and 5, BOOT on 9, USB on 12 and 13
    // (printed as GPIO, but wired to the USB-C port), UART0 on 16 and 17. No touch on the C6.
    pins: pins([23, 20, 19, 18, { gpio: 0, adc: 0 }, { gpio: 1, adc: 1 }, { gpio: 2, adc: 2 }, { gpio: 3, adc: 3 }]),
    // Waveshare names no I2C pins: the two at the end of the right row.
    i2c: { sda: 19, scl: 18 },
    fiveVolt: '5V',
    notes: ['GPIO 12 and 13 are printed on the header, but they\'re the USB lines: leave them free or USB serial and flashing stop working.'],
    source: 'Waveshare ESP32-C6-LCD-1.47 pinout and schematic',
  },
  'm5stickc-plus2': {
    // The HAT header's G26 and G36, then the Grove port's G32 and G33. G0 is the microphone's clock.
    pins: pins([26, { gpio: 36, adc: 0, inputOnly: true }, { gpio: 32, adc: 4, touch: 9 }, { gpio: 33, adc: 5, touch: 8 }]),
    // M5Unified's external bus, on the Grove port.
    i2c: { sda: 32, scl: 33 },
    fiveVolt: '5V OUT',
    printed: (g) => (g === 36 ? 'G36/G25' : `G${g}`),
    notes: ['G36 and G25 share one HAT pin: Bench uses it as G36 (input, ADC1), so G25 must stay an input.', 'G32 and G33 are on the Grove port (yellow and white wires).'],
    source: 'M5StickC Plus2 docs and schematic',
  },
  m5sticks3: {
    // The HAT2 header, then the Grove port's G9 and G10. Left out: G0 (driven by the power chip,
    // a strap), G3 (a strap), UART0 on G43 and G44.
    pins: pins([5, 4, 6, 7, 1, 8, 2, 9, 10].map((g) => ({ gpio: g, adc: g - 1, touch: g }))),
    // M5Unified's external bus, on the Grove port.
    i2c: { sda: 9, scl: 10 },
    fiveVolt: 'Grove 5V',
    printed: (g) => `G${g}`,
    notes: ['The HAT2 header\'s EXT 5V pin is an input by default: take 5 V for parts from the Grove port, and check M5Stack\'s docs that it\'s on.'],
    source: 'M5StickS3 docs and schematic',
  },
  'waveshare-esp32-s3-touch-lcd-2': {
    // P1 from the display end, then P2. Left out: USB on 19 and 20, UART0 on 43 and 44. 47 and 48
    // are the board's own I2C bus (touch and IMU), shared with sensors and nothing else.
    pins: pins([
      { gpio: 2, adc: 1, touch: 2 },
      { gpio: 4, adc: 3, touch: 4 },
      { gpio: 6, adc: 5, touch: 6 },
      16,
      17,
      18,
      21,
      { gpio: 8, adc: 7, touch: 8 },
      { gpio: 7, adc: 6, touch: 7 },
      { gpio: 10, adc: 9, touch: 10 },
      47,
      48,
      15,
      { gpio: 13, touch: 13 },
      { gpio: 11, touch: 11 },
      { gpio: 12, touch: 12 },
      { gpio: 14, touch: 14 },
      { gpio: 9, adc: 8, touch: 9 },
    ]),
    i2c: { sda: 48, scl: 47, own: 'the touch panel and the IMU' },
    fiveVolt: '5V',
    notes: ['The header shares its pins with the camera connector: with a camera fitted, only GPIO 18 is free for parts.'],
    source: 'Waveshare ESP32-S3-Touch-LCD-2 pinout and schematic',
  },
  'waveshare-esp32-s3-touch-amoled-1.32': {
    // The SH1.0 12-pin connector: GP1, GP2 and the board's own I2C bus (touch, codec). GP0 is BOOT.
    pins: pins([{ gpio: 1, adc: 0, touch: 1 }, { gpio: 2, adc: 1, touch: 2 }, 47, 48]),
    i2c: { sda: 47, scl: 48, own: 'the touch panel and the audio codec' },
    notes: ['Everything goes through the 12-pin SH1.0 connector: two GPIOs and the I2C bus, so this board takes few parts.'],
    source: 'Waveshare ESP32-S3-Touch-AMOLED-1.32 schematic',
  },
  'waveshare-esp32-s3-amoled-1.91': {
    // H1 from the USB end, then H2. Left out: 26 and 33–37 (printed as GPIO, but the in-package
    // PSRAM's), BOOT on 0, the battery divider on 1, strapping 3, USB on 19 and 20, UART0 on 43 and
    // 44, and 16 and 17, which the docs and the schematic disagree on.
    pins: pins([
      { gpio: 2, adc: 1, touch: 2 },
      { gpio: 11, touch: 11 },
      { gpio: 12, touch: 12 },
      { gpio: 13, touch: 13 },
      { gpio: 14, touch: 14 },
      15,
      21,
      { gpio: 10, adc: 9, touch: 10 },
      { gpio: 4, adc: 3, touch: 4 },
      40,
      39,
      38,
    ]),
    i2c: { sda: 40, scl: 39, own: 'the IMU (and the touch panel, on the touch version)' },
    fiveVolt: 'VBUS',
    notes: ['GPIO 26 and 33–37 are printed on the headers, but the PSRAM inside the chip uses them: never wire to them.'],
    source: 'Waveshare ESP32-S3-AMOLED-1.91 pinout and schematic',
  },
};

// ---- wiring --------------------------------------------------------------------------------

/** One module pin and where it goes. */
export interface Wire {
  pin: string;
  /** A GPIO, a supply rail, or nothing (unconnected, or no free pin left: see `missing`). */
  gpio?: number;
  rail?: Rail;
  /** What the GPIO is for, when it isn't plain (ADC1 channel, I2C, UART). */
  role?: string;
  /** No free pin could take it. */
  missing?: boolean;
  /** From a supply of its own rather than the board: what it must deliver ("5 V, 4 A or more"). */
  supply?: string;
  note?: string;
}

export interface WiredPart {
  id: string;
  label: string;
  /** The part kind; 'output' for the display module or LED chain. */
  kind: PartKind | 'output';
  module: string;
  wires: Wire[];
  notes: string[];
}

export interface Wiring {
  board: Board;
  /** Unset: Bench doesn't know this board's headers yet. */
  pinout?: Pinout;
  /** The display module or LED chain, when it's wired rather than built into the board. */
  output?: WiredPart;
  /** The parts you added, wired. */
  parts: WiredPart[];
  /** Hardware on the board itself: nothing to wire. */
  builtins: { id: string; label: string }[];
  /** What couldn't be wired, and why. */
  problems: string[];
}

/** An LED chain shows the data pin the board's wiring uses (GPIO 18 on the Espressif dev kits). */
export function onBoard(device: DeviceProfile, board: Board): DeviceProfile {
  const din = PINOUTS[board.id]?.display?.leds;
  return device.tech === 'led' && din !== undefined && device.wiring?.DIN !== din ? { ...device, wiring: { ...device.wiring, DIN: din } } : device;
}

/** A chip without touch pins (the ESP32-C6): a touch part is a TTP223 module, on the desk too. */
export function touchByModule(boardId: string): boolean {
  const p = PINOUTS[boardId];
  return !!p && !p.pins.some((g) => g.touch !== undefined);
}

/** How a GPIO is named on this board ("GPIO 4", or "G26" on an M5Stick). */
export function gpioName(w: Wiring | Pinout | undefined, gpio: number): string {
  const p = w && 'board' in w ? w.pinout : w;
  return p?.printed?.(gpio) ?? `GPIO ${gpio}`;
}

/** What a GPIO can do, in units of what a part might need of it. Lower is plainer. */
function worth(g: Gpio, i2c: Pinout['i2c']): number {
  return (g.inputOnly ? 0 : 2) + (g.adc !== undefined ? 1 : 0) + (g.touch !== undefined ? 1 : 0) + (g.gpio === i2c.sda || g.gpio === i2c.scl ? 2 : 0) + (g.last ? 10 : 0);
}
function fits(g: Gpio, need: Need): boolean {
  switch (need) {
    case 'in':
      return true;
    case 'pullup':
    case 'out':
    case 'sda':
    case 'scl':
      return !g.inputOnly;
    case 'adc':
      return g.adc !== undefined;
    case 'touch':
      return g.touch !== undefined;
  }
}

/** A bare display module's header pin, by its printed name, on a dev board. */
function displayPin(name: string, device: DeviceProfile, p: Pinout | undefined): Omit<Wire, 'pin'> {
  const d = p?.display;
  const i2c = device.bus.kind === 'i2c';
  switch (name) {
    case 'GND':
      return { rail: 'GND' };
    case 'VCC':
      return { rail: '3V3' };
    case '5V':
      return { rail: '5V' };
    case 'BLK':
      // PWM on its pin dims the backlight, as apps do in Bench; no pin, and it's always on.
      return d?.bl !== undefined ? { gpio: d.bl, role: 'backlight PWM' } : { rail: '3V3', note: 'backlight always on' };
    case 'SCL':
      return i2c ? { gpio: p?.i2c.scl, role: 'I2C SCL' } : { gpio: d?.sclk, role: 'SPI clock' };
    case 'SDA':
      return i2c ? { gpio: p?.i2c.sda, role: 'I2C SDA' } : { gpio: d?.mosi, role: 'SPI data' };
    case 'DIN':
      return device.tech === 'led' ? { gpio: d?.leds, role: 'LED data', note: 'through a 330 Ω resistor' } : { gpio: d?.mosi, role: 'SPI data' };
    case 'CLK':
      return { gpio: d?.sclk, role: 'SPI clock' };
    case 'CS':
      return { gpio: d?.cs };
    case 'DC':
      return { gpio: d?.dc };
    case 'RES':
    case 'RST':
      return { gpio: d?.rst };
    case 'BUSY':
      return { gpio: d?.busy };
    default:
      return {};
  }
}

/** A WS2812B at full white, mA. */
const LED_MA = 60;
/** What a dev board's 5V pin passes on from a USB port, mA. */
const USB_MA = 500;
/** LEDs one end of a strip feeds before the far end dims and turns yellow. */
const FEED_EVERY = 60;

/** The output's wiring on a dev board; undefined when the output is part of the board. */
function outputWiring(device: DeviceProfile, board: Board, pinout: Pinout | undefined): WiredPart | undefined {
  if (!GENERIC_BOARDS.includes(board.id)) return undefined;
  const header = device.enclosure?.parts?.find((x) => x.kind === 'header' && x.label);
  const names = device.tech === 'led' ? ['5V', 'DIN', 'GND'] : header?.kind === 'header' ? (header.label ?? '').split(/\s+/).filter(Boolean) : [];
  // More LEDs than USB can light at full white take their 5 V from a supply of their own.
  const n = device.tech === 'led' ? device.width * device.height : 0;
  const amps = (n * LED_MA) / 1000;
  const own = n * LED_MA > USB_MA ? `5 V, ${Math.ceil(amps)} A or more` : undefined;
  const wires: Wire[] = names.map((name) => {
    if (own && name === '5V') return { pin: name, supply: own };
    if (own && name === 'GND') return { pin: name, rail: 'GND', note: "and the supply's −" };
    const w = displayPin(name, device, pinout);
    return { pin: name, ...w, ...(w.rail || w.gpio !== undefined ? {} : { missing: true }) };
  });
  const notes =
    device.tech === 'led'
      ? [
          ...(device.porting ?? []).slice(0, 2),
          own
            ? `${n} LEDs at full white draw about ${amps.toFixed(1)} A, more than the board passes on from USB (about ${USB_MA / 1000} A): power them from a ${own} supply, join its − to the board's GND, and leave the board's 5V pin out of it.`
            : `${n} LEDs at full white draw about ${Math.round(n * LED_MA)} mA, within what the board passes on from USB.`,
          ...(n > FEED_EVERY ? [`Over ${FEED_EVERY} LEDs, feed 5 V and GND into both ends of the chain too, or the far end dims and turns yellow at full white.`] : []),
        ]
      : device.bus.kind === 'i2c'
        ? [`On the I2C bus at 0x${(device.bus.i2cAddress ?? 0x3c).toString(16)}, shared with any I2C sensor.`]
        : [];
  return { id: 'output', label: device.tech === 'led' ? 'LEDs' : 'Display', kind: 'output', module: device.name, wires, notes };
}

/**
 * Wire the bench to the board: the output first (when it's a module of its own), then each part
 * you added, in bench order. `hardware` is `Bench.hardware()`: built-in parts need no wires.
 */
export function wiring(device: DeviceProfile, board: Board, hardware: (PartSpec & { builtin: boolean })[]): Wiring {
  const pinout = PINOUTS[board.id];
  const output = outputWiring(device, board, pinout);
  const problems: string[] = [];
  // GPIO → who has it; the I2C bus is 'I2C', shared by everything on it. A board's own bus is
  // only ever I2C.
  const taken = new Map<number, string>();
  if (pinout?.i2c.own) for (const g of [pinout.i2c.sda, pinout.i2c.scl]) taken.set(g, 'I2C');
  for (const w of output?.wires ?? []) if (w.gpio !== undefined) taken.set(w.gpio, w.role?.startsWith('I2C') ? 'I2C' : output!.label);

  // The plainest free pin that fits; among equals, the next one along the header from this part's
  // last pin, so a part's wires sit side by side.
  const take = (need: Need, who: string, after = -1): Gpio | undefined => {
    if (!pinout) return undefined;
    if (need === 'sda' || need === 'scl') {
      const gpio = pinout.i2c[need];
      const by = taken.get(gpio);
      if (by && by !== 'I2C') return undefined;
      taken.set(gpio, 'I2C');
      return pinout.pins.find((g) => g.gpio === gpio) ?? { gpio };
    }
    const n = pinout.pins.length;
    const along = (i: number) => (i - after - 1 + n) % n;
    let best = -1;
    pinout.pins.forEach((g, i) => {
      if (taken.has(g.gpio) || !fits(g, need)) return;
      const b = pinout.pins[best];
      if (best < 0 || worth(g, pinout.i2c) < worth(b, pinout.i2c) || (worth(g, pinout.i2c) === worth(b, pinout.i2c) && along(i) < along(best))) best = i;
    });
    if (best < 0) return undefined;
    taken.set(pinout.pins[best].gpio, who);
    return pinout.pins[best];
  };

  const parts: WiredPart[] = [];
  const builtins: Wiring['builtins'] = [];
  // The keys Bench's own firmware reads: on the board, or a button of their own, first.
  const keys = (pinout?.keys ?? []).filter((k) => !k.output || k.output === device.id);
  keys.forEach((k, i) => {
    const label = `Key ${'AB'[i]}`;
    taken.set(k.gpio, label);
    if (k.onBoard) builtins.push({ id: `key-${i}`, label: `${label} (${k.onBoard})` });
    else
      parts.push({
        id: `key-${i}`,
        label,
        kind: 'button',
        module: MODULES.button.name,
        wires: [
          { pin: '1', gpio: k.gpio, role: `button ${'AB'[i]}` },
          { pin: '2', rail: 'GND' },
        ],
        notes: [...(MODULES.button.notes ?? []), `Bench's firmware for this board reads ${gpioName(pinout, k.gpio)} as ${label.toLowerCase()}, so it stays on that pin.`],
      });
  });
  for (const h of hardware) {
    if (h.builtin) {
      builtins.push({ id: h.id, label: h.label });
      continue;
    }
    const module = h.kind === 'touch' && touchByModule(board.id) ? TTP223 : MODULES[h.kind];
    let last = -1;
    const wires: Wire[] = module.pins.map((p) => {
      if (p.to === null) return { pin: p.name, note: 'not connected' };
      if (p.to === '3V3' || p.to === 'GND' || p.to === '5V') return { pin: p.name, rail: p.to, note: p.note };
      const g = take(p.to, h.label, last);
      if (!g) return { pin: p.name, missing: true, note: p.note };
      if (p.to !== 'sda' && p.to !== 'scl') last = pinout!.pins.indexOf(g);
      const role =
        p.to === 'adc' ? `ADC1 ch ${g.adc}` : p.to === 'touch' ? `touch T${g.touch}` : p.to === 'sda' ? 'I2C SDA' : p.to === 'scl' ? 'I2C SCL' : h.kind === 'ld2410' && p.name !== 'OUT' ? `UART ${p.name === 'TX' ? 'RX' : 'TX'}` : undefined;
      return { pin: p.name, gpio: g.gpio, role, note: p.note };
    });
    const short = wires.filter((w) => w.missing);
    if (pinout && short.length) problems.push(`${h.label}: no free ${needWords(module, short)} left on this board.`);
    if (wires.some((w) => w.rail === '5V') && pinout && !pinout.fiveVolt) problems.push(`${h.label} needs 5 V, and this board's headers have no 5 V pin.`);
    parts.push({ id: h.id, label: h.label, kind: h.kind, module: module.name, wires, notes: module.notes ?? [] });
  }
  if (!pinout) problems.push("Bench doesn't know which GPIOs this board's headers reach yet, so it can't pick pins: wire each to a free GPIO from the board's pinout.");
  return { board, pinout, output, parts, builtins, problems };
}

function needWords(module: Module, short: Wire[]): string {
  const kinds = new Set(short.map((w) => module.pins.find((p) => p.name === w.pin)?.to));
  if (kinds.has('adc')) return 'ADC1 pin';
  if (kinds.has('touch')) return 'touch pin';
  if (kinds.has('sda') || kinds.has('scl')) return 'I2C pins';
  return short.length > 1 ? 'GPIOs' : 'GPIO';
}

/** The wiring as plain lines, for a prompt or a printout: "Encoder 1 (KY-040 …): CLK → GPIO 4, …". */
export function wiringLines(w: Wiring): string[] {
  const one = (p: WiredPart) =>
    `${p.label} (${p.module}): ${p.wires
      .filter((x) => !x.note?.startsWith('not connected'))
      .map((x) => `${x.pin} → ${x.supply ? `its own supply (${x.supply})` : (x.rail ?? (x.gpio !== undefined ? gpioName(w, x.gpio) : '?'))}${x.role ? ` (${x.role})` : ''}`)
      .join(', ')}`;
  return [...(w.output ? [one(w.output)] : []), ...w.parts.map(one)];
}
