#include "Lcd.h"

namespace Lcd {

GFXcanvas16* canvas = nullptr;
Panel panel;

static uint32_t _lastPushUs = 0;
static uint32_t _frames = 0, _rows = 0, _pushUs = 0;

bool begin() {
  if (!RgbPanel::begin()) return false;  // ST7701S init, the scan, the backlight
  canvas = new Canvas(WIDTH, HEIGHT);    // 450 KB: Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) return false;
  canvas->fillScreen(0);
  present();
  return true;
}

void present() {
  Canvas* c = static_cast<Canvas*>(canvas);
  c->y0 = HEIGHT;
  c->y1 = -1;
  presentRows(0, HEIGHT - 1);
}

// An app that redraws only what moves pushes only those rows: a clock's hands
// are a band of the screen, not all 450 KB.
void presentDirty() {
  Canvas* c = static_cast<Canvas*>(canvas);
  int y0 = c->y0, y1 = c->y1;
  c->y0 = HEIGHT;
  c->y1 = -1;
  presentRows(y0, y1);
}

void presentRows(int y0, int y1) {
  y0 = max(y0, 0);
  y1 = min(y1, HEIGHT - 1);
  if (y1 < y0) return;
  uint32_t t0 = micros();
  // Whole rows are contiguous in the canvas, so a band goes out as one copy.
  RgbPanel::drawRows(canvas->getBuffer() + y0 * WIDTH, y0, y1);
  _lastPushUs = micros() - t0;
  _frames++;
  _rows += y1 - y0 + 1;
  _pushUs += _lastPushUs;
}

void resync() {
  if (!RgbPanel::restart()) Serial.println("[lcd] restarting the scan FAILED");
  present();
}

void setBrightness(float v) { RgbPanel::setBacklight(v); }

float brightness() { return RgbPanel::backlight(); }

uint32_t lastPushUs() { return _lastPushUs; }

void takeStats(uint32_t& frames, uint32_t& rows, uint32_t& pushUs) {
  frames = _frames;
  rows = _rows;
  pushUs = _pushUs;
  _frames = _rows = _pushUs = 0;
}

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  // Clip to the canvas, then copy row by row, back to the chip's byte order.
  int32_t x0 = max(x, (int32_t)0), x1 = min(x + w, (int32_t)WIDTH);
  int32_t r0 = max(y, (int32_t)0), r1 = min(y + h, (int32_t)HEIGHT);
  if (x1 <= x0 || r1 <= r0) return;
  uint16_t* buf = canvas->getBuffer();
  for (int32_t cy = r0; cy < r1; cy++) {
    const uint16_t* src = px + (cy - y) * w + (x0 - x);
    uint16_t* dst = buf + cy * WIDTH + x0;
    for (int32_t n = x1 - x0; n > 0; n--) *dst++ = __builtin_bswap16(*src++);
  }
  static_cast<Canvas*>(canvas)->mark(r0, r1 - 1);
}

// LVGL's frame is whole in the canvas: send its rows out together.
void Panel::frameDone() { presentDirty(); }

}  // namespace Lcd
