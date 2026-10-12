// The boards that run Resident for an output. A display module or an LED chain is only half of the
// hardware: which drawing libraries an app gets, and how much memory it has, depend on the
// microcontroller board driving it. Profiles name the boards that can drive them (DeviceProfile.boards,
// the first is the default); bare modules and LED outputs can be driven by any of GENERIC_BOARDS.

import type { DeviceProfile } from './devices/types';

/** Drawing libraries a board's Resident firmware can offer (LED outputs bring the `leds` module). */
export type Library = 'screen' | 'lgfx' | 'lvgl' | 'leds';

export interface Board {
  id: string;
  name: string;
  /** The drawing libraries its firmware has. */
  libraries: Exclude<Library, 'leds'>[];
  /** Heap a Resident app can use, in KB, once Wi-Fi and TLS are up. Unset: not measured, not checked. */
  appRamKb?: number;
  /** Where appRamKb comes from, or why it's missing. */
  note: string;
}

export const BOARDS: Board[] = [
  {
    id: 'esp32-s3-devkitc-1-n16r8',
    name: 'ESP32-S3 DevKitC-1 N16R8',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'esp32-devkitc',
    name: 'ESP32 DevKitC (WROOM-32, no PSRAM)',
    libraries: ['screen', 'lgfx'],
    appRamKb: 52,
    note: 'No PSRAM: ~70 KB of heap after Wi-Fi and TLS, of which Bench\'s firmware gives Lua a 56 KB heap of its own (~52 KB free for an app) and keeps the rest for the network; too little for LVGL (measured on the same chip and firmware on the Waveshare e-Paper Driver Board).',
  },
  {
    id: 'waveshare-esp32-epaper-driver',
    name: 'Waveshare ESP32 e-Paper Driver Board',
    libraries: ['screen', 'lgfx'],
    appRamKb: 52,
    note: 'ESP32-WROOM-32, no PSRAM: ~70 KB of heap after Wi-Fi and TLS, of which Bench\'s firmware gives Lua a 56 KB heap of its own (~52 KB free for an app, measured); LVGL\'s first bind alone takes ~30 KB.',
  },
  {
    id: 'seeed-xiao-esp32s3',
    name: 'Seeed Studio XIAO ESP32S3',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB PSRAM: Lua and LVGL live there.',
  },
  {
    // The same XIAO plugged into the back of the Round Display: the display takes all its pins.
    id: 'seeed-xiao-esp32s3-round-display',
    name: 'Seeed Studio XIAO ESP32S3 (behind the Round Display)',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'm5stickc-plus2',
    name: 'M5StickC Plus2 (ESP32-PICO-V3-02)',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 2048,
    note: '2 MB PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'm5sticks3',
    name: 'M5StickS3 (ESP32-S3)',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'waveshare-esp32-s3-touch-amoled-1.32',
    name: 'ESP32-S3-PICO-1-N8R8 (on the board)',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB octal PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'waveshare-esp32-s3-amoled-1.91',
    name: 'ESP32-S3R8 (on the board)',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB octal PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'waveshare-esp32-s3-touch-lcd-2',
    name: 'ESP32-S3R8 (on the board)',
    libraries: ['screen', 'lgfx', 'lvgl'],
    appRamKb: 8192,
    note: '8 MB octal PSRAM: Lua and LVGL live there.',
  },
  {
    id: 'waveshare-esp32-c6-lcd-1.47',
    name: 'ESP32-C6 (on the board)',
    libraries: ['screen', 'lgfx'],
    appRamKb: 84,
    note: 'No PSRAM: Bench\'s firmware gives Lua an 88 KB heap of its own next to the 110 KB frame, Wi-Fi and TLS, ~84 KB free for an app (measured); too little for LVGL.',
  },
];

/** What a bare module or an LED chain can be wired to. The first is the default. */
export const GENERIC_BOARDS = ['esp32-s3-devkitc-1-n16r8', 'esp32-devkitc', 'seeed-xiao-esp32s3'];

export function findBoard(id: string): Board | undefined {
  return BOARDS.find((b) => b.id === id);
}

/** The boards that can drive this output, the default first. */
export function boardsFor(profile: DeviceProfile): Board[] {
  return (profile.boards ?? GENERIC_BOARDS).map((id) => findBoard(id)).filter((b): b is Board => !!b);
}
