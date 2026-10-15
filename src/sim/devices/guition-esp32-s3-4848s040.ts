import type { DeviceProfile } from './types';

// Pins and panel timing from ESPHome's device config (devices.esphome.io, Guition-ESP32-S3-4848S040)
// and its labelled photo of the back of the board; the touch panel from rzeldent's board file and
// Tasmota's autoconf; the outline and active area from Guition's spec sheet (ESP32-4848S040
// Specifications). Not measured on a board: where the glass and the side ports sit is approximate.
export default {
  id: 'guition-esp32-s3-4848s040',
  name: 'Guition ESP32-S3-4848S040',
  tech: 'lcd',
  touch: { controller: 'GT911', i2cAddress: 0x5d },
  width: 480,
  height: 480,
  controller: 'ST7701S',
  // 16-bit RGB at 12 MHz, as ESPHome runs it: no panel RAM, the chip scans a frame out of PSRAM.
  bus: { kind: 'rgb', hz: 12_000_000 },
  boards: ['guition-esp32-s3-4848s040'],
  wiring: {
    'SPI SCK (init)': 48,
    'SPI MOSI (init)': 47,
    'LCD CS': 39,
    DE: 18,
    HSYNC: 16,
    VSYNC: 17,
    PCLK: 21,
    R0: 11,
    R1: 12,
    R2: 13,
    R3: 14,
    R4: 0,
    G0: 8,
    G1: 20,
    G2: 3,
    G3: 46,
    G4: 9,
    G5: 10,
    B0: 4,
    B1: 5,
    B2: 6,
    B3: 7,
    B4: 15,
    BL: 38,
    'Touch SDA': 19,
    'Touch SCL': 45,
    'SD CS': 42,
    'SD MISO': 41,
  },
  porting: [
    'ST7701S 4" IPS, 480×480, on a 16-bit RGB bus (R 11 12 13 14 0, G 8 20 3 46 9 10, B 4 5 6 7 15; DE 18, HSYNC 16, VSYNC 17, PCLK 21) that the ESP32-S3\'s LCD peripheral scans out of a frame buffer in PSRAM. The panel has no RAM of its own: drawing is writing to that buffer.',
    'Before RGB, the ST7701S takes an init sequence over 3-wire SPI (SCK 48, MOSI 47, CS 39; mode 3, 2 MHz). Arduino_GFX\'s st7701_type9_init_operations is written for this board; ESPHome\'s st7701s needs the extra command 0xCD 0x00, or red and blue keep only 4 bits. No INVON, colour order RGB. There is no reset pin.',
    'Pixel clock 12 MHz, H pulse/front/back porch 8/10/20, V 8/10/10 (ESPHome): a frame\'s pixels take 19 ms, 22 ms with the porches, so ~46 frames a second at most (Bench counts the pixels only). Faster clocks flicker unless the frame goes out through a bounce buffer in internal RAM; flash writes (OTA, saving) starve the scan of PSRAM bandwidth and the picture jumps.',
    'Rotation 0 has the USB-C on the right edge; ESPHome turns it 270° for a USB-C facing down.',
    'Backlight: PWM on GPIO38 (ESPHome runs it at 150 Hz, others at 100 Hz).',
    'Touch: GT911 at I2C 0x5D (SDA 19, SCL 45, a strapping pin; 400 kHz, pull-ups on the board). INT and RST aren\'t wired, so poll it. It reports in panel pixels. Expose it as Bench\'s `touchscreen` module and `touch_*` events.',
    'No user key: BOOT and RST sit inside the case, and BOOT\'s GPIO0 is a red data line once the panel runs. The side key next to the USB-C is the battery charger\'s, not a GPIO.',
    'USB-C goes through a CH340 USB-serial chip (UART0, 43/44), not native USB. It needs a strong 5 V supply: Wi-Fi\'s current spikes brown it out on a laptop port.',
    'TF card on SPI: CS 42, MISO 41, sharing SCK 48 and MOSI 47 with the panel\'s init bus.',
    'Header H1 (2×4) on the back: GPIO40, 2 and 1, UART0, 5 V and GND. The relay versions switch their relays on 40, 2 and 1 (sources disagree whether active high or low: check), and the NS4168 speaker amp shares the same three pins (I2S) once its 0 Ω links are moved.',
    'ESP32-S3, 16 MB flash, 8 MB octal PSRAM (board_build.arduino.memory_type = qio_opi). A full RGB565 frame is 480 × 480 × 2 = 450 KB: it lives in PSRAM.',
  ],
  url: 'https://devices.esphome.io/devices/guition-esp32-s3-4848s040/',
  enclosure: {
    // The front unit of the 86-box wall panel: 86.5 × 86.5 × 13.6 mm, black glass over the whole
    // face (the relay versions add a ~24 mm deep box behind, left out here). The TF slot, the USB-C
    // and the charger's key are on the right edge in the panel's native orientation; where along it
    // is approximate.
    style: 'case',
    body: { w: 86.5, h: 86.5, d: 13.6, r: 3 },
    screen: { x: 0, y: 0 },
    parts: [
      { kind: 'port', face: 'right', u: 0, v: 12, w: 2, h: 12, label: 'TF card' },
      { kind: 'port', face: 'right', u: 0, v: -2, w: 3.2, h: 9, label: 'USB-C' },
      { kind: 'port', face: 'right', u: 0, v: -14, w: 2.5, h: 4, label: 'Power key' },
    ],
  },
  look: { activeWidthMm: 71.8, activeHeightMm: 70.2 },
} satisfies DeviceProfile;
