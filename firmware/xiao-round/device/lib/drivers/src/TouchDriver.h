// `touchscreen`: the CHSC6X touch panel (I2C 0x2E), one finger, as Bench's
// touchscreen module. Its coordinates are the panel's own pixels, which are
// the ones apps draw in (checked in stage 1: a crosshair drawn at the reported
// point sits under the finger).
//
//   touchscreen.read()     -> { pressed = bool, x, y }: the last point touched
//   touchscreen.pressed()  -> bool
//
// Driver events, e.data = { x, y }: touch_down, touch_move (the newest point,
// at most once a loop, only when it moved), touch_up, and touch_tap after
// touch_up for a release within 500 ms that moved under 10 px.
//
// The chip doesn't answer while idle: INT (D7, GPIO44) goes low while a finger
// is down and once more on release, so it's read only then, or while a finger
// was down; a failed read is "no finger".
#pragma once
#include <cstdint>
#include <ResidentDriver.h>
#include <ResidentLuaModule.h>

class TouchDriver : public Resident::Driver {
public:
  const char* name() const override { return "touchscreen"; }
  void registerModule(Resident::LuaModule& m) override {
    m.method<TouchDriver, &TouchDriver::read>("read");
    m.method<TouchDriver, &TouchDriver::isPressed>("pressed");
  }
  void begin() override;
  void update() override;
  void onAppReset() override { _down = false; }

private:
  static constexpr uint8_t ADDR = 0x2E;
  static constexpr int PIN_INT = 44;
  static constexpr uint32_t POLL_MS = 10;
  static constexpr uint32_t TAP_MS = 500;
  static constexpr int TAP_PX = 10;

  void send(const char* event);
  int read(lua_State* L);
  int isPressed(lua_State* L);

  bool _down = false;
  int _x = 0, _y = 0;           // the last point touched
  int _startX = 0, _startY = 0; // where this touch began
  int _maxMove = 0;             // furthest it moved from there, px
  uint32_t _downMs = 0, _lastPoll = 0;
  uint32_t _intEdges = 0;       // INT's falling edges seen so far
};
