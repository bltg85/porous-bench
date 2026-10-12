# Resident on the Waveshare ESP32-S3-Touch-LCD-2

Firmware that puts the Waveshare ESP32-S3-Touch-LCD-2 on Resident's relay, so porous.systems Bench
can mirror apps onto it. One PlatformIO project per stage of Resident's start-building guide, each
buildable on its own; Resident is pinned by commit (0.10.2, `ecabf22`), so nothing needs cloning.

```
device-no-resident/       stage 1: chip info, a test card, I2C scan, touch crosshair
device-minimal-resident/  stage 2: Wi-Fi portal, WebSocket to the relay, status and device ID
device/                   stage 3: the drivers; DEVICE-SKILL.md and check apps in device-apps/
```

Build and flash a stage with `pio run -t upload` in its folder. The board shows up as a USB
Serial/JTAG port (`/dev/cu.usbmodem…`); if it doesn't, hold BOOT while pressing RST.

## What stage 3 gives apps

`screen` (M5Stick verbs), `lgfx` (LovyanGFX-style), `lvgl` (LVGL 9 via luavgl), `button` (BOOT:
`tap` / `hold`), `touchscreen` (CST816D: `read()`, `touch_*` events), `imu` (QMI8658), `screens`
(`"main"`: 240×320, 16-bit, dark, brightness). Lua and LVGL live in the 8 MB PSRAM. Bench's board
entry (`waveshare-esp32-s3-touch-lcd-2`: screen, lgfx, lvgl, 8192 KB) matches: with LVGL bound and an
app running, ~8.1 MB of PSRAM and ~204 KB of internal RAM stay free (measured).

Brought up and tested on hardware 2026-10-12: device type `s3-lcd2`, firmware `s3-lcd2-0.1`.

## What bring-up taught

- **Chip:** ESP32-S3 (QFN56) rev v0.2, 8 MB embedded octal PSRAM (`qio_opi`), 16 MB flash, on
  espressif32@6.12.0 (Arduino core 2.0.17). Native USB only: `ARDUINO_USB_MODE=1` and
  `ARDUINO_USB_CDC_ON_BOOT=1`, or Serial stays silent.
- **Panel:** Adafruit's ST7789 driver at `init(240, 320)` sends SWRESET (the LCD's reset isn't wired,
  so the pin is -1) and INVON, with no RAM offset. Rotation 2 (MADCTL 0x00) is the panel's native
  scan: USB-C at the bottom. Colours, edges and orientation checked on a test card.
- **The frame:** `screen`, `lgfx`, LVGL and the status text share one 240×320 RGB565 canvas (150 KB,
  in PSRAM). Adafruit's driver pushed a full frame in ~25 ms, blocking; stage 3 uses ESP-IDF's
  pushes only what changed instead (see "Speed" below).
- **Backlight:** GPIO1, PWM at 10 kHz, 10-bit, as Waveshare runs it; dark until driven.
- **I2C (SDA 48, SCL 47, 400 kHz):** touch at 0x15, IMU at 0x6B, and an unlisted device at 0x7E
  that nothing here uses.
- **Touch (CST816D, chip ID 0xB6):** polled every 10 ms, INT and RST unused. Its coordinates are the
  picture's: a crosshair drawn at the reported point sits under the finger.
- **IMU (QMI8658):** reads the first samples as zeros right after it's turned on (wait ~80 ms). Its
  axes don't line up with the screen's: face-up it reads z = -1 g, the right edge tipped down reads
  chip -y and the bottom edge chip +x, so x and y swap as well as change sign. A first fix that only
  flipped signs looked right for diagonal tilts and was wrong; `device-apps/imu-check.lua` walks
  through each tilt and a turn and logs what the IMU saw, which settled it. Bench's frame (x right,
  y down the screen, z out of it) is mirror-image to the chip's, so the gyro gets its own mapping
  (`ImuDriver.cpp`): gx is the rate the bottom edge tips down, gy minus the rate the right edge does
  (as Bench's `imu.ts`), gz positive turning counter-clockwise seen from above. The gyro drifts a few
  °/s at rest (-4 on one axis): the driver averages half a second at boot and subtracts it, so keep
  the board still while it starts. Lying on a desk it reads ~0.06 g of tilt, so a tilt-ball app's
  ball drifts slowly to an edge where Bench's would sit still.
- **LVGL timers outlive their app.** Resident keeps one Lua state for as long as the board runs and
  luavgl keeps each `lvgl.Timer` in its registry; an app reset deletes the old app's objects but not
  its timers. Mirroring the flame a second time left the first one's 30 fps timer calling into
  deleted objects ("expect lua lvgl object, got null", which luavgl draws as a box on the screen, not
  on serial) and holding its memory. `LvglTimerReaper.h` stops them on every app reset with
  luavgl's own `delete`. Bench runs each app in a fresh Lua state, so the browser never shows it.
  Not fixed in Resident 0.10.2 or its main branch.
- **Battery:** GPIO5 (ADC1 channel 4) through a divider; stage 1 shows the pin's millivolts, and
  there's no driver for it.
- **Wi-Fi:** the factory firmware left a saved network (`WSTEST`); WiFiManager tried it for 20 s, then
  opened the `Resident S3-lcd2 <id>` portal.
- **Device ID:** `b4df8785` (from the MAC, 28:84:85:87:DF:B4).

## Speed: the flame from 3.4 to 29 fps

Mirroring `my-apps/flame.lua` (then 34 LVGL ovals, gradients, shadows and a translucent glow) ran
at 3.4 fps here against 30 on Bench. Measured over serial with a frame counter in the app and the
firmware's `[perf]` line (pushes a second, rows a push, push time, loop time):

| Change | fps |
|---|---|
| Start: 34 ovals, shadows, 6-oval glow; every LVGL frame pushed the whole 150 KB canvas | 3.4 |
| App: integer colour blends, fewer ovals, colours sent only when they change, no shadows | 5.5 |
| Firmware: LVGL's draw buffer in internal RAM (80 rows, was 32 in PSRAM); each flush pushes only its rectangle | 6.7 |
| App: glow and room follow the steady light, not each flicker | 10.9 |
| Firmware: `-O2` instead of `-Os` | 12.5 |
| Firmware: LVGL circle cache 32, style cache on | 12.9 |
| App: the glow opaque, its see-through look worked out in advance | 18.9, but 16 ovals looked lumpy; 25 smooth ones: 12 |
| App: drawn row by row with lgfx (the C6 flame's renderer), driven by an `lvgl.Timer` | 20 |
| Firmware: lgfx/screen flips push only the rows drawn; app: redraws only rows near the flame | 23 |
| App: per row, repaints only where the flame was last frame and isn't now | **28** (~30 ms a frame) |

What it taught:
- **An LVGL `:set` costs 0.2-0.65 ms here** (four properties ~0.43 ms), mostly style refresh and
  invalidation, so 25 moving ovals are ~25 ms of Lua before anything is drawn.
- **LVGL repaints everything under whatever changed.** Three big translucent glow ovals under the
  flame cost ~20 ms a frame even when they didn't move; opaque ones with the blend precomputed cost
  ~1 ms. A full-screen gradient background costs little; translucency is the expensive part.
- **Two LVGL draw threads (`LV_USE_OS` FreeRTOS, `LV_DRAW_SW_DRAW_UNIT_CNT 2`) gained nothing**, so
  they're off.
- **For many moving shapes, lgfx rows beat LVGL objects**: no per-object cost, and with the canvas
  remembering drawn rows, a flip pushes only those. An app gets LVGL's 30 fps timer by binding LVGL
  first and lgfx last (the last bind owns the screen; Resident and Bench keep running LVGL timers).
- **A DMA push in the background (ESP-IDF esp_lcd) left the screen black** on this panel, though
  the transfers completed; it measured a full flip at ~15 ms against Adafruit's 25. Pushing only
  what changed mattered more: with the flame's ~160 rows a frame, the blocking Adafruit push keeps
  28 fps too. The esp_lcd attempt is not in the tree; its likely gap is the panel init (esp_lcd's
  ST7789 sequence, not Adafruit's), worth a test at 40 MHz before trying again.
- **Doubles are software on the S3** (its FPU is single precision), as on the C6: blend colours in
  integers, build tables once, precompute per-object constants.

## Check apps (device/device-apps/)

- `driver-check.lua`: accel, gyro, temperature, touch and its events, BOOT taps and holds, the
  screen verbs, and a ball that rolls downhill; logs the accelerometer once a second.
- `lvgl-check.lua`: an LVGL arc following the x tilt, a sliding box, a label counting BOOT taps.
- `imu-check.lua`: a guided check (flat, right edge down, bottom edge down, a quarter turn left)
  that logs the accelerometer and the gyro's total turn for each step.
