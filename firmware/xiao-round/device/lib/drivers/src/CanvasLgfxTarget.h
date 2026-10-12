// Resident's `lgfx` module drawing straight into the shared RGB565 frame, so
// `lgfx` and `screen` hit the same buffer (as on Bench) and the module
// doesn't keep a second 150 KB sprite. pixels() stays null, so the module
// presents through flip(), which pushes the frame like screen.flip().
//
// Text uses the same 6x8 built-in font as LovyanGFX's default, so widths and
// datums match Bench: setTextSize rounds to a whole multiplier.
#pragma once
#include <ResidentLgfxModule.h>
#include "Lcd.h"

class CanvasLgfxTarget : public Resident::LgfxTarget {
public:
  void fillScreen(uint32_t c) override { cv().fillScreen(Lcd::rgb565(c)); }
  void drawPixel(int32_t x, int32_t y, uint32_t c) override { cv().drawPixel(x, y, Lcd::rgb565(c)); }
  void drawLine(int32_t x0, int32_t y0, int32_t x1, int32_t y1, uint32_t c) override {
    cv().drawLine(x0, y0, x1, y1, Lcd::rgb565(c));
  }
  void drawRect(int32_t x, int32_t y, int32_t w, int32_t h, uint32_t c) override {
    cv().drawRect(x, y, w, h, Lcd::rgb565(c));
  }
  void fillRect(int32_t x, int32_t y, int32_t w, int32_t h, uint32_t c) override {
    cv().fillRect(x, y, w, h, Lcd::rgb565(c));
  }
  void drawRoundRect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t r, uint32_t c) override {
    cv().drawRoundRect(x, y, w, h, r, Lcd::rgb565(c));
  }
  void fillRoundRect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t r, uint32_t c) override {
    cv().fillRoundRect(x, y, w, h, r, Lcd::rgb565(c));
  }
  void drawCircle(int32_t x, int32_t y, int32_t r, uint32_t c) override {
    cv().drawCircle(x, y, r, Lcd::rgb565(c));
  }
  void fillCircle(int32_t x, int32_t y, int32_t r, uint32_t c) override {
    cv().fillCircle(x, y, r, Lcd::rgb565(c));
  }
  void drawTriangle(int32_t x0, int32_t y0, int32_t x1, int32_t y1,
                    int32_t x2, int32_t y2, uint32_t c) override {
    cv().drawTriangle(x0, y0, x1, y1, x2, y2, Lcd::rgb565(c));
  }
  void fillTriangle(int32_t x0, int32_t y0, int32_t x1, int32_t y1,
                    int32_t x2, int32_t y2, uint32_t c) override {
    cv().fillTriangle(x0, y0, x1, y1, x2, y2, Lcd::rgb565(c));
  }

  void setTextColor(uint32_t fg, uint32_t bg, bool hasBg) override {
    if (hasBg) cv().setTextColor(Lcd::rgb565(fg), Lcd::rgb565(bg));
    else cv().setTextColor(Lcd::rgb565(fg));
  }
  void setTextSize(float size) override {
    _size = (uint8_t)constrain((int)(size + 0.5f), 1, 16);
    cv().setTextSize(_size);
  }
  void setTextDatum(uint8_t datum) override { _datum = datum; }
  void setCursor(int32_t x, int32_t y) override { cv().setCursor(x, y); }
  void print(const char* text) override { cv().setTextSize(_size); cv().print(text); }

  // Datum maths as Bench's: column from the low 2 bits, row from bits 2-3,
  // baselines (>= 16) at 7/8 of the 8 px font.
  void drawString(const char* text, int32_t x, int32_t y) override {
    int32_t w = (int32_t)strlen(text) * 6 * _size;
    int32_t h = 8 * _size;
    int col = _datum & 3;
    int32_t dx = col == 1 ? w / 2 : col == 2 ? w : 0;
    int32_t dy = 0;
    if (_datum >= 16) dy = h * 7 / 8;
    else if ((_datum & 12) == 4) dy = h / 2;
    else if ((_datum & 12) == 8) dy = h;
    cv().setTextWrap(false);  // drawString never wraps
    cv().setTextSize(_size);
    cv().setCursor(x - dx, y - dy);
    cv().print(text);
    cv().setTextWrap(true);
  }

  int32_t width() override { return Lcd::WIDTH; }
  int32_t height() override { return Lcd::HEIGHT; }

  void flip() override { Lcd::presentDirty(); }  // only the rows drawn since the last flip

private:
  static GFXcanvas16& cv() { return *Lcd::canvas; }
  uint8_t _size = 1;
  uint8_t _datum = 0;
};
