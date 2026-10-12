-- Driver check: exercises the s3-lcd2 firmware's modules (lgfx, screen, button, touchscreen, imu, screens). Tilt it: the ball should roll downhill. Touch: a crosshair follows the finger. BOOT: tap +1, hold dims the backlight.
local g = lgfx.bind("main")
local s = screens.get("main")
local W, H = g:width(), g:height()
local bx, by, vx, vy = W / 2, 200, 0, 0
local taps, holds, dim = 0, 0, false
local ev = { touch_down = 0, touch_move = 0, touch_up = 0, touch_tap = 0 }
local last = "-"

local function draw()
  local ax, ay, az = imu.accel()
  local gx, gy, gz = imu.gyro()
  local t = touchscreen.read()
  g:fillScreen(0x000000)
  g:drawRect(0, 0, W, H, 0x404040)
  g:setTextDatum(lgfx.TL_DATUM)
  g:setTextSize(1)
  g:setTextColor(0xA0A0A0)
  g:setCursor(8, 8); g:print(s.w .. "x" .. s.h .. " d" .. s.depth .. " " .. tostring(s.dpi) .. "dpi " .. tostring(s.controller))
  g:setTextColor(0xFFFFFF)
  g:setCursor(8, 22); g:print(string.format("accel %5.2f %5.2f %5.2f g", ax, ay, az))
  g:setCursor(8, 34); g:print(string.format("gyro %6.1f %6.1f %6.1f dps", gx, gy, gz))
  g:setCursor(8, 46); g:print(string.format("temp %.1f C", imu.temp()))
  g:setCursor(8, 60); g:print(string.format("touch %s %d,%d", t.pressed and "DOWN" or "up", t.x, t.y))
  g:setCursor(8, 72); g:print(string.format("down %d move %d up %d tap %d", ev.touch_down, ev.touch_move, ev.touch_up, ev.touch_tap))
  g:setCursor(8, 84); g:print("last event: " .. last)
  g:setCursor(8, 96); g:print(string.format("BOOT taps %d holds %d  press_count %d", taps, holds, button.press_count()))
  -- screen verbs in the same frame
  screen.fill_rect(8, 110, 40, 12, 255, 0, 0)
  screen.fill_rect(52, 110, 40, 12, 0, 255, 0)
  screen.fill_rect(96, 110, 40, 12, 0, 0, 255)
  screen.text(144, 112, "screen", 1, 255, 200, 0)
  -- the ball: should roll to whichever edge is lowest
  g:drawRect(8, 130, W - 16, H - 140, 0x204060)
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

local logT = 0
function on_tick(ctx, dt_ms)
  local dt = dt_ms / 1000
  local ax, ay, az = imu.accel()
  logT = logT + dt
  if logT >= 1 then -- for checking the axes over serial
    logT = 0
    log.info(string.format("accel %.2f %.2f %.2f", ax, ay, az))
  end
  vx, vy = (vx + ax * 600 * dt) * 0.96, (vy + ay * 600 * dt) * 0.96
  bx, by = bx + vx * dt, by + vy * dt
  if bx < 20 then bx, vx = 20, 0 elseif bx > W - 20 then bx, vx = W - 20, 0 end
  if by < 142 then by, vy = 142, 0 elseif by > H - 20 then by, vy = H - 20, 0 end
  draw()
end

function on_event(ctx, e)
  if ev[e.name] then
    ev[e.name] = ev[e.name] + 1
    last = string.format("%s %s,%s", e.name, tostring(e.data.x), tostring(e.data.y))
  elseif e.name == "tap" then
    taps = e.data.count
    last = "tap " .. tostring(e.data.index)
  elseif e.name == "hold" and e.data.held then
    holds = holds + 1
    dim = not dim
    screens.set("main", { brightness = dim and 0.3 or 1.0 })
    last = "hold " .. tostring(e.data.index)
  end
end
