# Resident on the Guition ESP32-S3-4848S040

Firmware that puts the Guition ESP32-S3-4848S040 (a 4" 480×480 touch panel for an 86 mm wall box,
with its own ESP32-S3) on Resident's relay, so porous.systems Bench can mirror apps onto it. One
PlatformIO project per stage of Resident's start-building guide, each buildable on its own; Resident
is pinned by commit (0.10.2, `ecabf22`), so nothing needs cloning.

```
device-no-resident/       stage 1: chip info, the panel's scan rate, a test card, I2C scan, touch crosshair, a flash-write test
device-minimal-resident/  stage 2: Wi-Fi portal, WebSocket to the relay, status and device ID
device/                   stage 3: the drivers; DEVICE-SKILL.md and check apps in device-apps/
device/lib/panel/         the panel (ST7701S init, the RGB scan), shared by all three stages
```

Build and flash a stage with `pio run -t upload` in its folder. The USB-C goes through a CH340
USB-serial chip, so the board shows up as `/dev/cu.usbserial-…` or `/dev/cu.wchusbserial-…`, not as
a USB Serial/JTAG port, and auto-reset flashes it without touching a key (BOOT and RST are inside the
case). Give it a supply that holds 5 V: Wi-Fi's current spikes brown it out on a weak laptop port.
On the relay versions, don't feed 5 V into header H1 and the USB-C at the same time.

**Not run on hardware yet.** Every stage compiles (espressif32@6.12.0, Arduino core 2.0.17);
everything below "What bring-up should check" is what the first board has to confirm.

## What stage 3 gives apps

`screen` (M5Stick verbs), `lgfx` (LovyanGFX-style), `lvgl` (LVGL 9 via luavgl), `touchscreen`
(GT911: `read()`, `touch_*` events), `button` (no keys: Bench's taps while it mirrors an app),
`screens` (`"main"`: 480×480, 16-bit, dark, brightness). Lua, LVGL and both frames (the canvas apps
draw in and the frame the panel is scanned from, 450 KB each) live in the 8 MB PSRAM. Bench's board
entry (`guition-esp32-s3-4848s040`: screen, lgfx, lvgl, 8192 KB) matches.

The board has no key an app can use, so the touch panel is Resident's system button: during the
boot countdown, a touch anywhere loads the saved app now and a long one forgets it.

## How the panel works, and why the firmware is built this way

- **The ST7701S has no frame memory.** It takes an init sequence over 3-wire SPI (9-bit words,
  SCK 48, MOSI 47, CS 39; bit-banged, it's sent once), then shows whatever arrives on its 16-bit RGB
  bus (R 11 12 13 14 0, G 8 20 3 46 9 10, B 4 5 6 7 15; DE 18, HSYNC 16, VSYNC 17, PCLK 21). The
  init sequence is Arduino_GFX's `st7701_type9_init_operations`, which it labels as this board's,
  from the manufacturer: it sets 0xCD to 0x00 (without it red and blue keep 4 bits, the "MDT flag"
  ESPHome users found), leaves INVON off and runs the bus 18-bit (0x3A 0x60), 16 of it wired. There
  is no reset pin: a software reset (0x01) goes first.
- **The chip scans a frame out of PSRAM continuously.** IDF 4.4's `esp_lcd` RGB driver (the one in
  Arduino core 2.0.17) owns a 450 KB frame buffer in PSRAM and streams it at a 12 MHz pixel clock,
  with Arduino_GFX's porches for this init sequence (H 10/8/50, V 10/8/20): 548 × 518 clocks a
  frame, 42.3 frames a second. Pixels go out in RGB565 as the chip stores them; no byte swap.
- **Apps draw into a canvas of their own.** `screen`, `lgfx` and the status text draw into a second
  480×480 canvas; a flip copies the rows drawn since the last one into the scanned frame
  (`esp_lcd_panel_draw_bitmap`, which also writes the cache back so the scan sees them). Drawing
  straight into the scanned frame would show every half-drawn frame. LVGL's flushes land in the
  canvas and its frame goes out whole when LVGL says it's done.
- **Flash writes and the scan.** Writing flash stops the cache, and the PSRAM the scan reads from
  with it. On these RGB boards that is known to make the picture flicker or scroll (users of Tasmota
  and ESPHome report it during OTA and saves), and on IDF 4.4 a scan that loses its place can stay
  shifted. IDF 4.4 has no
  bounce buffers and no way to resynchronise the scan, so after every app save (and forget) the
  firmware tears the scan down and starts it again, then copies the canvas back: `Lcd::resync()`,
  a blink of black. Whether it's needed, and enough, is the first thing to check.
- **Touch: GT911 at 0x5D** on SDA 19, SCL 45 (a strapping pin), 400 kHz, pull-ups on the board. INT
  and RST aren't wired, so the address is whatever the board's straps make it and the chip is
  polled every 10 ms: status at 0x814E (bit 7: report ready, bits 0-3: fingers), the first finger
  at 0x8150, and 0 written back to hand the buffer over. A touch with no report for 200 ms counts as
  released.
- **Backlight:** PWM on GPIO38 at 150 Hz, 10-bit, as ESPHome runs it (others use 100 Hz). It stays
  off until the panel has started, so the power-on noise never shows.
- **Chip:** ESP32-S3, 16 MB quad flash, 8 MB octal PSRAM (`qio_opi`). PlatformIO's
  `esp32-s3-devkitc-1` with the flash size and memory type overridden; Serial is UART0 through the
  CH340 (no `ARDUINO_USB_CDC_ON_BOOT`). The 16 MB holds one 4 MB app slot and ~12 MB of LittleFS.
- **Saved apps** go to `/app.lua` on LittleFS (`AppStore.h`, as on the S3-Touch-LCD-2: NVS is too
  small for big apps).

## What bring-up should check

Stage 1's card and serial log answer most of it:

1. **The picture:** a 1 px white border on all four edges and a magenta square in each corner. A
   missing edge or a black band means the porches are off (try ESPHome's H 8/10/20, V 8/10/10 in
   `RgbPanel.cpp`).
2. **Orientation:** "TOP" at the top with the USB-C on the right is what the sources say. If not,
   say where the USB-C is; Bench's profile and DEVICE-SKILL.md follow the board.
3. **Colours:** red, green and blue bars labelled correctly (swapped red and blue = data pin order),
   not inverted (= INVON), and four smooth ramps (banding in red and blue only = 0xCD didn't take).
4. **Touch:** the crosshair sits under the finger, in the same corner. If x and y are swapped or
   mirrored, transform them in `TouchDriver.cpp` and in stage 1. If nothing answers at 0x5D, the I2C
   scan line says what does (0x14 is the GT911's other address).
5. **The scan rate** (`[lcd] scanning at … Hz`, ~42 expected) and **the frame copy time** (a full
   480×480 frame, PSRAM to PSRAM): that's the cost of a full-screen flip.
6. **Flash writes:** tap FLASH (256 KB to LittleFS, as a big app save) and watch the picture. If it
   slips, tap RESTART: if that puts it back, `Lcd::resync()` is the right remedy; if the picture
   never slips, it can go. If it slips during Wi-Fi traffic too, the pixel clock comes down (8 MHz).
7. **Backlight:** the ramp at start is smooth, no whine at low duty.

Then stage 2 (the device ID shows up, a touch during the countdown loads the saved app) and stage 3
with `device-apps/driver-check.lua` and `lvgl-check.lua`, and its heartbeat (`[perf]`: pushes a
second, push time, the scan rate) and memory lines.

## Check apps (device/device-apps/)

- `driver-check.lua`: touch and its events (a crosshair, a ball chasing the finger), a DIM box to
  tap, the screen verbs, a border on the outermost pixels.
- `lvgl-check.lua`: an LVGL arc that follows a finger round the dial, a sliding box, a label
  counting touch taps.

Push one without Bench through the relay:

```sh
node -e 'fetch("https://resident.inanimate.tech/devices/<id>/send", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channel: "system", type: "app", description: "driver-check",
    code: require("fs").readFileSync("device/device-apps/driver-check.lua", "utf8") }) })
  .then((r) => console.log(r.status))'
```

## Sources

- Pins and timing: ESPHome's device page for the Guition-ESP32-S3-4848S040 and its photo of the
  connectors; Arduino_GFX's `Arduino_GFX_dev_device.h` (`ESP32_4848S040_86BOX_GUITION`) and its init
  sequence.
- Touch: rzeldent's `esp32-4848S040CIY1.json` and Tasmota's autoconf (GT911 at 0x5D, INT and RST not
  connected).
- Flicker during flash writes: Michiel van der Wulp's notes on the board, the Tasmota discussion
  (#20527) and TNTLarsn's ESPHome config.
