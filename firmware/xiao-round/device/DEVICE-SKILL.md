# Seeed Studio Round Display for XIAO (xiao-round)

A round 1.28" colour IPS LCD (240×240, only the circle shows) with a touch panel, driven by a XIAO
ESP32S3 plugged in behind it, and one key. With 8 MB of PSRAM, apps can be large and use LVGL: clock
faces, gauges, dials, touch UIs and smooth animations all fit. Device type `xiao-round`.

When porous.systems Bench mirrors an app onto this board, Bench's sensors and controls (dials,
triggers, light, PIR, climate, radar, IMU, a silent buzzer) reach the app as Bench defines them; the
firmware itself has only the modules below.

## Hardware

- **Screen** `"main"`: 240×240 pixels, round: only the circle of radius 120 around (120, 120) is
  visible, the square's corners are not. Up is away from the panel's ribbon, with the XIAO's USB-C on
  the right. Origin top-left, x to the right, y down. 16-bit colour (RGB565), dark scheme: blank is
  black, the backlight shines through. About 188 dpi.
- **Backlight**: dimmable, 0..255 (`screen.set_brightness`) or 0..1 (`screens.set`), with the
  display's KE switch 2 on (off, it stays at full). Every app starts at full brightness.
- **Touch**: one finger, in screen pixels (CHSC6X).
- **Key**: one, the XIAO's B (BOOT), index 0 (key A). There is no key B. No IMU, no buzzer.

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
g:setCursor(x, y)  g:print("text")   -- print wraps at the right edge (outside the glass here)
g:drawString("text", x, y)       -- anchored by the datum, never wraps
g:width()  g:height()            -- 240, 240
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
screen.flip()                                   -- pushes the rows drawn (whole frame ~18 ms)
screen.set_brightness(0..255)                   -- the backlight
screen.width()   screen.height()                -- 240, 240
```

### lvgl (widgets)
**Hardware:** the screen, through LVGL 9 (luavgl), in colour.

```lua
local h = lvgl.bind("main")      -- claims the screen: lgfx/screen flips are dropped while LVGL owns it
h:set_theme { screen = { bg_color = 0x0B0B10 } }
local title = h.Label { text = "hello", text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 20),
  align = { type = lvgl.ALIGN.TOP_MID, y_ofs = 24 } }
local arc = h.Arc { w = 150, h = 150, align = lvgl.ALIGN.CENTER, range = { 0, 100 }, value = 50 }
title:set { text = "changed" }   -- LVGL redraws what changed
lvgl.Timer { period = 33, cb = function() --[[ animate ]] end }   -- ~30 fps, faster than on_tick
h.HOR_RES()  h.VER_RES()         -- 240, 240
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
**Hardware:** the XIAO's B key, BOOT (index 0), on the back next to the USB-C. R beside it resets.

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
-- { name = "main", w = 240, h = 240, shape = "round", depth = 16, scheme = "dark", dpi = 188,
--   brightness = 0..1, model = "Seeed Studio Round Display for XIAO", controller = "GC9A01", tech = "lcd" }
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

### A dial that follows a finger round the edge

```lua
local g = lgfx.bind("main")
local C, R = 120, 104

local function draw(angle)
  g:fillScreen(0x101820)
  g:drawCircle(C, C, R, 0x305070)
  local x, y = C + math.cos(angle) * R, C + math.sin(angle) * R
  g:drawLine(C, C, math.floor(x), math.floor(y), 0xFFC040)
  g:fillCircle(math.floor(x), math.floor(y), 10, 0x3DDC84)
  g:flip()
end

function init(ctx) draw(-math.pi / 2) end

function on_event(ctx, e)
  if e.name == "touch_down" or e.name == "touch_move" then
    draw(math.atan(e.data.y - C, e.data.x - C))   -- radians clockwise from 3 o'clock (y is down)
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
  elseif e.name == "hold" and e.data.held then
    g:fillScreen(0x000000) g:flip()   -- hold B to clear
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
  screen.fill_rect(54, 46, 132, 132, 255, 255, 255)   -- white quiet zone, inside the circle
  screen.qr(62, 54, "https://porous.systems", 4)      -- v3: 29 x 4 = 116 px
  screen.text(78, 192, "scan me", 2)
  screen.flip()
end
```

## Constraints

- **240×240, round, 16-bit colour, dark scheme.** Only the circle of radius 120 shows: keep content
  inside it. A row y is visible from `120 - w` to `120 + w`, with `w = sqrt(120^2 - (y - 120)^2)`, so
  corners, the top and bottom rows, and text near the edges are cut off.
- **Text**: lgfx/screen use the built-in 6x8 font in whole multiples (size 1 fits 40 characters
  across the middle row, fewer above and below it; size 2 fits 20, size 3 fits 13); LVGL has
  Montserrat. Both are ASCII only. Centre text (`TC_DATUM`/`MC_DATUM`) rather than starting it at x = 0.
- **Frame rate**: `flip()` pushes only the rows drawn since the last flip (a full frame ~18 ms, at
  80 MHz), so redraw only what moves. `on_tick` runs every 100 ms; an `lvgl.Timer` runs at ~30 fps,
  and an lgfx app can use one too: `lvgl.bind("main")` first, then `lgfx.bind("main")` (the last bind
  owns the screen, the timer keeps running).
- **LVGL cost**: each `obj:set{}` costs ~0.3-0.6 ms, and LVGL repaints everything under whatever
  changed, translucent layers included (expensive). Up to ~15 moving objects keep 30 fps; for more
  moving shapes (a flame, particles), draw rows with lgfx.
- **Memory**: Lua and LVGL live in 8 MB of PSRAM, so app size is rarely a limit. Each callback
  still has to finish within 1000 ms.
- One key (index 0). No IMU, no buzzer.

## Practical Tips

- Draw a whole frame, then `flip()` once; the screen shows nothing in between.
- `screen` and `lgfx` share one frame, so they can be mixed; `lgfx` is preferred. Once an app binds
  LVGL, LVGL owns the screen.
- For touch, react to `touch_tap` for buttons and `touch_move` for dragging; hit-test your own
  layout. On a round screen, `math.atan(y - 120, x - 120)` gives a finger's angle.
- The clock syncs over Wi-Fi at boot. Local time (`datetime.now()`) is UTC, or the zone Bench runs
  in once Bench has mirrored an app here; `datetime.now(datetime.UTC)` is always UTC.

## Validation stubs

```lua
local surface = setmetatable({
  width = function() return 240 end,
  height = function() return 240 end,
}, { __index = function() return function() end end })
lgfx = setmetatable({ bind = function() return surface end },
  { __index = function(_, k) if k:match("_DATUM$") or k:match("_BASELINE$") then return 0 end end })
screen = setmetatable({
  width = function() return 240 end,
  height = function() return 240 end,
}, { __index = function() return function() end end })
button = setmetatable({ press_count = function() return 0 end },
  { __index = function() return function() end end })
touchscreen = {
  read = function() return { pressed = false, x = 0, y = 0 } end,
  pressed = function() return false end,
}
screens = {
  get = function() return { name = "main", w = 240, h = 240, shape = "round", depth = 16,
    scheme = "dark", dpi = 188, brightness = 1, model = "Seeed Studio Round Display for XIAO",
    controller = "GC9A01", tech = "lcd" } end,
  list = function() return {} end,
  set = function() end,
  refresh = function() return false end,
}
```

## App mode / Shader mode

Shader mode is not available on this device — only app mode is supported.
