#include "ButtonsDriver.h"
#include <Arduino.h>

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

void ButtonsDriver::begin() {
  for (int i = 0; i < 2; i++) {
    if (_keys[i].pin < 0) continue;
    pinMode(_keys[i].pin, INPUT_PULLUP);
    Serial.printf("[button] %d on GPIO %d\n", i, _keys[i].pin);
  }
}

void ButtonsDriver::update() {
  uint32_t now = millis();
  for (int i = 0; i < 2; i++) {
    if (_keys[i].pin >= 0) updateKey(_keys[i], i, now);
  }
}

void ButtonsDriver::updateKey(Key& k, int index, uint32_t now) {
  bool raw = digitalRead(k.pin) == LOW;
  if (raw != k.raw) { k.raw = raw; k.changedMs = now; }

  if (k.raw != k.down && now - k.changedMs >= DEBOUNCE_MS) {
    k.down = k.raw;
    if (k.down) {
      k.downMs = now;
      k.held = false;
    } else if (k.held) {
      Resident::EventField f[] = {
        {"index", Resident::EventField::INT, {.i = index}},
        {"held", Resident::EventField::BOOL, {.b = false}},
      };
      sendEvent("hold", f, 2);
    } else {
      _taps++;
      Resident::EventField f[] = {
        {"index", Resident::EventField::INT, {.i = index}},
        {"count", Resident::EventField::INT, {.i = _taps}},
      };
      sendEvent("tap", f, 2);
      sendEvent("button", f, 2);  // legacy name, alongside tap
    }
  }

  if (k.down && !k.held && now - k.downMs >= HOLD_MS) {
    k.held = true;
    Resident::EventField f[] = {
      {"index", Resident::EventField::INT, {.i = index}},
      {"held", Resident::EventField::BOOL, {.b = true}},
    };
    sendEvent("hold", f, 2);
  }
}

int ButtonsDriver::pressCount(lua_State* L) {
  lua_pushinteger(L, _taps);
  return 1;
}
