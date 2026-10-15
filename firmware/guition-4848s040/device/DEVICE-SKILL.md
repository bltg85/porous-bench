# Guition ESP32-S3-4848S040 (guition-4848)

A 4" square colour IPS LCD (480×480) with a touch panel, in a wall panel that fits an 86 mm box,
driven by its own ESP32-S3. No keys: everything is touch. With 8 MB of PSRAM, apps can be large and
use LVGL: dashboards, wall controls, clocks, touch UIs. Device type `guition-4848`.

When porous.systems Bench mirrors an app onto this board, Bench's sensors and controls (dials,
triggers, light, PIR, climate, radar, IMU, a silent buzzer, buttons A and B) reach the app as Bench
defines them; the firmware itself has only the modules below.

## Hardware

- **Screen** `"main"`: 480×480 pixels, square. Up has the USB-C on the right edge. Origin top-left,
  x to the right, y down. 16-bit colour (RGB565), dark scheme: blank is black, the backlight shines
  through. About 170 dpi: text that reads well on a 1" screen is small here, so scale up.
- **Backlight**: dimmable, 0..255 (`screen.set_brightness`) or 0..1 (`screens.set`). Every app
  starts at full brightness.
- **Touch**: one finger, in screen pixels (GT911).
- **Keys**: none. `button` is there but only Bench's buttons reach it, while Bench mirrors an app.
  No IMU, no buzzer.

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
g:width()  g:height()            -- 480, 480
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
screen.flip()                                   -- copies the rows drawn into the scanned frame
screen.set_brightness(0..255)                   -- the backlight
screen.width()   screen.height()                -- 480, 480
```

### lvgl (widgets)
**Hardware:** the screen, through LVGL 9 (luavgl), in colour.

```lua
local h = lvgl.bind("main")      -- claims the screen: lgfx/screen flips are dropped while LVGL owns it
h:set_theme { screen = { bg_color = 0x0B0B10 } }
local title = h.Label { text = "hello", text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 40),
  align = { type = lvgl.ALIGN.TOP_MID, y_ofs = 40 } }
local arc = h.Arc { w = 300, h = 300, align = lvgl.ALIGN.CENTER, range = { 0, 100 }, value = 50 }
title:set { text = "changed" }   -- LVGL redraws what changed
lvgl.Timer { period = 33, cb = function() --[[ animate ]] end }   -- ~30 fps, faster than on_tick
h.HOR_RES()  h.VER_RES()         -- 480, 480
```

Fonts: `montserrat` at 8, 14, 16, 20, 24, 28, 32, 36, 40 and 48 px (other sizes snap to the
nearest), ASCII only. Prefer `Object`, `Label`, `Button`, `Arc`, `Line`, `Led` and `Checkbox`: they
look the same on Bench and on the device. LVGL widgets don't receive touches: read `touchscreen`
and hit-test your own layout. An `Arc` fills clockwise from its start at the bottom left (135°,
measured clockwise from 3 o'clock) through 270°. An `lvgl.Timer` callback isn't covered by the 1 s
deadline: keep it short and never loop in it.

### touchscreen
**Hardware:** the touch panel, one finger, in the coordinates the app draws in.

```lua
local t = touchscreen.read()   -- { pressed = bool, x, y }: the last point touched
touchscreen.pressed()          -- bool
-- on_event(ctx, e), e.data = { x, y }:
--   "touch_down", "touch_move" (the newest point, at most once a loop, only when it moved),
--   "touch_up", "touch_tap" after touch_up for a release within 500 ms that moved under 10 px
```

### button
**Hardware:** none on this board. The module is there so an app written for keys still runs:
`press_count()` is 0, and `tap`/`hold` events come only from Bench while it mirrors an app here.

```lua
button.press_count()   -- taps since the app loaded
-- Gestures arrive in on_event(ctx, e):
--   e.name == "tap"    e.data.index (0 = A, 1 = B), e.data.count (taps so far)
--   e.name == "hold"   e.data.index, e.data.held == true at 500 ms, false on release
--   e.name == "button" the legacy name, sent alongside every tap
```

### screens
**Hardware:** the screen's facts and its one setting.

```lua
local s = screens.get("main")
-- { name = "main", w = 480, h = 480, shape = "rect", depth = 16, scheme = "dark", dpi = 170,
--   brightness = 0..1, model = "Guition ESP32-S3-4848S040", controller = "ST7701S", tech = "lcd" }
screens.set("main", { brightness = 0.3 })   -- 0..1, the backlight
```

## Examples

### Hello, centred

```lua
local g = lgfx.bind("main")

function init(ctx)
  g:fillScreen(0x000000)
  g:setTextColor(0xFFFFFF)
  g:setTextSize(6)
  g:setTextDatum(lgfx.MC_DATUM)
  g:drawString("hello", g:width() // 2, g:height() // 2)
  g:flip()
end
```

### Four buttons to tap

```lua
local g = lgfx.bind("main")
local NAMES = { "Lights", "Fan", "Music", "Away" }
local on = { false, false, false, false }

local function draw()
  g:fillScreen(0x101418)
  g:setTextDatum(lgfx.MC_DATUM)
  g:setTextSize(4)
  for i = 1, 4 do
    local x, y = 16 + ((i - 1) % 2) * 232, 16 + ((i - 1) // 2) * 232
    g:fillRoundRect(x, y, 216, 216, 24, on[i] and 0xFFC040 or 0x2A3440)
    g:setTextColor(on[i] and 0x101418 or 0xFFFFFF)
    g:drawString(NAMES[i], x + 108, y + 108)
  end
  g:flip()
end

function init(ctx) draw() end

function on_event(ctx, e)
  if e.name == "touch_tap" then
    local i = (e.data.x >= 240 and 2 or 1) + (e.data.y >= 240 and 2 or 0)
    on[i] = not on[i]
    draw()
  end
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
  end
end
```

### LVGL: an arc that counts taps

```lua
local h = lvgl.bind("main")
h:set_theme { screen = { bg_color = 0x0B0B10 } }
local arc = h.Arc { w = 320, h = 320, align = lvgl.ALIGN.CENTER, range = { 0, 10 }, value = 0 }
local label = h.Label { text = "0", text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 48),
  align = lvgl.ALIGN.CENTER }
local n = 0

function on_event(ctx, e)
  if e.name == "touch_tap" or e.name == "tap" then
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
  screen.fill_rect(124, 92, 232, 232, 255, 255, 255)   -- white quiet zone
  screen.qr(140, 108, "https://porous.systems", 7)     -- v3: 29 x 7 = 203 px
  screen.text(168, 360, "scan me", 4)
  screen.flip()
end
```

## Constraints

- **480×480, square, 16-bit colour, dark scheme.** Every pixel shows.
- **Text**: lgfx/screen use the built-in 6x8 font in whole multiples (size 2 fits 40 characters
  across, size 4 fits 20, size 6 fits 13); LVGL has Montserrat up to 48 px. Both are ASCII only.
  Read from a step back, size 3 or more (lgfx) or 24 px or more (LVGL) reads best.
- **Frame rate**: the panel is scanned from PSRAM ~42 times a second, so no app shows more frames
  than that. `flip()` copies only the rows drawn since the last flip into the scanned frame, so
  redraw only what moves: a full 480×480 frame is 450 KB to draw and copy, four times a 240×240
  one. `on_tick` runs every 100 ms; an `lvgl.Timer` can run at ~30 fps, and an lgfx app can use one
  too: `lvgl.bind("main")` first, then `lgfx.bind("main")` (the last bind owns the screen, the timer
  keeps running).
- **LVGL cost**: each `obj:set{}` costs ~0.3-0.6 ms, and LVGL repaints everything under whatever
  changed, translucent layers included; on 480×480 a full-screen repaint is four times the work of a
  240×240 one. Keep big moving areas few.
- **Memory**: Lua and LVGL live in 8 MB of PSRAM, so app size is rarely a limit. Each callback
  still has to finish within 1000 ms.
- **Saving an app** writes it to flash, which pauses the scan: the screen blinks black once as the
  firmware restarts it.
- No keys, no IMU, no buzzer.

## Practical Tips

- Draw a whole frame, then `flip()` once; the screen shows nothing in between.
- `screen` and `lgfx` share one frame, so they can be mixed; `lgfx` is preferred. Once an app binds
  LVGL, LVGL owns the screen.
- Make touch targets big: 80 px or more is a fingertip with room to spare. React to `touch_tap` for
  buttons and `touch_move` for dragging; hit-test your own layout.
- An app written for buttons runs, but on the board alone nothing presses them: give it a touch path.
- The clock syncs over Wi-Fi at boot. Local time (`datetime.now()`) is UTC, or the zone Bench runs
  in once Bench has mirrored an app here; `datetime.now(datetime.UTC)` is always UTC.

## Validation stubs

```lua
local surface = setmetatable({
  width = function() return 480 end,
  height = function() return 480 end,
}, { __index = function() return function() end end })
lgfx = setmetatable({ bind = function() return surface end },
  { __index = function(_, k) if k:match("_DATUM$") or k:match("_BASELINE$") then return 0 end end })
screen = setmetatable({
  width = function() return 480 end,
  height = function() return 480 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end },
  { __index = function() return function() end end })
touchscreen = {
  read = function() return { pressed = false, x = 0, y = 0 } end,
  pressed = function() return false end,
}
screens = {
  get = function() return { name = "main", w = 480, h = 480, shape = "rect", depth = 16,
    scheme = "dark", dpi = 170, brightness = 1, model = "Guition ESP32-S3-4848S040",
    controller = "ST7701S", tech = "lcd" } end,
  list = function() return {} end,
  set = function() end,
  refresh = function() return false end,
}
```

## App mode / Shader mode

Shader mode is not available on this device — only app mode is supported.
