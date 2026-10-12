-- IMU check: walks through a few moves and logs what the IMU reported for each, to map its axes onto Bench's. Follow the instruction on screen; each step moves on by itself once the board is held still.
local g = lgfx.bind("main")
local W, H = g:width(), g:height()
local abs, floor = math.abs, math.floor

local STEPS = {
  { "Lay it flat,", "screen up", "flat" },
  { "Tip the RIGHT", "edge down", "tilt" },
  { "Lay it flat", "again", "flat" },
  { "Tip the BOTTOM", "(USB-C) edge down", "tilt" },
  { "Lay it flat", "again", "flat" },
  { "Flat, turn it a", "quarter turn LEFT", "turn" },
  { "Done:", "thanks!", "done" },
}
local step, still, rot, results = 1, 0, { 0, 0, 0 }, {}
local a, gy = { 0, 0, 1 }, { 0, 0, 0 }

local function ready(kind)
  if kind == "flat" then return abs(a[3]) > 0.95 end
  if kind == "tilt" then return abs(a[1]) > 0.4 or abs(a[2]) > 0.4 end
  if kind == "turn" then return abs(a[3]) > 0.9 and (abs(rot[1]) + abs(rot[2]) + abs(rot[3])) > 45 end
  return false
end

local function draw()
  local s = STEPS[step]
  g:fillScreen(0x000000)
  g:setTextDatum(lgfx.TC_DATUM)
  g:setTextColor(0x808080); g:setTextSize(1)
  g:drawString(string.format("step %d of %d", step, #STEPS), W // 2, 12)
  g:setTextColor(0xFFFFFF); g:setTextSize(2)
  g:drawString(s[1], W // 2, 40)
  g:drawString(s[2], W // 2, 62)
  g:setTextDatum(lgfx.TL_DATUM); g:setTextSize(1)
  g:setTextColor(0xA0C0FF)
  g:setCursor(12, 100); g:print(string.format("accel  %5.2f %5.2f %5.2f g", a[1], a[2], a[3]))
  g:setCursor(12, 114); g:print(string.format("gyro   %6.1f %6.1f %6.1f dps", gy[1], gy[2], gy[3]))
  g:setCursor(12, 128); g:print(string.format("turned %6.0f %6.0f %6.0f deg", rot[1], rot[2], rot[3]))
  g:setTextColor(still > 0 and 0x3DDC84 or 0x606060)
  g:setCursor(12, 146); g:print(still > 0 and string.format("hold still... %d", 10 - still) or "move it")
  local y = 170
  g:setTextColor(0xFFC040)
  for _, r in ipairs(results) do g:setCursor(12, y) g:print(r) y = y + 12 end
  g:flip()
end

function init(ctx) draw() end

function on_tick(ctx, dt_ms)
  local dt = dt_ms / 1000
  a[1], a[2], a[3] = imu.accel()
  gy[1], gy[2], gy[3] = imu.gyro()
  for i = 1, 3 do rot[i] = rot[i] + gy[i] * dt end
  local s = STEPS[step]
  local calm = abs(gy[1]) + abs(gy[2]) + abs(gy[3]) < 8
  if s[3] ~= "done" and calm and ready(s[3]) then still = still + 1 else still = 0 end
  if still >= 10 then -- a second held still in the right pose
    local line = string.format("%d %s: a %.2f %.2f %.2f, turned %.0f %.0f %.0f", step, s[3], a[1], a[2], a[3],
      rot[1], rot[2], rot[3])
    log.info("IMU " .. line)
    if s[3] ~= "flat" then
      results[#results + 1] = string.format("%s a %.1f %.1f %.1f r %.0f %.0f %.0f", s[3], a[1], a[2], a[3], rot[1], rot[2], rot[3])
    end
    step, still, rot = step + 1, 0, { 0, 0, 0 }
  end
  draw()
end
