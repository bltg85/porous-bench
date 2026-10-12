-- LVGL check: a few luavgl widgets on the xiao-round firmware. The arc follows a finger round the dial, a box slides, a label counts B (BOOT) taps.
local h = lvgl.bind("main")
local W, H = h.HOR_RES(), h.VER_RES()
h:set_theme { screen = { bg_color = 0x0B0B10 }, object = { bg_opa = 0, border_width = 0 } }
local title = h.Label { text = "LVGL " .. W .. "x" .. H, text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 20),
  align = { type = lvgl.ALIGN.TOP_MID, y_ofs = 24 } }
local arc = h.Arc { w = 150, h = 150, align = lvgl.ALIGN.CENTER, range = { 0, 100 }, value = 50,
  arc_color = 0x3DDC84, arc_width = 14 }
local val = h.Label { text = "50", text_color = 0x3DDC84, text_font = lvgl.Font("montserrat", 32), align = lvgl.ALIGN.CENTER }
local taps = h.Label { text = "taps 0", text_color = 0xA0A0A0, align = { type = lvgl.ALIGN.BOTTOM_MID, y_ofs = -26 } }
local box = h.Object { x = 40, y = 182, w = 24, h = 24, bg_opa = 255, bg_color = 0xFF6A20, radius = 6 }
local n, t = 0, 0

lvgl.Timer { period = 33, cb = function()
  t = t + 0.033
  local p = touchscreen.read()
  if p.pressed then
    -- The finger's angle as LVGL measures the arc's: degrees clockwise from 3
    -- o'clock (y points down). The arc sweeps 270 degrees clockwise from 135.
    local deg = math.deg(math.atan(p.y - H / 2, p.x - W / 2)) % 360
    local rel = (deg - 135) % 360
    if rel > 270 then rel = rel > 315 and 0 or 270 end -- the gap at the bottom: the nearer end
    local v = math.floor(rel / 270 * 100 + 0.5)
    arc:set { value = v }
    val:set { text = tostring(v) }
  end
  box:set { x = math.floor(W / 2 - 12 + 50 * math.sin(t * 2)) }
end }

function on_event(ctx, e)
  if e.name == "tap" then n = n + 1 taps:set { text = "taps " .. n } end
end
