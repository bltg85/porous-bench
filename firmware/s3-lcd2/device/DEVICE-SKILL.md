# Waveshare ESP32-S3-Touch-LCD-2 (s3-lcd2)

An ESP32-S3 board with a 2" colour IPS LCD (240×320, portrait), a touch panel, a 6-axis IMU and one
key. With 8 MB of PSRAM, apps can be large and use LVGL: dashboards, games, gauges, touch UIs and
smooth animations all fit. Device type `s3-lcd2`.

When porous.systems Bench mirrors an app onto this board, Bench's sensors and controls (dials,
triggers, light, PIR, climate, radar, a silent buzzer) reach the app as Bench defines them; the
firmware itself has only the modules below.

## Hardware

- **Screen** `"main"`: 240×320 pixels, portrait with the USB-C port at the bottom, origin top-left,
  x to the right, y down. 16-bit colour (RGB565), dark scheme: blank is black, the backlight shines
  through. About 200 dpi. The corners are only slightly rounded (~4 px).
- **Backlight**: dimmable, 0..255 (`screen.set_brightness`) or 0..1 (`screens.set`). Every app
  starts at full brightness.
- **Touch**: one finger, in screen pixels (CST816D).
- **IMU**: 6-axis (QMI8658): acceleration and rotation rate.
- **Key**: one, BOOT, index 0 (key A). There is no key B. No buzzer.

## Lua Modules

### lgfx (preferred for drawing)
**Hardware:** the screen, LovyanGFX-style. Draws into the same frame as `screen`.

```lua
local g = lgfx.bind("main")      -- the handle; bind once at the top of the app
g:fillScreen(0x000000)           -- colours are 0xRRGGBB (shown as RGB565)
g:drawPixel(x, y, c)   g:drawLine(x0, y0, x1, y1, c)
g:drawRect(x, y, w, h, c)        g:fillRect(x, y, w, h, c)
g:drawRoundRect(x, y, w, h, r, c)  g:fillRoundRect(x, y, w, h, r, c)
g:drawCircle(x, y, r, c)         g:fillCircle(x, y, r, c)
g:drawTriangle(x0, y0, x1, y1, x2, y2, c)  g:fillTriangle(x0, y0, x1, y1, x2, y2, c)
g:setTextColor(fg[, bg])         -- with bg, glyph cells are filled
g:setTextSize(n)                 -- whole multiples of the 6x8 font: 1 = 6x8 px, 2 = 12x16 px, ...
g:setTextDatum(lgfx.MC_DATUM)    -- TL TC TR ML MC MR BL BC BR _DATUM, L/C/R_BASELINE (for drawString)
g:setCursor(x, y)  g:print("text")   -- print wraps at the right edge
g:drawString("text", x, y)       -- anchored by the datum, never wraps
g:width()  g:height()            -- 240, 320
g:flip()                         -- nothing changes on the glass until flip
```

Integer arguments are checked: `g:fillRect(1.5, …)` raises, so `math.floor` computed coordinates
(or use `//`).

### screen
**Hardware:** the screen, with the M5Stick drawing verbs (0–255 channels). Same frame as `lgfx`.

```lua
screen.clear([r, g, b])                         -- default black
screen.text(x, y, str[, size = 2[, r, g, b]])   -- default white
screen.fill_rect(x, y, w, h, r, g, b)    screen.rect(x, y, w, h, r, g, b)
screen.line(x0, y0, x1, y1, r, g, b)     screen.pixel(x, y, r, g, b)
screen.triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.fill_triangle(x0, y0, x1, y1, x2, y2, r, g, b)
screen.qr(x, y, text[, scale = 4[, r, g, b]])   -- QR v3..v10, ECC low, black modules by default:
                                                -- clear a white square behind it; v3 is 29 modules
screen.flip()                                   -- pushes the whole frame (~25 ms)
screen.set_brightness(0..255)                   -- the backlight
screen.width()   screen.height()                -- 240, 320
```

### lvgl (widgets)
**Hardware:** the screen, through LVGL 9 (luavgl), in colour.

```lua
local h = lvgl.bind("main")      -- claims the screen: lgfx/screen flips are dropped while LVGL owns it
h:set_theme { screen = { bg_color = 0x0B0B10 } }
local title = h.Label { text = "hello", text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 24),
  align = { type = lvgl.ALIGN.TOP_MID, y_ofs = 16 } }
local arc = h.Arc { w = 160, h = 160, align = lvgl.ALIGN.CENTER, range = { 0, 100 }, value = 50 }
title:set { text = "changed" }   -- LVGL redraws what changed
lvgl.Timer { period = 33, cb = function() --[[ animate ]] end }   -- ~30 fps, faster than on_tick
h.HOR_RES()  h.VER_RES()         -- 240, 320
```

Fonts: `montserrat` at 8, 14, 16, 20, 24, 28, 32, 36, 40 and 48 px (other sizes snap to the
nearest), ASCII only. Prefer `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and `Checkbox`: they
look the same on Bench and on the device. LVGL widgets don't receive touches: read `touchscreen`
and hit-test your own layout. An `lvgl.Timer` callback isn't covered by the 1 s deadline: keep it
short and never loop in it.

### touchscreen
**Hardware:** the touch panel, one finger, in the coordinates the app draws in.

```lua
local t = touchscreen.read()   -- { pressed = bool, x, y }: the last point touched
touchscreen.pressed()          -- bool
-- on_event(ctx, e), e.data = { x, y }:
--   "touch_down", "touch_move" (the newest point, at most once a loop, only when it moved),
--   "touch_up", "touch_tap" after touch_up for a release within 500 ms that moved under 10 px
```

### imu
**Hardware:** the 6-axis IMU, in the screen's frame.

```lua
local ax, ay, az = imu.accel()   -- g. Face-up at rest ≈ (0, 0, 1); x grows as the right edge
                                 -- tips down, y as the bottom (USB-C) edge tips down, so a ball
                                 -- rolls by (ax, ay) in screen coordinates
local gx, gy, gz = imu.gyro()    -- °/s, ~0 at rest (the drift is measured at boot: keep the board
                                 -- still while it starts). gx > 0 while the bottom edge tips down,
                                 -- gy < 0 while the right edge tips down, gz > 0 turning
                                 -- counter-clockwise seen from above
imu.temp()                       -- °C, the chip's own (runs ~10 °C above the room)
```

### button
**Hardware:** the BOOT key (index 0).

```lua
button.press_count()   -- taps since the app loaded
-- Gestures arrive in on_event(ctx, e):
--   e.name == "tap"    e.data.index (0), e.data.count (taps so far): released before 500 ms
--   e.name == "hold"   e.data.index, e.data.held == true at 500 ms, false on release
--   e.name == "button" the legacy name, sent alongside every tap
```

### screens
**Hardware:** the screen's facts and its one setting.

```lua
local s = screens.get("main")
-- { name = "main", w = 240, h = 320, shape = "rect", depth = 16, scheme = "dark", dpi = 200,
--   brightness = 0..1, model = "Waveshare ESP32-S3-Touch-LCD-2", controller = "ST7789T3", tech = "lcd" }
screens.set("main", { brightness = 0.3 })   -- 0..1, the backlight
```

## Examples

### Hello, centred

```lua
local g = lgfx.bind("main")

function init(ctx)
  g:fillScreen(0x000000)
  g:setTextColor(0xFFFFFF)
  g:setTextSize(3)
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("hello", g:width() // 2, g:height() // 2)
  g:flip()
end
```

### Tilt ball

```lua
local g = lgfx.bind("main")
local W, H, R = g:width(), g:height(), 12
local x, y, vx, vy = W / 2, H / 2, 0, 0

function on_tick(ctx, dt_ms)
  local dt = dt_ms / 1000
  local ax, ay = imu.accel()
  vx, vy = (vx + ax * 600 * dt) * 0.98, (vy + ay * 600 * dt) * 0.98
  x, y = x + vx * dt, y + vy * dt
  if x < R or x > W - R then x, vx = math.max(R, math.min(W - R, x)), -vx * 0.6 end
  if y < R or y > H - R then y, vy = math.max(R, math.min(H - R, y)), -vy * 0.6 end
  g:fillScreen(0x101820)
  g:fillCircle(math.floor(x), math.floor(y), R, 0x3DDC84)
  g:flip()
end
```

### Paint with a finger

```lua
local g = lgfx.bind("main")
local lastX, lastY

function init(ctx) g:fillScreen(0x000000) g:flip() end

function on_event(ctx, e)
  if e.name == "touch_down" then
    lastX, lastY = e.data.x, e.data.y
  elseif e.name == "touch_move" and lastX then
    g:drawLine(lastX, lastY, e.data.x, e.data.y, 0xFFC040)
    lastX, lastY = e.data.x, e.data.y
    g:flip()
  elseif e.name == "touch_up" then
    lastX = nil
  elseif e.name == "hold" and e.data.held then
    g:fillScreen(0x000000) g:flip()   -- hold BOOT to clear
  end
end
```

### LVGL: an arc that follows a counter

```lua
local h = lvgl.bind("main")
h:set_theme { screen = { bg_color = 0x0B0B10 } }
local arc = h.Arc { w = 180, h = 180, align = lvgl.ALIGN.CENTER, range = { 0, 10 }, value = 0 }
local label = h.Label { text = "0", text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 48),
  align = lvgl.ALIGN.CENTER }
local n = 0

function on_event(ctx, e)
  if e.name == "tap" or e.name == "touch_tap" then
    n = (n + 1) % 11
    arc:set { value = n }
    label:set { text = tostring(n) }
  end
end
```

### A QR code with a caption

```lua
function init(ctx)
  screen.clear(0, 0, 0)
  screen.fill_rect(54, 70, 132, 132, 255, 255, 255)   -- white quiet zone
  screen.qr(62, 78, "https://porous.systems", 4)      -- v3: 29 x 4 = 116 px
  screen.text(66, 230, "scan me", 2)
  screen.flip()
end
```

## Constraints

- **240×320, 16-bit colour, dark scheme.**
- **Text**: lgfx/screen use the built-in 6x8 font in whole multiples (size 1 fits 40 characters
  across, size 2 fits 20, size 3 fits 13); LVGL has Montserrat. Both are ASCII only.
- **Frame rate**: `flip()` pushes the whole frame in ~25 ms. `on_tick` runs every 100 ms; for
  smoother animation use LVGL and an `lvgl.Timer` (~30 fps).
- **Memory**: Lua and LVGL live in 8 MB of PSRAM, so app size is rarely a limit. Each callback
  still has to finish within 1000 ms.
- One key (index 0). No buzzer.

## Practical Tips

- Draw a whole frame, then `flip()` once; the screen shows nothing in between.
- `screen` and `lgfx` share one frame, so they can be mixed; `lgfx` is preferred. Once an app binds
  LVGL, LVGL owns the screen.
- For touch, react to `touch_tap` for buttons and `touch_move` for dragging; hit-test your own
  layout.
- The clock syncs over Wi-Fi at boot. Local time (`datetime.now()`) is UTC, or the zone Bench runs
  in once Bench has mirrored an app here; `datetime.now(datetime.UTC)` is always UTC.

## Validation stubs

```lua
local surface = setmetatable({
  width = function() return 240 end,
  height = function() return 320 end,
}, { __index = function() return function() end end })
lgfx = setmetatable({ bind = function() return surface end },
  { __index = function(_, k) if k:match("_DATUM$") or k:match("_BASELINE$") then return 0 end end })
screen = setmetatable({
  width = function() return 240 end,
  height = function() return 320 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end },
  { __index = function() return function() end end })
touchscreen = {
  read = function() return { pressed = false, x = 0, y = 0 } end,
  pressed = function() return false end,
}
imu = {
  accel = function() return 0, 0, 1 end,
  gyro = function() return 0, 0, 0 end,
  temp = function() return 30 end,
}
screens = {
  get = function() return { name = "main", w = 240, h = 320, shape = "rect", depth = 16,
    scheme = "dark", dpi = 200, brightness = 1, model = "Waveshare ESP32-S3-Touch-LCD-2",
    controller = "ST7789T3", tech = "lcd" } end,
  list = function() return {} end,
  set = function() end,
  refresh = function() return false end,
}
```

## App mode / Shader mode

Shader mode is not available on this device — only app mode is supported.
