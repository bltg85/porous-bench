import type { DeviceProfile } from './types';

// Pins from Seeed's driver (Seeed_Arduino_RoundDisplay, Seeed_GFX Setup501) and the v1.1 schematic;
// the board's outline and where its parts sit from the v1.1 Eagle board file; the glass from the
// panel's datasheet (GJX0128A4-15HY). Bus speed, orientation and touch measured on the board with
// Bench's firmware (firmware/xiao-round).
export default {
  id: 'seeed-xiao-round-display',
  name: 'Seeed Studio Round Display for XIAO',
  tech: 'lcd',
  shape: 'round',
  touch: { controller: 'CHSC6X', i2cAddress: 0x2e },
  width: 240,
  height: 240,
  controller: 'GC9A01',
  bus: { kind: 'spi', hz: 80_000_000 },
  ram: { width: 240, height: 240, offsetX: 0, offsetY: 0 },
  boards: ['seeed-xiao-esp32s3-round-display'],
  // The XIAO ESP32S3's GPIOs; the board prints them D0–D10.
  wiring: {
    'SCK (D8)': 7,
    'MISO (D9)': 8,
    'MOSI (D10)': 9,
    'LCD CS (D1)': 2,
    'LCD DC (D3)': 4,
    'BL (D6)': 43,
    'SD CS (D2)': 3,
    'I2C SDA (D4)': 5,
    'I2C SCL (D5)': 6,
    'Touch INT (D7)': 44,
    'Battery ADC (D0)': 1,
    BOOT: 0,
  },
  porting: [
    'GC9A01 round IPS LCD, 240×240, on the XIAO\'s SPI pins (SCK D8, MISO D9, MOSI D10), CS on D1, DC on D3, at 80 MHz: a full frame in ~18 ms, clean on the glass (Seeed asks for 50 MHz, which the S3 makes 40: 31 ms). Adafruit\'s GC9A01A driver works as it is (its init, BGR order, INVON); RGB565 pixels go out big-endian.',
    'Rotation 0 (Adafruit\'s) is up with the XIAO\'s USB-C on the right, as Seeed holds it, and the touch panel reports in the same pixels.',
    'The LCD\'s reset is an RC circuit on the board, not a GPIO (RST -1): reset it with the software reset command (0x01).',
    'Backlight: D6 switches it through a transistor, so PWM dims it, but only with the KE switch\'s 2 on; with it off, a pull-up keeps the backlight at full. D6 is also the chip\'s UART0 TX, so the backlight flickers with the boot log at reset.',
    'The power switch on the rim cuts the display board\'s 3.3 V even on USB: switched off, the screen stays dark and the I2C bus loses its pull-ups, so an I2C scan without a timeout hangs.',
    'Touch: CHSC6X at I2C 0x2E (SDA D4, SCL D5, 100 kHz as Seeed runs it). Read 5 bytes, no register: byte 0 is 1 while touched, x in byte 2 and y in byte 4, in panel pixels (0–239). One finger. It doesn\'t answer while idle. While touched, INT (D7) pulses ~72 times a second, low most of the time: latch its falling edges by interrupt and read after one, or while INT is low or a finger was down. Expose it as Bench\'s `touchscreen` module and `touch_*` events.',
    'PCF8563 RTC at I2C 0x51 on the same bus, kept running by a CR927 cell in the holder on the back (none fitted as shipped: it reports lost power).',
    'microSD on the display\'s SPI bus with its own CS on D2: start the display before the card.',
    'Battery on the JST 1.25 connector: its voltage, halved (470 kΩ / 470 kΩ), reaches D0 (A0) with the KE switch\'s 1 on.',
    'Round glass: only the circle of radius 120 px around the centre is visible.',
    'XIAO ESP32S3: ESP32-S3R8, 8 MB octal PSRAM (board_build.arduino.memory_type = qio_opi), 8 MB flash. A full RGB565 frame is 240 × 240 × 2 = 112.5 KB: keep it in PSRAM.',
    'Native USB only: build with -DARDUINO_USB_MODE=1 -DARDUINO_USB_CDC_ON_BOOT=1 or serial stays silent; hold B (BOOT) while pressing R (reset) if the port doesn\'t show up.',
    'One user key: the XIAO\'s B (BOOT, GPIO0, active low), button A. R is reset.',
  ],
  url: 'https://wiki.seeedstudio.com/get_start_round_display/',
  enclosure: {
    // A Ø42.8 mm board (notched at the bottom, where the panel's ribbon wraps round to the back)
    // under the Ø43 mm touch glass, 3.05 mm thick. Up is away from the notch, with the XIAO's USB-C
    // on the right, as Seeed holds it. The XIAO plugs into two 5 mm sockets on the back, its parts
    // facing out; its B and R keys sit either side of the USB-C (placement approximate). The rest is
    // where the board file puts it. Seen from the back, u runs left to right.
    style: 'pcb',
    body: { w: 42.8, h: 42.8, d: 1.6, r: 21.4 },
    module: { w: 43, h: 43, d: 3.05, r: 21.5, x: 0, y: 0 },
    screen: { x: 0, y: 0 },
    parts: [
      // The XIAO ESP32S3: sockets, its board 7.5 mm out (socket and pin spacer), the shield can and USB-C.
      { kind: 'block', face: 'back', u: -9.65, v: 7.62, w: 17.8, h: 2.5, d: 5 },
      { kind: 'block', face: 'back', u: -9.65, v: -7.62, w: 17.8, h: 2.5, d: 5 },
      { kind: 'block', face: 'back', u: -9.65, v: 0, w: 21, h: 17.8, d: 1, z: 7.5, r: 1 },
      { kind: 'block', face: 'back', u: -7.25, v: 0, w: 12.5, h: 11, d: 2.2, z: 8.5, r: 0.3 },
      { kind: 'block', face: 'back', u: -17.3, v: 0, w: 7.4, h: 9, d: 3.2, z: 8.5, r: 1.5 },
      { kind: 'button', face: 'back', u: -17.6, v: -6.6, w: 2.4, h: 3, z: 8.5, input: 0, label: 'BOOT', color: '#d8d8d8' },
      { kind: 'button', face: 'back', u: -17.6, v: 6.6, w: 2.4, h: 3, z: 8.5, label: 'RST', color: '#d8d8d8' },
      { kind: 'port', face: 'back', u: 5.7, v: 0, w: 5, h: 11.4, label: 'microSD' },
      { kind: 'port', face: 'back', u: 1.9, v: 0, w: 2.6, h: 4.1, label: 'KE switch' },
      { kind: 'port', face: 'back', u: 17.3, v: -8.5, w: 2.6, h: 6.7, label: 'Power switch' },
      { kind: 'port', face: 'back', u: 7, v: 12, w: 8.6, h: 8.6, label: 'CR927 RTC cell' },
      { kind: 'port', face: 'back', u: -19.7, v: 0, w: 3, h: 6, label: 'BAT JST 1.25' },
      { kind: 'hole', face: 'back', u: 11.8, v: -15.6, r: 1.1 },
      { kind: 'hole', face: 'back', u: -11.8, v: -15.6, r: 1.1 },
      { kind: 'hole', face: 'back', u: 0, v: 19.4, r: 1.1 },
    ],
  },
  look: { activeWidthMm: 32.4, activeHeightMm: 32.4, cornerRadiusPx: 120 },
} satisfies DeviceProfile;
