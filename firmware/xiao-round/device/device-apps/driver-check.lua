-- Driver check: exercises the xiao-round firmware's modules (lgfx, screen, button, touchscreen, screens). Touch: a crosshair follows the finger and a ball chases it. B (BOOT): tap +1, hold dims the backlight. A ring marks the edge of the glass.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local CX, CY, R = W // 2, H // 2, W // 2
local bx, by = CX, CY + 60
local taps, holds, dim = 0, 0, false
local ev = { touch_down = 0, touch_move = 0, touch_up = 0, touch_tap = 0 }
local last = "-"

local function line(y, text, colour)
  g:setTextColor(colour or 0xFFFFFF)
  g:drawString(text, CX, y)
end

local function draw()
  local t = touchscreen.read()
  g:fillScreen(0x000000)
  g:drawCircle(CX, CY, R - 1, 0x404040) -- the edge of the glass
  g:drawCircle(CX, CY, R - 6, 0x202020)
  g:setTextDatum(lgfx.TC_DATUM)
  g:setTextSize(1)
  line(26, s.w .. "x" .. s.h .. " " .. tostring(s.shape) .. " d" .. s.depth .. " " .. tostring(s.dpi) .. "dpi", 0xA0A0A0)
  line(38, tostring(s.controller) .. ", brightness " .. string.format("%.1f", s.brightness or 1), 0xA0A0A0)
  line(56, string.format("touch %s %d,%d", t.pressed and "DOWN" or "up", t.x, t.y), t.pressed and 0x3DDC84 or 0xFFFFFF)
  line(68, string.format("down %d move %d up %d tap %d", ev.touch_down, ev.touch_move, ev.touch_up, ev.touch_tap))
  line(80, "last: " .. last)
  line(92, string.format("B taps %d holds %d count %d", taps, holds, button.press_count()))
  -- screen verbs in the same frame
  screen.fill_rect(CX - 66, 108, 40, 12, 255, 0, 0)
  screen.fill_rect(CX - 20, 108, 40, 12, 0, 255, 0)
  screen.fill_rect(CX + 26, 108, 40, 12, 0, 0, 255)
  screen.text(CX - 18, 126, "screen", 1, 255, 200, 0)
  -- the ball chases the finger
  g:fillCircle(math.floor(bx), math.floor(by), 10, 0x3DDC84)
  if t.pressed then
    g:drawLine(t.x - 14, t.y, t.x + 14, t.y, 0xFF00FF)
    g:drawLine(t.x, t.y - 14, t.x, t.y + 14, 0xFF00FF)
    g:drawCircle(t.x, t.y, 8, 0xFF00FF)
  end
  g:flip()
end

function init(ctx)
  log.info("driver-check on " .. tostring(s.model))
  draw()
end

function on_tick(ctx, dt_ms)
  local t = touchscreen.read()
  if t.pressed then
    local k = math.min(1, dt_ms / 150)
    bx, by = bx + (t.x - bx) * k, by + (t.y - by) * k
  end
  draw()
end

function on_event(ctx, e)
  if ev[e.name] then
    ev[e.name] = ev[e.name] + 1
    last = string.format("%s %s,%s", e.name, tostring(e.data.x), tostring(e.data.y))
    if e.name == "touch_tap" then log.info(last) end
  elseif e.name == "tap" then
    taps = e.data.count
    last = "tap " .. tostring(e.data.index)
    log.info(last)
  elseif e.name == "hold" and e.data.held then
    holds = holds + 1
    dim = not dim
    screens.set("main", { brightness = dim and 0.3 or 1.0 })
    last = "hold " .. tostring(e.data.index)
    log.info(last)
  end
end
