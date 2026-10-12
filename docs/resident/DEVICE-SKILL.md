# porous.systems Bench (Resident simulator board)

Bench is a browser simulator that runs Resident apps on a choice of virtual displays. Its board
surface is the M5StickC Plus2's (`screen`, `imu`, `buzzer`, `button`, two buttons) plus `lgfx`, on
whichever display the user has selected, plus Bench drivers for the hardware on its desk (`dial`,
`trigger`, `ld2410`, `light`, `pir`, `climate`, `touch`), `touchscreen` on a display with a touch
panel, and `leds` when the output is an LED chain. Apps written for the M5Stick run unchanged; apps that read
`screens.get("main")` adapt to every display.

Pass this file to the Resident plugin: `/resident:create-app --device-skill docs/resident/DEVICE-SKILL.md …`

## Hardware

**Screen** `"main"`: the selected display. Ask for its facts, never assume them:

```lua
local s = screens.get("main")   -- { name, w, h, shape, depth = 16 | 1, scheme = "dark" | "light", dpi?, brightness,
                                --   model, controller, tech = "lcd" | "amoled" | "oled" | "epaper" | "led" }  (the last three are Bench extras)
```

| Display | Size seen by apps | depth | scheme | Notes |
|---|---|---|---|---|
| M5StickC Plus2 / M5StickS3 | 240×135 (landscape) | 16 | dark | the default Resident board |
| Waveshare ESP32-C6-LCD-1.47 | 172×320 | 16 | dark | rounded corners: keep ~20 px clear |
| Waveshare ESP32-S3-Touch-LCD-2 | 240×320 | 16 | dark | touch panel (`touchscreen`); IMU |
| Waveshare ESP32-S3-Touch-AMOLED-1.32 | 466×466 | 16 | dark | round (`shape = "round"`): only the circle of radius 233 shows; AMOLED, black is off; touch panel (`touchscreen`) |
| Waveshare ESP32-S3-AMOLED-1.91 | 536×240 (landscape) | 16 | dark | AMOLED, black is off; IMU; the Touch version adds a touch panel (`touchscreen`) |
| 1.3" ST7789 | 240×240 | 16 | dark | |
| SSD1306 OLED | 128×64 or 128×32 | 1 | dark | colours threshold to lit/unlit at 50% brightness |
| 2.13" e-paper | 122×250 | 1 | light | every `flip()` is a refresh (0.2 s partial, 1.9 s full every 10th); it runs in the background and only the newest frame reaches the glass: flip only when something changed |

On 1-bit screens use pure white for marks on a dark scheme, pure black on a light one.

**Buttons**: two, indices 0 (key A) and 1 (key B). Gestures arrive in `on_event`: `tap`
(`e.data.index`, `e.data.count`) on a release before 500 ms, `hold` (`e.data.held = true` at 500 ms,
`false` on release). A legacy `button` event fires alongside `tap`.

**IMU**: 6-axis, body frame. At rest face-up `imu.accel()` ≈ `(0, 0, 1)` g; the user tilts it with a
pad and can shake it. `imu.gyro()` in °/s. `imu.temp()` returns 0.

**Buzzer**: square-wave piezo, 20–20000 Hz (clamped), durations up to 5000 ms.

## Which outputs list an app

Bench lists an app only for outputs, and boards, that can run it. Say what the code can't show in
the header:

```lua
-- Tilt ball: roll a ball with the IMU   -- line 1: "Name: description"
-- @output display                       -- display (the default) | strip (strips and rings) | matrix
-- @needs motion color touch 240x135     -- only the ones that apply
```

- `@output`: an app that names its output and arrives (pushed, dropped or run) while Bench shows
  another kind switches Bench to that kind: a matrix app pushed at a display gets the LED matrix.
- `motion`: it animates (so not e-paper). `color`: it means nothing in 1-bit. `touch`: it needs a
  touch panel. `WxH`: the smallest screen, as apps see it, that its fixed layout fits. An app that adapts through `screens.get`
  needs none of these.
- Bench reads the rest from the code: the libraries it binds (`lvgl.bind` needs a board with LVGL)
  and its size (the memory it takes on a real board).

## Boards: libraries and memory

The board driving the output decides what an app gets. Bench shows it under the display, with a
**Board** menu for bare modules and LEDs:

| Board | Libraries | Memory for apps |
|---|---|---|
| M5StickC Plus2, M5StickS3, ESP32-S3 DevKitC-1 N16R8, Seeed Studio XIAO ESP32S3, Waveshare ESP32-S3-Touch-LCD-2, Waveshare ESP32-S3-Touch-AMOLED-1.32, Waveshare ESP32-S3-AMOLED-1.91 and its Touch version | `screen`, `lgfx`, `lvgl` | PSRAM (MBs) |
| ESP32 without PSRAM (Waveshare ESP32 e-Paper Driver Board, ESP32 DevKitC) | `screen`, `lgfx`; no `lvgl` | ~52 KB |
| Waveshare ESP32-C6-LCD-1.47 | `screen`, `lgfx`; no `lvgl` | ~84 KB |

A library the board's firmware doesn't have isn't there at all: on a board without LVGL the global
`lvgl` is nil, so `lvgl.bind` fails with "attempt to index a nil value (global 'lvgl')", on Bench as
on the board (Bench adds why). The same goes for `leds` on a display and `screen` on LED outputs, and
`lgfx` on a strip or ring (a matrix keeps it). `if lvgl then … end` is how an app checks.

On a board without PSRAM, draw with `lgfx` (or `screen`) and keep the app small: receiving and
compiling it takes about 6x its size, so stay under ~4 KB of Lua (~8 KB on the C6), and `datetime`
costs ~35 KB once touched. There Lua has a heap of its own: an app that doesn't fit stops with "not
enough memory" and the board stays online for the next one.

Each dispatch (loading the app, `init`, a tick, an event) gets 1000 ms. Past that, a board raises
`execution deadline exceeded (1000 ms)` and the app carries on. Bench counts the 1000 ms as about 4
million Lua instructions, what an ESP32-S3 runs (the C6 runs far fewer: see below). Nothing times an
LVGL callback, a coroutine that never yields back, or a dispatch that catches the deadline error
with `pcall` and carries on. On a board those hang it, so Bench halts the app.

## Speed on a real board

Bench runs Lua 50 to 100 times faster than a board, so an animation that is smooth on Bench can
crawl on the glass. `on_tick` comes every 100 ms; a tick that takes longer (its Lua plus the
`flip()` that pushes the frame) delays the next one, and the frame rate drops with it.

- **ESP32-C6: no FPU.** Every float operation is emulated, and `math.sin`, `math.sqrt` and `^` cost
  the most. Measured on the C6-LCD-1.47 with a full-screen `lgfx` flame: about 137,000 Lua
  instructions and 985 draw calls a tick took ~285 ms (3.5 fps); about 50,000 instructions and 609
  calls took ~104 ms (10 fps). Pushing the 172×320 frame is ~32 ms of that.
- **For 10 fps on the C6**, keep a full redraw to roughly 50,000 instructions and 600 draw calls:
  - Build lookup tables in `init` (shapes, colour ramps) instead of calling `sin` or `^` for
    every row; work out what varies per frame at a dozen points and blend between them.
  - Blend colours with integers (`(a + (b - a) * k // 256)` per channel, `k` 0–256), not floats.
  - Don't create closures or tables in a loop that runs each frame: they're garbage in a small heap.
  - Fewer, bigger draw calls: merge rows of one colour into one `fillRect`, and step soft
    things (glows, gradients) 4 rows at a time.
- **Stiff springs at 10 Hz:** a spring that's stable at 30 fps can blow up at a 100 ms tick. Step
  it in 10 ms slices inside `on_tick`.
- **Measure on the board:** log the average `dt_ms` over 30 ticks (`log.info`) and read the
  board's serial output. ~100 means the board keeps up; more means it's falling behind.

## On a real board (Bench's Mirror)

Bench's Real device panel pushes the open app to a Resident device and drives it from the bench:

- The app travels wrapped in a small shim (only the stand-ins it uses, minified) that defines
  `dial`, `trigger`, `light`, `pir`, `climate`, `touch`, `ld2410`, `imu`, `touchscreen` and a silent
  `buzzer` where the firmware has none, fed by `bench` events from Bench. Write against the API and it runs
  unchanged: the readings (the IMU's rotation rate included) and the `dial`, `trigger`, `motion`,
  `touch` and `presence` events arrive as they do in Bench.
- Buttons A and B: the taps and holds Bench recognises are replayed on the board, and the board's
  own keys are ignored while Bench mirrors, so both screens count the same. `button.press_count()`
  counts Bench's taps. Touches on Bench's screen are replayed the same way, in order with their
  points, and the board's own touch panel is ignored while Bench mirrors.
- E-paper: the real panel refreshes in the background, newest frame wins, exactly as Bench shows it.
- Local time: Bench sends its time zone before each app, so `datetime.now()` reads the same on both
  screens on boards running Bench's firmware. Other firmware stays on UTC.
- An app the board can't load (out of memory, a module it lacks) leaves the previous app on screen:
  Bench only knows the relay took it. Bench's App menu lists only the apps that fit the chosen board,
  and says why the others won't run.

## Share links: open an app in Bench

A share link opens an app in anyone's Bench on the hardware it was written for: the output, the
board, the parts on the bench and what each control is connected to. When an app is done, give the
user one as well as the file. A link the user pastes tells you their setup. There are two kinds:

```
https://bench.porous.systems/#share=1.<data>     a long link: the setup itself, after the #
https://bench.porous.systems/s/<id>              a short link: the setup stored on Bench's server
```

`<data>` is the setup as JSON, compressed with raw DEFLATE (no zlib header), in base64url without
padding. A long link never reaches a server (browsers don't send the part after `#`), but with an
app's code in it runs to thousands of characters. With Node, from the app's file:

```sh
node -e '
const fs = require("fs"), zlib = require("zlib");
const setup = {
  output: { kind: "display", device: "waveshare-esp32-c6-lcd-1.47" },
  board: "waveshare-esp32-c6-lcd-1.47",
  parts: [{ id: "knob-1", kind: "knob", label: "Speed" }, { id: "button-1", kind: "button", label: "Fire" }],
  connections: { speed: "knob-1:rotate", fire: "button-1:press" },
  app: { name: "flame", code: fs.readFileSync("flame.lua", "utf8"), description: "A flame the knob fans" },
};
console.log("https://bench.porous.systems/#share=1." + zlib.deflateRawSync(JSON.stringify(setup)).toString("base64url"));
'
```

For a short link, which fits anywhere (a LinkedIn post holds 3,000 characters, link included),
send the data, everything after `#share=`, to Bench, and put the id it answers after `/s/`:

```sh
curl -s https://bench.porous.systems/api/share --data-binary "1.<data>"   # {"id":"Xk3f9aQ2pL7d"}
```

Bench keeps only setups it can open, up to 90,000 characters of data, and 30 an hour from one
address. The id comes from the setup's hash, so the same setup always gets the same link and no one
can change what a link opens; anyone with the link can open it. The Share button makes short links.

To read a link: for a short one, `curl -s https://bench.porous.systems/api/share/<id>` gives its
data; then `zlib.inflateRawSync(Buffer.from(data.slice(2), "base64url"))`, where `data` is
everything after `#share=` (`1.` and the rest).

- `output`: `{ kind: "display", device }` with a `device` from the table below; `{ kind: "strip",
  count }` with 8, 16, 30, 60 or 144 LEDs; `{ kind: "ring", count }` with 12, 16 or 24;
  `{ kind: "matrix", w, h }` at 8×8, 16×16 or 32×8.
- `board`: one that drives that output (below). Modules with their own chip have just the one.
- `parts`: what the user puts on the bench, `{ id, kind, label }`, with ids `<kind>-<n>` (`knob-1`,
  `button-2`). Leave out the board's own buttons, IMU and buzzer: they come with the board.
- `connections`: each of the app's dials and triggers, by the name given to `dial.new` or
  `trigger.new`, to `"part:channel"` or `"none"`. `{}` leaves it to the app's `connect` and `via`
  options, as when the app is opened any other way. The board's own parts are `builtin-button-0`
  (A), `builtin-button-1` (B), `builtin-imu` and `builtin-buzzer`, on boards that have them.
- `app`: `{ name, code, description? }` for an app you wrote; `{ bundled: "<id>" }` for one of
  Bench's own (its file name in `src/resident-apps`, less `.lua`).

| Display | `device` | `board` |
|---|---|---|
| M5StickC Plus2 | `m5stickc-plus2` | `m5stickc-plus2` |
| M5StickS3 | `m5sticks3` | `m5sticks3` |
| Waveshare ESP32-C6-LCD-1.47 | `waveshare-esp32-c6-lcd-1.47` | `waveshare-esp32-c6-lcd-1.47` |
| Waveshare ESP32-S3-Touch-LCD-2 | `waveshare-esp32-s3-touch-lcd-2` | `waveshare-esp32-s3-touch-lcd-2` |
| Waveshare ESP32-S3-Touch-AMOLED-1.32 | `waveshare-esp32-s3-touch-amoled-1.32` | `waveshare-esp32-s3-touch-amoled-1.32` |
| Waveshare ESP32-S3-AMOLED-1.91 | `waveshare-esp32-s3-amoled-1.91` | `waveshare-esp32-s3-amoled-1.91` |
| Waveshare ESP32-S3-Touch-AMOLED-1.91 | `waveshare-esp32-s3-touch-amoled-1.91` | `waveshare-esp32-s3-amoled-1.91` |
| 1.3" ST7789 240×240 | `generic-st7789-240x240` | a dev board |
| SSD1306 OLED 128×64 | `ssd1306-128x64` (yellow/blue: `ssd1306-128x64-yellow-blue`) | a dev board |
| SSD1306 OLED 128×32 | `ssd1306-128x32` | a dev board |
| 2.13" e-paper | `waveshare-epd-2.13-v4` | `waveshare-esp32-epaper-driver` or `esp32-s3-devkitc-1-n16r8` |

The dev boards, for bare modules and every LED output: `esp32-s3-devkitc-1-n16r8` (the default),
`esp32-devkitc` and `seeed-xiao-esp32s3`.

A dial connects to a channel that turns or measures, a trigger to one that fires:

| Part `kind` | Dial channels | Trigger channels |
|---|---|---|
| `button` | | `press` |
| `knob` (rotary encoder) | `rotate` | `push` |
| `pot` (slide pot) | `position` | |
| `touch` (touch pad) | | `touch` |
| `imu` | `tilt-x`, `tilt-y` | `shake` |
| `ld2410` (radar) | `distance` | `presence` |
| `pir` | | `motion` |
| `light` | `level` | `dark` |
| `climate` | `temperature`, `humidity` | |
| `buzzer` | | |

Opening a link replaces the setup in that browser, and Bench offers **Back to my bench** until the
user keeps the new one. An id that Bench doesn't know is left out and named.

## Lua modules

### lgfx (preferred)

```lua
local g = lgfx.bind("main")
g:fillScreen(0x000000)
g:setTextColor(0xFFFFFF); g:setTextSize(2); g:setTextDatum(lgfx.MC_DATUM)
g:drawString("hi", g:width() // 2, g:height() // 2)
g:flip()                          -- nothing is visible until flip
```

Full sheet: Resident's `prompts/lgfx.md`. Integer arguments are checked like `luaL_checkinteger`:
`g:fillRect(1.5, …)` raises, so `math.floor` computed coordinates.

### screen (M5Stick verbs, 0–255 channels)

```lua
screen.clear([r, g, b])                       -- default black
screen.text(x, y, str[, size = 2[, r, g, b]]) -- default white
screen.fill_rect(x, y, w, h, r, g, b)    screen.rect(x, y, w, h, r, g, b)
screen.line(x0, y0, x1, y1, r, g, b)     screen.pixel(x, y, r, g, b)
screen.triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.fill_triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.qr(x, y, text[, scale = 4[, r, g, b]])  -- QR v3..v10, ECC low
screen.flip()   screen.set_brightness(0..255)   screen.width()   screen.height()
```

`screen` and `lgfx` draw into the same frame buffer.

### imu, buzzer, button

```lua
local ax, ay, az = imu.accel()
local gx, gy, gz = imu.gyro()
buzzer.beep(440, 200)   buzzer.tone(1000)   buzzer.stop()
button.press_count()    -- taps since the app loaded
```

### dial, trigger, ld2410 (Bench drivers)

Declare these at the top of the app (or in `init`): each declaration puts the part on the desk.
Which hardware drives a dial or trigger is the user's choice in Bench's Connections panel, so write
against the API, not a specific part: use `via` for the kind of hardware, and `connect` only when the
app is written for one particular bench.

```lua
local speed = dial.new("speed", { min = 1, max = 10, step = 1, start = 3 })
--   options: label, min, max, step, start, wrap,
--            via = "encoder" | "pot" | "imu-x" | "imu-y" | "radar" | "light" | "temperature" | "humidity",
--            connect = "pot-1:position" (one specific part and channel, as Connections names them),
--            keys = { down = "ArrowLeft", up = "ArrowRight" }
speed:value()   speed:delta()   -- steps since the last call   speed:fraction()   -- 0..1 in the range

local fire = trigger.new("fire", { key = "Space" })
--   options: label, key (a KeyboardEvent.code), connect = "button-1:press",
--            via = "button" | "external-button" | "encoder-push" | "touch" | "shake" | "presence" | "motion" | "dark"
fire:is_pressed()   fire:was_pressed()   fire:was_released()   fire:pressed_for(ms)

ld2410.begin({ mode = "wander" })   -- "wander" | "approach" | "empty" | "manual"
local r = ld2410.read()  -- { connected, moving, still, distance_cm, moving_cm, moving_energy, still_cm, still_energy, out }
```

Driver events arrive in `on_event` with `e.channel == "driver"`: `dial` `{ name, value, delta }` when a
dial moves, `trigger` `{ name, pressed }` on each edge, `presence` `{ moving, still, distance_cm }` when
the radar's state changes. Poll in `on_tick` or react to events, whichever reads better. These
modules exist only on Bench (or a board whose firmware provides them); guard with `if dial then`
for apps that should also run on a plain M5Stick.

### light, pir, climate, touch (Bench drivers)

```lua
light.read()    -- { level = 0..1, lux = 1..10000, raw = 0..4095 }   light.level()
pir.read()      -- { motion = bool }                                  pir.motion()
climate.read()  -- { temperature = °C, humidity = % }                 climate.temperature(), climate.humidity()
touch.read()    -- { touched = bool, raw = touchRead() }              touch.touched()
```

The first read puts the sensor on the user's bench if it isn't there. PIR and touch also send driver
events: `motion` `{ moving }` and `touch` `{ touched }` on each change. Prefer a `dial`/`trigger`
(`via = "light"`, `"temperature"`, `"motion"`, `"touch"` …) when the app only needs "a value" or "a
press": the user can then connect any part to it.

### touchscreen (Bench driver, displays with a touch panel)

Only on a display with a touch panel (the Waveshare ESP32-S3-Touch-LCD-2,
ESP32-S3-Touch-AMOLED-1.32 and ESP32-S3-Touch-AMOLED-1.91); elsewhere
`touchscreen` is nil, so check `if touchscreen then` or tag the app `-- @needs touch`. One finger,
in the coordinates the app draws in. In Bench the user taps and drags on the screen with the mouse.

```lua
local t = touchscreen.read()   -- { pressed = bool, x, y }: the last point touched
touchscreen.pressed()
-- on_event(ctx, e), e.channel == "driver", e.data = { x, y }:
--   "touch_down", "touch_move" (the newest point, at most once a loop), "touch_up",
--   "touch_tap"  after touch_up, for a release within 500 ms that moved under 10 px
```

LVGL widgets don't receive touches: hit-test your own layout.

### leds (Bench driver, LED outputs)

When the user picks an LED strip, ring or matrix as the output (instead of a display), the board
drives a WS2812B chain. Start the file with `-- @output strip` (strips and rings) or
`-- @output matrix` so it's listed for that output.

```lua
leds.count()  leds.width()  leds.height()  leds.xy(x, y)   -- LEDs from 0 in chain order; xy finds one on a matrix
leds.set(i, 0xRRGGBB)  leds.set_rgb(i, r, g, b)  leds.get(i)  leds.fill(c[, from[, count]])  leds.clear()
leds.hsv(hue_degrees, s, v) -> colour     leds.brightness(0..255)     leds.show()   -- nothing lights until show
leds.on_frame(function(ctx, dt_ms) ... end[, fps])   -- the LED driver's frame timer, default 50 fps
```

Put continuous effects in `on_frame` (on_tick is only 10 Hz). Keep brightness modest (~100): full
white is ~60 mA an LED. On a matrix, always find an LED with `leds.xy(x, y)`, never `y * width + x`:
the chain runs through the grid as the panel is wired, and Bench wires each size as those panels
usually are (8×8 row by row; 16×16 serpentine rows, every other one right to left; 32×8 serpentine
columns, down the first and up the next), so an app that computes the index scrambles there, as on
the real panel. A matrix is also an `lgfx` display (8 pixels tall on an 8×8, the built-in
5×7 font fits), so text and shapes work with `lgfx.bind("main")` and `g:flip()`.

Plus every universal module from Resident's `prompts/sandbox.md`: `log`, `events`, `store`,
`time`, `datetime` (local zone = the browser's), `screens`.

### lvgl (optional; only on boards with LVGL)

LVGL 9 through luavgl, per Resident's `prompts/lvgl.md`. `lvgl.bind("main")` returns the display
handle and claims the panel (`lgfx` flips are then dropped: one library per panel). Fonts: the
`montserrat` family at 8, 14, 16, 20, 24, 28, 32, 36, 40 and 48 px (`lvgl.Font("montserrat", 20)`;
other sizes snap to the nearest). Put continuous motion in `lvgl.Anim`: LVGL's timer pump runs every
33 ms, `on_tick` only every 100. Bench draws `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and
`Checkbox` faithfully. `Roller` is simplified, and `Image`, `Dropdown`, `Textarea`, `Scale`, `List`,
`Keyboard` and `Calendar` are placeholder boxes, so prefer the first set. No widget receives input
events.

## Example

```lua
local g = lgfx.bind("main")
local s = screens.get("main")
local bg = s.scheme == "light" and 0xFFFFFF or 0x000000
local fg = s.scheme == "light" and 0x000000 or 0xFFFFFF
local n = 0

local function draw()
  g:fillScreen(bg)
  g:setTextColor(fg); g:setTextSize(2); g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("taps " .. n, g:width() // 2, g:height() // 2)
  g:flip()
end

function init(ctx) draw() end
function on_event(ctx, e)
  if e.name == "tap" then n = n + 1; buzzer.beep(880, 40); draw() end
end
```

## Validation stubs

```lua
screen = setmetatable({
  width = function() return 240 end,
  height = function() return 135 end,
}, { __index = function() return function() end end })
imu = setmetatable({
  accel = function() return 0, 0, 1 end,
  gyro = function() return 0, 0, 0 end,
  temp = function() return 0 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end }, { __index = function() return function() end end })
local handle = setmetatable({}, { __index = function() return function() return 0 end end })
dial = { new = function() return handle end }
trigger = { new = function() return setmetatable({}, { __index = function() return function() return false end end }) end }
ld2410 = { begin = function() end, read = function()
  return { connected = true, moving = false, still = false, distance_cm = 0, moving_cm = 0, moving_energy = 0,
           still_cm = 0, still_energy = 0, out = false }
end }
buzzer = setmetatable({}, { __index = function() return function() end end })
light = { read = function() return { level = 0.5, lux = 300, raw = 2048 } end, level = function() return 0.5 end }
pir = { read = function() return { motion = false } end, motion = function() return false end }
climate = { read = function() return { temperature = 21, humidity = 40 } end,
  temperature = function() return 21 end, humidity = function() return 40 end }
touch = { read = function() return { touched = false, raw = 0 } end, touched = function() return false end }
touchscreen = { read = function() return { pressed = false, x = 0, y = 0 } end, pressed = function() return false end }
screens = { get = function()
  return { name = "main", w = 240, h = 135, shape = "rect", depth = 16, scheme = "dark", brightness = 1,
           model = "M5StickC Plus2", controller = "ST7789V2", tech = "lcd" }
end }
local gfx = setmetatable({ width = function() return 240 end, height = function() return 135 end },
  { __index = function() return function() return 0 end end })
lgfx = setmetatable({ bind = function() return gfx end }, { __index = function() return 0 end })
leds = setmetatable({ count = function() return 30 end, width = function() return 30 end, height = function() return 1 end },
  { __index = function() return function() return 0 end end })
```
