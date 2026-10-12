#include "TouchDriver.h"
#include <Arduino.h>
#include "Bus.h"
#include "Lcd.h"

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

// Falling edges on INT, counted by interrupt: a pulse between two polls still
// says the chip has something to report.
static volatile uint32_t s_intEdges = 0;
static void IRAM_ATTR onInt() { s_intEdges++; }

#ifdef TOUCH_DEBUG
static uint32_t s_pollsLow = 0, s_reads = 0, s_readsOk = 0, s_readsDown = 0;
#endif

void TouchDriver::begin() {
  Bus::begin();
  pinMode(PIN_INT, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_INT), onInt, FALLING);
  // The touch chip answers only while touched; the RTC on the same bus always
  // does, unless the display board's power switch is off.
  Wire.beginTransmission(0x51);
  bool powered = Wire.endTransmission() == 0;
  Serial.printf("[touch] CHSC6X at 0x2E, INT on GPIO%d; %s\n", PIN_INT,
                powered ? "display board powered (RTC answers)" : "NO ANSWER on I2C: is the display's power switch on?");
}

void TouchDriver::send(const char* event) {
  Resident::EventField f[] = {
    {"x", Resident::EventField::INT, {.i = _x}},
    {"y", Resident::EventField::INT, {.i = _y}},
  };
  sendEvent(event, f, 2);
}

void TouchDriver::update() {
  uint32_t now = millis();
  if (now - _lastPoll < POLL_MS) return;
  _lastPoll = now;

  uint32_t edges = s_intEdges;
  bool edge = edges != _intEdges;
  _intEdges = edges;
  bool low = digitalRead(PIN_INT) == LOW;
#ifdef TOUCH_DEBUG
  static uint32_t lastDbg = 0, lastEdges = 0;
  if (low) s_pollsLow++;
  if (now - lastDbg >= 1000) {
    lastDbg = now;
    if (edges != lastEdges || s_reads)
      Serial.printf("[touchdbg] 1 s: %lu INT edges, %lu polls saw INT low, %lu reads (%lu answered, %lu finger down)\n",
                    (unsigned long)(edges - lastEdges), (unsigned long)s_pollsLow, (unsigned long)s_reads,
                    (unsigned long)s_readsOk, (unsigned long)s_readsDown);
    lastEdges = edges;
    s_pollsLow = s_reads = s_readsOk = s_readsDown = 0;
  }
#endif
  if (!edge && !low && !_down) return;

  // 5 bytes, no register (as Seeed's driver reads it): byte 0 is 1 while a
  // finger is down, x in byte 2, y in byte 4.
  uint8_t b[5] = {0};
  bool down = false;
  if (Wire.requestFrom(ADDR, (uint8_t)5) == 5) {
    for (uint8_t& v : b) v = Wire.read();
    down = b[0] == 0x01;
  }
#ifdef TOUCH_DEBUG
  s_reads++;
  if (b[0] || b[1] || b[2] || b[4]) s_readsOk++;
  if (down) s_readsDown++;
#endif
  int x = _x, y = _y;
  if (down) {
    x = constrain((int)b[2], 0, Lcd::WIDTH - 1);
    y = constrain((int)b[4], 0, Lcd::HEIGHT - 1);
  }

  if (down && !_down) {
    _down = true;
    _x = _startX = x;
    _y = _startY = y;
    _maxMove = 0;
    _downMs = now;
    send("touch_down");
  } else if (down && (x != _x || y != _y)) {
    _x = x;
    _y = y;
    _maxMove = max(_maxMove, max(abs(x - _startX), abs(y - _startY)));
    send("touch_move");
  } else if (!down && _down) {
    _down = false;
    send("touch_up");
    if (now - _downMs < TAP_MS && _maxMove < TAP_PX) send("touch_tap");
  }
}

int TouchDriver::read(lua_State* L) {
  lua_createtable(L, 0, 3);
  lua_pushboolean(L, _down);
  lua_setfield(L, -2, "pressed");
  lua_pushinteger(L, _x);
  lua_setfield(L, -2, "x");
  lua_pushinteger(L, _y);
  lua_setfield(L, -2, "y");
  return 1;
}

int TouchDriver::isPressed(lua_State* L) {
  lua_pushboolean(L, _down);
  return 1;
}
