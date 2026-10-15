// `touchscreen`: the GT911 touch panel (I2C 0x5D), one finger, as Bench's
// touchscreen module. It reports in panel pixels (0-479), which should be the
// ones apps draw in: stage 1 draws a crosshair at the reported point to check.
//
//   touchscreen.read()     -> { pressed = bool, x, y }: the last point touched
//   touchscreen.pressed()  -> bool
//
// Driver events, e.data = { x, y }: touch_down, touch_move (the newest point,
// at most once a loop, only when it moved), touch_up, and touch_tap after
// touch_up for a release within 500 ms that moved under 10 px.
//
// INT and RST aren't wired, so the chip is polled every 10 ms: its status
// register says whether a new report is ready and how many fingers it holds.
//
// The board has no key an app can use, so the touch panel is also Resident's
// system button: during the boot countdown, a touch anywhere loads the saved
// app now and a long one forgets it.
#pragma once
#include <cstdint>
#include <ResidentLuaModule.h>
#include <ResidentSystemButton.h>

class TouchDriver : public Resident::SystemButton {
public:
  const char* name() const override { return "touchscreen"; }
  void registerModule(Resident::LuaModule& m) override {
    m.method<TouchDriver, &TouchDriver::read>("read");
    m.method<TouchDriver, &TouchDriver::isPressed>("pressed");
  }
  void begin() override;
  void update() override;
  void onAppReset() override { _down = false; }

  bool pressed() override { return _down; }  // for the runtime: the system button

private:
  static constexpr uint8_t ADDR = 0x5D;
  static constexpr uint32_t POLL_MS = 10;
  static constexpr uint32_t TAP_MS = 500;
  static constexpr int TAP_PX = 10;
  // A finger with no fresh report for this long has gone: a release whose
  // report was missed doesn't leave a touch held for good.
  static constexpr uint32_t STALE_MS = 200;

  void send(const char* event);
  int read(lua_State* L);
  int isPressed(lua_State* L);

  bool _found = false;
  bool _down = false;
  int _x = 0, _y = 0;           // the last point touched
  int _startX = 0, _startY = 0; // where this touch began
  int _maxMove = 0;             // furthest it moved from there, px
  uint32_t _downMs = 0, _lastPoll = 0, _lastReport = 0;
};
