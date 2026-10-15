// `button`: up to two keys, index 0 (key A) and 1 (key B). Gestures arrive in
// on_event as on the M5Stick and Bench: `tap` { index, count } on a release
// before 500 ms (with the legacy `button` event alongside), `hold`
// { index, held = true } at 500 ms and { held = false } on release.
// button.press_count() is taps since the app loaded, both keys together.
//
// Keys pull their pin to GND and get the internal pull-up. The Guition
// 4848S040 has none an app can use (BOOT and RST sit inside the case, and
// BOOT's GPIO0 is a red data line once the panel runs), so the module is here
// with no keys: button.press_count() stays 0 on the board's own, and Bench's
// taps arrive through it while Bench mirrors an app. The touch panel is
// Resident's system button instead (TouchDriver).
#pragma once
#include <cstdint>
#include <ResidentLuaModule.h>
#include <ResidentSystemButton.h>

class ButtonsDriver : public Resident::SystemButton {
public:
  ButtonsDriver(int8_t pinA, int8_t pinB = -1) : _keys{{pinA}, {pinB}} {}

  const char* name() const override { return "button"; }
  void registerModule(Resident::LuaModule& m) override {
    m.method<ButtonsDriver, &ButtonsDriver::pressCount>("press_count");
  }
  void begin() override;
  void update() override;
  void onAppReset() override { _taps = 0; }

  bool pressed() override { return _keys[0].down; }  // key A, debounced, for the runtime

private:
  static constexpr uint32_t DEBOUNCE_MS = 30;
  static constexpr uint32_t HOLD_MS = 500;

  struct Key {
    int8_t pin = -1;
    bool raw = false;      // last raw reading (true = pressed)
    bool down = false;     // debounced
    bool held = false;     // hold already sent for this press
    uint32_t changedMs = 0;
    uint32_t downMs = 0;
  };

  void updateKey(Key& k, int index, uint32_t now);
  int pressCount(lua_State* L);

  Key _keys[2];
  int _taps = 0;
};
