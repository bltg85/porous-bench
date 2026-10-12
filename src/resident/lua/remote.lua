-- porous.systems Bench remote: this app's inputs come from Bench (bench.porous.systems), which sends
-- their state over the relay as "bench" events. Bench's drivers (dial, trigger, light, pir,
-- climate, touch, ld2410, imu, and a silent buzzer) are defined here only where this firmware has
-- none. Each sits between "@@part <module>" and "@@end" lines: Bench sends only the parts the app
-- names, since every line here costs compile memory on the device. Bench's buttons A and B arrive
-- as the taps and holds Bench recognised, and touches on Bench's screen as touch_* events. The
-- board's own keys and touch panel still reach the app: a press on the real board always counts.
local __bench = { d = {}, t = {}, s = {}, g = {}, taps = 0 }
local __now = function() return (time and time.ticks_ms) and time.ticks_ms() or 0 end

-- @@part dial
if not dial then
  local D = {}
  D.__index = D
  local function get(self) return __bench.d[self.name] end
  function D:value() local v = get(self) return v and v[1] or self.start end
  function D:fraction() local v = get(self) return v and v[2] or 0 end
  -- Steps since the last call: Bench sends a running total of steps.
  function D:delta()
    local v = get(self)
    if not v then return 0 end
    local d = v[3] - (self.steps or v[3])
    self.steps = v[3]
    return d
  end
  dial = {
    new = function(name, opts)
      opts = opts or {}
      return setmetatable({ name = name, start = opts.start or opts.min or 0 }, D)
    end,
  }
end
-- @@end

-- @@part trigger
if not trigger then
  local T = {}
  T.__index = T
  local function get(self) return __bench.t[self.name] end
  function T:is_pressed() local v = get(self) return v ~= nil and v[3] == 1 end
  -- Bench sends press and release counts, so a press between two updates is never lost.
  function T:was_pressed()
    local v = get(self)
    if not v then return false end
    local fired = self.p ~= nil and v[1] > self.p
    self.p = v[1]
    return fired
  end
  function T:was_released()
    local v = get(self)
    if not v then return false end
    local fired = self.r ~= nil and v[2] > self.r
    self.r = v[2]
    return fired
  end
  function T:pressed_for(ms)
    local v = get(self)
    return v ~= nil and v[3] == 1 and __bench.since[self.name] ~= nil and __now() - __bench.since[self.name] >= ms
  end
  trigger = {
    new = function(name)
      local v = __bench.t[name]
      return setmetatable({ name = name, p = v and v[1], r = v and v[2] }, T)
    end,
  }
end
-- @@end
__bench.since = {}

-- Taps on Bench's buttons and on the board's own keys, counted together (see on_event below).
if button then pcall(function() button.press_count = function() return __bench.taps end end) end

local function sensor(key, default)
  return function() return __bench.s[key] or default end
end
-- @@part light
if not light then
  light = { read = sensor("light", { level = 0.5, lux = 300, raw = 2048 }) }
  function light.level() return light.read().level end
end
-- @@end
-- @@part pir
if not pir then
  pir = { read = sensor("pir", { motion = false }) }
  function pir.motion() return pir.read().motion end
end
-- @@end
-- @@part climate
if not climate then
  climate = { read = sensor("climate", { temperature = 21, humidity = 40 }) }
  function climate.temperature() return climate.read().temperature end
  function climate.humidity() return climate.read().humidity end
end
-- @@end
-- @@part touch
if not touch then
  touch = { read = sensor("touch", { touched = false, raw = 0 }) }
  function touch.touched() return touch.read().touched end
end
-- @@end
-- @@part ld2410
if not ld2410 then
  ld2410 = {
    begin = function() end,
    read = sensor("radar", { connected = true, moving = false, still = false, distance_cm = 0, moving_cm = 0,
      moving_energy = 0, still_cm = 0, still_energy = 0, out = false }),
  }
end
-- @@end
-- @@part imu
if not imu then
  imu = {
    accel = function() local a = __bench.s.imu or { 0, 0, 1 } return a[1], a[2], a[3] end,
    gyro = function() local a = __bench.s.imu or {} return a[4] or 0, a[5] or 0, a[6] or 0 end,
    temp = function() return 0 end,
  }
end
-- @@end
-- @@part touchscreen
if not touchscreen then
  touchscreen = { read = function() return __bench.touch or { pressed = false, x = 0, y = 0 } end }
  function touchscreen.pressed() return touchscreen.read().pressed end
end
-- @@end
-- @@part buzzer
if not buzzer then
  buzzer = { beep = function() end, tone = function() end, stop = function() end }
end
-- @@end

-- Apply one update from Bench, and raise the driver events the app would get on Bench itself.
local function __bench_apply(ctx, data, deliver)
  for name, v in pairs(data.d or {}) do
    local was = __bench.d[name]
    __bench.d[name] = v
    if was and was[1] ~= v[1] then deliver(ctx, "dial", { name = name, value = v[1], delta = v[3] - was[3] }) end
  end
  for name, v in pairs(data.t or {}) do
    local was = __bench.t[name]
    __bench.t[name] = v
    if v[3] == 1 and not (was and was[3] == 1) then __bench.since[name] = __now() end
    if was then
      for _ = was[1] + 1, v[1] do deliver(ctx, "trigger", { name = name, pressed = true }) end
      for _ = was[2] + 1, v[2] do deliver(ctx, "trigger", { name = name, pressed = false }) end
    end
  end
  -- Bench's buttons A and B: the taps and holds Bench recognised, replayed as they are, so both
  -- screens see the same gestures.
  for i, v in ipairs(data.g or {}) do
    local was = __bench.g[i]
    __bench.g[i] = v
    if was then
      local index = i - 1
      for _ = was[2] + 1, v[2] do deliver(ctx, "hold", { index = index, held = true }) end
      for _ = was[1] + 1, v[1] do
        __bench.taps = __bench.taps + 1
        deliver(ctx, "tap", { index = index, count = __bench.taps })
        deliver(ctx, "button", { index = index, count = __bench.taps })
      end
      for _ = was[3] + 1, v[3] do deliver(ctx, "hold", { index = index, held = false }) end
    end
  end
  -- Touches on Bench's screen, in order, with their points.
  local TOUCH = { d = "touch_down", m = "touch_move", u = "touch_up", t = "touch_tap" }
  local te = data.te or {}
  if __bench.te_seq == nil then
    __bench.te_seq = #te > 0 and te[#te][1] or 0 -- the first update is a baseline
  else
    for _, ev in ipairs(te) do
      if ev[1] > __bench.te_seq then
        __bench.te_seq = ev[1]
        __bench.touch = { pressed = ev[2] == "d" or ev[2] == "m", x = ev[3], y = ev[4] }
        deliver(ctx, TOUCH[ev[2]], { x = ev[3], y = ev[4] })
      end
    end
  end
  local s = data.s or {}
  local before = __bench.s
  -- A reading an update left out (to stay under the relay's size limit) keeps its last value.
  for k, v in pairs(before) do if s[k] == nil then s[k] = v end end
  __bench.s = s
  -- Changes only: the first reading of a sensor is where it starts, not an event.
-- @@part pir
  if s.pir and before.pir and before.pir.motion ~= s.pir.motion then deliver(ctx, "motion", { moving = s.pir.motion }) end
-- @@end
-- @@part touch
  if s.touch and before.touch and before.touch.touched ~= s.touch.touched then deliver(ctx, "touch", { touched = s.touch.touched }) end
-- @@end
-- @@part ld2410
  local r, was = s.radar, before.radar
  if r and was and (r.moving ~= was.moving or r.still ~= was.still) then
    deliver(ctx, "presence", { moving = r.moving, still = r.still, distance_cm = r.distance_cm })
  end
-- @@end
end

-- @@APP@@

-- porous.systems Bench remote: Bench's updates are handled here; every other event goes to the app.
do
  local app_on_event = on_event
  local function deliver(ctx, name, data)
    if app_on_event then app_on_event(ctx, { name = name, data = data, channel = "driver" }) end
  end
  function on_event(ctx, e)
    if e.name == "bench" and e.channel == "app" then
      __bench_apply(ctx, e.data or {}, deliver)
      return
    end
    -- The board's own keys reach the app too, counted with Bench's taps (tap comes before button).
    if (e.name == "tap" or e.name == "button") and e.channel ~= "app" and e.data then
      if e.name == "tap" then __bench.taps = __bench.taps + 1 end
      e.data.count = __bench.taps
    end
    if app_on_event then return app_on_event(ctx, e) end
  end
end
