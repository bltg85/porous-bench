// The one frame buffer every drawing path shares: screen.* verbs, lgfx and
// the status text all draw into `canvas`, a 240x320 RGB565 GFXcanvas16
// (150 KB, in PSRAM).
//
// present() pushes the whole canvas to the ST7789T3 in one transfer: ~25 ms
// at 80 MHz (measured in stage 1), inside the caller's Lua dispatch, well
// under the sandbox's 1 s deadline.
#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <ResidentRenderTargets.h>

namespace Lcd {

constexpr int WIDTH = 240, HEIGHT = 320;

extern GFXcanvas16* canvas;

inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
inline uint16_t rgb565(uint32_t rgb888) {
  return rgb565((rgb888 >> 16) & 0xFF, (rgb888 >> 8) & 0xFF, rgb888 & 0xFF);
}

bool begin();                  // panel, backlight, canvas; false if the canvas didn't fit
void present();                // push the canvas to the glass
void setBrightness(float v);   // backlight, 0..1 (PWM duty)
float brightness();
uint32_t lastPushUs();

// The panel as Resident's screens registry sees it ("main"). blit() takes
// RGB565 big-endian rectangles into the canvas; frameDone() presents.
class Panel : public Resident::PanelTarget {
public:
  int32_t width() const override { return WIDTH; }
  int32_t height() const override { return HEIGHT; }
  void blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) override;
  void frameDone() override { present(); }
};

extern Panel panel;

}  // namespace Lcd
