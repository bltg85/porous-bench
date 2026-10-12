# Resident on the Seeed Studio Round Display for XIAO

Firmware that puts the Seeed Studio Round Display for XIAO, driven by a XIAO ESP32S3 plugged into
its back, on Resident's relay, so porous.systems Bench can mirror apps onto it. One PlatformIO
project per stage of Resident's start-building guide, each buildable on its own; Resident is pinned
by commit (0.10.2, `ecabf22`), so nothing needs cloning.

```
device-no-resident/       stage 1: chip info, a test card, I2C scan, RTC, touch crosshair
device-minimal-resident/  stage 2: Wi-Fi portal, WebSocket to the relay, status and device ID
device/                   stage 3: the drivers; DEVICE-SKILL.md and check apps in device-apps/
```

Build and flash a stage with `pio run -t upload` in its folder. The XIAO shows up as a USB
Serial/JTAG port (`/dev/cu.usbmodem…`); if it doesn't, hold B (BOOT) while pressing R (reset).
**The display's power switch, on its rim, must be on**, even on USB (see below).

## What stage 3 gives apps

`screen` (M5Stick verbs), `lgfx` (LovyanGFX-style), `lvgl` (LVGL 9 via luavgl), `button` (the XIAO's
B key: `tap` / `hold`), `touchscreen` (CHSC6X: `read()`, `touch_*` events), `screens` (`"main"`:
240×240 round, 16-bit, dark, brightness). Lua and LVGL live in the 8 MB PSRAM. Bench's board entry
(`seeed-xiao-esp32s3-round-display`: screen, lgfx, lvgl, 8192 KB) matches: with LVGL bound and an app
running, ~8.17 MB of PSRAM and ~163 KB of internal RAM stay free (measured).

Brought up and tested on hardware 2026-10-12: device type `xiao-round`, firmware `xiao-round-0.1`.

## What bring-up taught

- **Chip:** ESP32-S3 (QFN56) rev v0.2, 8 MB embedded octal PSRAM (`qio_opi`), 8 MB flash, on
  espressif32@6.12.0 (Arduino core 2.0.17). PlatformIO's `seeed_xiao_esp32s3` board already sets
  the PSRAM and native-USB flags.
- **The power switch cuts the display board's 3.3 V, USB or not.** With it off, the screen stays
  dark, and the I2C bus's pull-ups (on that 3.3 V) are unpowered: the first stage 1 hung in its I2C
  scan for over a minute. Every stage now gives Wire a 20 ms timeout, and stage 3's boot log says
  `NO ANSWER on I2C: is the display's power switch on?` when the RTC, which always answers, doesn't.
- **Panel:** Adafruit's GC9A01A driver as it is: `begin()` sends SWRESET (the LCD's reset is an RC on
  the board, not a pin), its init sequence (BGR) and INVON. Rotation 0 is up with the XIAO's USB-C on
  the right, as Seeed holds it; colours, the edge circle and orientation checked on a test card.
- **SPI at 80 MHz** pushes a full frame in ~18 ms and looks identical on the glass to 40 MHz (31 ms).
  Seeed's setup asks for 50 MHz, which the S3 can't make and turns into 40.
- **The frame:** `screen`, `lgfx`, LVGL and the status text share one 240×240 RGB565 canvas
  (112.5 KB, in PSRAM). Flips push only the rows drawn, LVGL's flushes only their rectangles, as in
  Bench's S3-Touch-LCD-2 firmware (`firmware/s3-lcd2`, whose drivers this is built from).
- **Backlight:** D6 (GPIO43) through a transistor, PWM at 10 kHz, 10-bit, with the KE switch's 2 on;
  with it off a pull-up keeps it at full. D6 is also UART0 TX, so the backlight flickers with the
  ROM's boot log at reset.
- **I2C (SDA D4 = GPIO5, SCL D5 = GPIO6, 100 kHz as Seeed runs it):** touch at 0x2E, the PCF8563 RTC
  at 0x51. The RTC's lost-power flag was set: there's no CR927 cell in its holder, and the firmware
  doesn't use it (the clock comes from NTP).
- **Touch (CHSC6X):** 5 bytes, no register: byte 0 is 1 while a finger is down, x in byte 2, y in
  byte 4 (byte 1's high bits: 0x00 down, 0x40 up, 0x80 contact), in the picture's own pixels (a
  crosshair drawn at the reported point sits under the finger). The chip doesn't answer while idle.
  While a finger is down, INT (D7, GPIO44) is a pulse train, ~72 falling edges a second, one per
  report, low most of the time with short high blips between them. The driver counts falling edges
  by interrupt and reads after one, while INT is low, or while a finger was down.
- **Touch stopped once.** With the first stage 3 (I2C at 400 kHz, reading only while a 10 ms poll
  saw INT low), touch died after an app was pushed while a finger was dragging, and stayed dead
  through an ESP32 reset; it came back under a build that also read the chip once a second
  regardless of INT, without a power cycle. The same push-while-dragging test with the edge latch
  and 100 kHz kept working. The cause isn't pinned down; `-DTOUCH_DEBUG` logs INT edges, polls that
  saw INT low and reads, once a second, should it happen again.
- **Opening the serial port resets the board** (`rst:0x15 USB_UART_CHIP_RESET`): reading the log
  restarts the app, which comes back from LittleFS after the boot countdown.
- **Saved apps** go to `/app.lua` on LittleFS (`AppStore.h`, as on the S3-Touch-LCD-2: NVS is too
  small for big apps). The first boot formats the partition and logs `Corrupted dir pair` and
  `mount failed` once before `[store] apps saved to LittleFS`.
- **Wi-Fi:** the portal is `Resident Xiao-round <id>`.
- **Device ID:** `6880f9a1` (from the MAC, E0:72:A1:F9:80:68).

## Check apps (device/device-apps/)

- `driver-check.lua`: touch and its events (a crosshair, a ball chasing the finger), B taps and
  holds (a hold dims the backlight), the screen verbs, a ring at the edge of the glass.
- `lvgl-check.lua`: an LVGL arc that follows a finger round the dial, a sliding box, a label
  counting B taps.

Push one without Bench through the relay:

```sh
node -e 'fetch("https://resident.inanimate.tech/devices/<id>/send", { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ channel: "system", type: "app", description: "driver-check",
    code: require("fs").readFileSync("device/device-apps/driver-check.lua", "utf8") }) })
  .then((r) => console.log(r.status))'
```
