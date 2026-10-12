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

  canvas = new GFXcanvas16(WIDTH, HEIGHT);  // 150 KB: Arduino puts big blocks in PSRAM
  return canvas && canvas->getBuffer();
}

void present() {
  uint32_t t0 = micros();
  tft.drawRGBBitmap(0, 0, canvas->getBuffer(), WIDTH, HEIGHT);
  _lastPushUs = micros() - t0;
}

void setBrightness(float v) {
  _brightness = constrain(v, 0.0f, 1.0f);
  ledcWrite(0, (uint32_t)(_brightness * 1023.0f + 0.5f));
}

float brightness() { return _brightness; }

uint32_t lastPushUs() { return _lastPushUs; }

void Panel::blit(int32_t x, int32_t y, int32_t w, int32_t h, const uint16_t* px) {
  uint16_t* buf = canvas->getBuffer();
  for (int32_t row = 0; row < h; row++) {
    int32_t cy = y + row;
    if (cy < 0 || cy >= HEIGHT) continue;
    for (int32_t col = 0; col < w; col++) {
      int32_t cx = x + col;
      if (cx < 0 || cx >= WIDTH) continue;
      uint16_t be = px[row * w + col];
      buf[cy * WIDTH + cx] = (uint16_t)((be >> 8) | (be << 8));
    }
  }
}

}  // namespace Lcd
