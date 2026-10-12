// The one frame buffer every drawing path shares: screen.* verbs, lgfx and
// the status text all draw into `canvas`, a 240x320 RGB565 GFXcanvas16
// (150 KB, in PSRAM).
//
// Pushes go to the ST7789T3 at 80 MHz: present() the whole canvas (~25 ms),
// presentDirty() only the rows drawn since the last push (what lgfx and screen
// flips use), LVGL's flushes each rectangle it redrew.
#pragma once
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <ResidentRenderTargets.h>

namespace Lcd {

constexpr int WIDTH = 240, HEIGHT = 320;

// The canvas remembers which rows were drawn since the last push: everything
// Adafruit GFX draws (text and shapes included) goes through these four.
class Canvas : public GFXcanvas16 {
public:
  Canvas(uint16_t w, uint16_t h) : GFXcanvas16(w, h) {}
  void drawPixel(int16_t x, int16_t y, uint16_t c) override { mark(y, y); GFXcanvas16::drawPixel(x, y, c); }
  void fillScreen(uint16_t c) override { mark(0, HEIGHT - 1); GFXcanvas16::fillScreen(c); }
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t c) override {
    mark(y, y + h - 1);
    GFXcanvas16::drawFastVLine(x, y, h, c);
  }
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t c) override {
    mark(y, y);
    GFXcanvas16::drawFastHLine(x, y, w, c);
  }
  void mark(int a, int b) {
    if (a < y0) y0 = a;
    if (b > y1) y1 = b;
  }
  int y0 = HEIGHT, y1 = -1;  // rows drawn since the last push
};

extern GFXcanvas16* canvas;

inline uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}
inline uint16_t rgb565(uint32_t rgb888) {
  return rgb565((rgb888 >> 16) & 0xFF, (rgb888 >> 8) & 0xFF, rgb888 & 0xFF);
}

bool begin();                  // panel, backlight, canvas; false if the canvas didn't fit
void present();                // push the canvas to the glass
void presentDirty();           // push only the rows drawn since the last push (lgfx and screen flips)
void presentRows(int y0, int y1);  // push rows y0..y1 (inclusive) only
void setBrightness(float v);   // backlight, 0..1 (PWM duty)
float brightness();
uint32_t lastPushUs();
// Since the last call: frames pushed, rows pushed and push time in total (for the heartbeat).
void takeStats(uint32_t& frames, uint32_t& rows, uint32_t& pushUs);

// The panel as Resident's screens registry sees it ("main"). blit() takes
// RGB565 big-endian rectangles (LVGL's flushes): each goes straight to the
// glass from LVGL's buffer (already in the panel's byte order), so a frame
// costs only what LVGL redrew, and into the canvas, so screen/lgfx and a later
// full push agree with the glass.
class Panel : public Resident::PanelTarget {
public:
  int32_t width() const override { return WIDTH; }
  int32_t height() const override { return HEIGHT; }
  void blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) override;
  void frameDone() override;
};

extern Panel panel;

}  // namespace Lcd
