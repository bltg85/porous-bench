-- Driver check: exercises the guition-4848 firmware's modules (lgfx, screen, button, touchscreen, screens). Touch: a crosshair follows the finger and a ball chases it; tap the DIM box to dim the backlight. A border marks the outermost pixels.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local CX = W // 2
local bx, by = CX, H - 120
local dim = false
local ev = { touch_down = 0, touch_move = 0, touch_up = 0, touch_tap = 0 }
local last = "-"
local DIM_BOX = { x = CX - 90, y = 300, w = 180, h = 64 }

local function line(y, text, colour)
  g:setTextColor(colour or 0xFFFFFF)
  g:drawString(text, CX, y)
end

local function draw()
  local t = touchscreen.read()
  g:fillScreen(0x000000)
  g:drawRect(0, 0, W, H, 0x404040) -- the outermost pixels
  g:setTextDatum(lgfx.TC_DATUM)
  g:setTextSize(2)
  line(24, s.w .. "x" .. s.h .. " " .. tostring(s.shape) .. " d" .. s.depth .. " " .. tostring(s.dpi) .. "dpi", 0xA0A0A0)
  line(48, tostring(s.controller) .. ", brightness " .. string.format("%.1f", s.brightness or 1), 0xA0A0A0)
  line(84, string.format("touch %s %d,%d", t.pressed and "DOWN" or "up", t.x, t.y), t.pressed and 0x3DDC84 or 0xFFFFFF)
  line(108, string.format("down %d move %d up %d tap %d", ev.touch_down, ev.touch_move, ev.touch_up, ev.touch_tap))
  line(132, "last: " .. last)
  line(156, string.format("button count %d (Bench's)", button.press_count()))
  -- screen verbs in the same frame
  screen.fill_rect(CX - 132, 196, 80, 24, 255, 0, 0)
  screen.fill_rect(CX - 40, 196, 80, 24, 0, 255, 0)
  screen.fill_rect(CX + 52, 196, 80, 24, 0, 0, 255)
  screen.text(CX - 36, 236, "screen", 2, 255, 200, 0)
  -- a touch target
  g:fillRoundRect(DIM_BOX.x, DIM_BOX.y, DIM_BOX.w, DIM_BOX.h, 12, dim and 0xFFC040 or 0x2A3440)
  g:setTextDatum(lgfx.MC_DATUM)
  g:setTextSize(3)
  g:setTextColor(dim and 0x101418 or 0xFFFFFF)
  g:drawString("DIM", CX, DIM_BOX.y + DIM_BOX.h // 2)
  -- the ball chases the finger
  g:fillCircle(math.floor(bx), math.floor(by), 16, 0x3DDC84)
  if t.pressed then
    g:drawLine(t.x - 24, t.y, t.x + 24, t.y, 0xFF00FF)
    g:drawLine(t.x, t.y - 24, t.x, t.y + 24, 0xFF00FF)
    g:drawCircle(t.x, t.y, 12, 0xFF00FF)
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
    if e.name == "touch_tap" then
      log.info(last)
      local x, y = e.data.x, e.data.y
      if x >= DIM_BOX.x and x < DIM_BOX.x + DIM_BOX.w and y >= DIM_BOX.y and y < DIM_BOX.y + DIM_BOX.h then
        dim = not dim
        screens.set("main", { brightness = dim and 0.3 or 1.0 })
      end
    end
  elseif e.name == "tap" or e.name == "hold" then
    last = e.name .. " " .. tostring(e.data.index) .. " (from Bench)"
    log.info(last)
  end
end
