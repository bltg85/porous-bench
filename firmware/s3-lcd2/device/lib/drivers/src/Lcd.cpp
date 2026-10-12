#include "Lcd.h"
#include <SPI.h>
#include <Adafruit_ST7789.h>

namespace Lcd {

// Wiring, fixed on the board.
static constexpr int PIN_MOSI = 38, PIN_SCLK = 39, PIN_MISO = 40;  // MISO only reaches the TF card
static constexpr int PIN_CS = 45, PIN_DC = 42, PIN_BL = 1;  // the LCD's reset isn't wired
static constexpr int PIN_SD_CS = 41;
static constexpr uint32_t SPI_HZ = 80000000;  // as Waveshare's demo runs it

static Adafruit_ST7789 tft(&SPI, PIN_CS, PIN_DC, -1);  // -1: software reset (0x01)
GFXcanvas16* canvas = nullptr;
Panel panel;

static float _brightness = 1.0f;
static uint32_t _lastPushUs = 0;
static uint32_t _frames = 0, _rows = 0, _pushUs = 0;

bool begin() {
  // The TF card shares the bus (unused): keep it deselected.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);

  tft.init(WIDTH, HEIGHT);  // SWRESET, INVON; 240x320 has no RAM offset
  tft.setSPISpeed(SPI_HZ);
  tft.setRotation(2);       // the panel's native scan (MADCTL 0x00): USB-C at the bottom
  tft.fillScreen(ST77XX_BLACK);

  // Backlight: plain PWM, dark until driven; 10 kHz, 10-bit, as Waveshare runs it.
  ledcSetup(0, 10000, 10);
  ledcAttachPin(PIN_BL, 0);
  setBrightness(1.0f);

  canvas = new Canvas(WIDTH, HEIGHT);  // 150 KB: Arduino puts big blocks in PSRAM
  return canvas && canvas->getBuffer();
}

void present() {
  Canvas* c = static_cast<Canvas*>(canvas);
  c->y0 = HEIGHT;
  c->y1 = -1;
  presentRows(0, HEIGHT - 1);
}

// An app that redraws only what moves pushes only those rows: a flame over a
// still room is half the screen or less, not all 150 KB.
void presentDirty() {
  Canvas* c = static_cast<Canvas*>(canvas);
  int y0 = c->y0, y1 = c->y1;
  c->y0 = HEIGHT;
  c->y1 = -1;
  presentRows(y0, y1);
}

void setBrightness(float v) {
  _brightness = constrain(v, 0.0f, 1.0f);
  ledcWrite(0, (uint32_t)(_brightness * 1023.0f + 0.5f));
}

float brightness() { return _brightness; }

uint32_t lastPushUs() { return _lastPushUs; }

void takeStats(uint32_t& frames, uint32_t& rows, uint32_t& pushUs) {
  frames = _frames;
  rows = _rows;
  pushUs = _pushUs;
  _frames = _rows = _pushUs = 0;
}

void presentRows(int y0, int y1) {
  y0 = max(y0, 0);
  y1 = min(y1, HEIGHT - 1);
  if (y1 < y0) return;
  uint32_t t0 = micros();
  // Whole rows are contiguous in the canvas, so a band goes out as one bitmap.
  tft.drawRGBBitmap(0, y0, canvas->getBuffer() + y0 * WIDTH, WIDTH, y1 - y0 + 1);
  _lastPushUs = micros() - t0;
  _frames++;
  _rows += y1 - y0 + 1;
  _pushUs += _lastPushUs;
}

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  // Clip to the canvas, then copy row by row, back to the canvas's native order.
  int32_t x0 = max(x, (int32_t)0), x1 = min(x + w, (int32_t)WIDTH);
  int32_t r0 = max(y, (int32_t)0), r1 = min(y + h, (int32_t)HEIGHT);
  if (x1 <= x0 || r1 <= r0) return;
  uint16_t* buf = canvas->getBuffer();
  for (int32_t cy = r0; cy < r1; cy++) {
    const uint16_t* src = px + (cy - y) * w + (x0 - x);
    uint16_t* dst = buf + cy * WIDTH + x0;
    for (int32_t n = x1 - x0; n > 0; n--) *dst++ = __builtin_bswap16(*src++);
  }

  uint32_t t0 = micros();
  tft.startWrite();
  if (x0 == x && x1 == x + w && r0 == y && r1 == y + h) {
    tft.setAddrWindow(x, y, w, h);
    tft.writePixels((uint16_t*)px, (uint32_t)w * h, true, true);  // big-endian: out as it is
  } else {  // clipped (LVGL doesn't, but just in case): from the canvas
    tft.setAddrWindow(x0, r0, x1 - x0, r1 - r0);
    for (int32_t cy = r0; cy < r1; cy++) tft.writePixels(buf + cy * WIDTH + x0, x1 - x0, true, false);
  }
  tft.endWrite();
  _pushUs += micros() - t0;
  _rows += r1 - r0;
}

void Panel::frameDone() { _frames++; }

}  // namespace Lcd
