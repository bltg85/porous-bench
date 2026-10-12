#include "TouchDriver.h"
#include <Arduino.h>
#include "Bus.h"
#include "Lcd.h"

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

void TouchDriver::begin() {
  Bus::begin();
  uint8_t id = 0;
  bool ok = Bus::readRegs(ADDR, 0xA7, &id, 1);  // chip ID (0xB6 on a CST816D); asleep = no answer
  Serial.printf("[touch] CST816D %s (chip ID 0x%02X)\n", ok ? "answers" : "asleep until touched", id);
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

  // Register 0x02: finger count, then X (12 bits) and Y.
  uint8_t b[5];
  bool down = Bus::readRegs(ADDR, 0x02, b, 5) && (b[0] & 0x0F) > 0;
  int x = _x, y = _y;
  if (down) {
    x = constrain(((b[1] & 0x0F) << 8) | b[2], 0, Lcd::WIDTH - 1);
    y = constrain(((b[3] & 0x0F) << 8) | b[4], 0, Lcd::HEIGHT - 1);
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
