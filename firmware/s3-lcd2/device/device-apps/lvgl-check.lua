-- LVGL check: a few luavgl widgets on the s3-lcd2 firmware. An arc fills with the x tilt, a label counts BOOT taps.
local h = lvgl.bind("main")
local W, H = h.HOR_RES(), h.VER_RES()
h:set_theme { screen = { bg_color = 0x0B0B10 }, object = { bg_opa = 0, border_width = 0 } }
local title = h.Label { text = "LVGL " .. W .. "x" .. H, text_color = 0xFFFFFF, text_font = lvgl.Font("montserrat", 24),
  align = { type = lvgl.ALIGN.TOP_MID, y_ofs = 16 } }
local arc = h.Arc { w = 160, h = 160, align = lvgl.ALIGN.CENTER, range = { 0, 100 }, value = 50,
  arc_color = 0x3DDC84, arc_width = 14 }
local val = h.Label { text = "50", text_color = 0x3DDC84, text_font = lvgl.Font("montserrat", 36), align = lvgl.ALIGN.CENTER }
local taps = h.Label { text = "taps 0", text_color = 0xA0A0A0, align = { type = lvgl.ALIGN.BOTTOM_MID, y_ofs = -24 } }
local box = h.Object { x = 20, y = 70, w = 40, h = 40, bg_opa = 255, bg_color = 0xFF6A20, radius = 8 }
local n, t = 0, 0

lvgl.Timer { period = 33, cb = function()
  t = t + 0.033
  local ax = imu.accel()
  local v = math.floor(50 + 50 * math.max(-1, math.min(1, ax)))
  arc:set { value = v }
  val:set { text = tostring(v) }
  box:set { x = math.floor(20 + (W - 80) * (0.5 + 0.5 * math.sin(t * 2))) }
end }

function on_event(ctx, e)
  if e.name == "tap" then n = n + 1 taps:set { text = "taps " .. n } end
end
