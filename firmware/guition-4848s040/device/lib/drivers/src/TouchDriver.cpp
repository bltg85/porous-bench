#include "TouchDriver.h"
#include <Arduino.h>
#include "Bus.h"
#include "Lcd.h"

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

// GT911 registers.
static constexpr uint16_t REG_PRODUCT = 0x8140;  // "911" in ASCII
static constexpr uint16_t REG_STATUS = 0x814E;   // bit 7: a report is ready; bits 0-3: fingers
static constexpr uint16_t REG_POINT1 = 0x8150;   // x low, x high, y low, y high

void TouchDriver::begin() {
  Bus::begin();
  uint8_t id[4] = {0};
  _found = Bus::readRegs(ADDR, REG_PRODUCT, id, 4);
  Serial.printf("[touch] GT911 at 0x%02X on SDA %d, SCL %d: %s%.4s\n", ADDR, Bus::PIN_SDA, Bus::PIN_SCL,
                _found ? "product " : "NO ANSWER", _found ? (const char*)id : "");
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
  if (!_found || now - _lastPoll < POLL_MS) return;
  _lastPoll = now;

  uint8_t status = 0;
  if (!Bus::readRegs(ADDR, REG_STATUS, &status, 1)) return;
  bool down = _down;
  int x = _x, y = _y;
  if (status & 0x80) {
    // A fresh report: read the first finger, then hand the buffer back.
    _lastReport = now;
    down = (status & 0x0F) > 0;
    uint8_t p[4];
    if (down && Bus::readRegs(ADDR, REG_POINT1, p, 4)) {
      x = constrain((int)(p[0] | (p[1] << 8)), 0, Lcd::WIDTH - 1);
      y = constrain((int)(p[2] | (p[3] << 8)), 0, Lcd::HEIGHT - 1);
    }
    Bus::writeReg(ADDR, REG_STATUS, 0);
  } else if (_down && now - _lastReport > STALE_MS) {
    down = false;
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
