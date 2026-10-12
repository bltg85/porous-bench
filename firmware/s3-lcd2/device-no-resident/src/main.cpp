// Stage 1: bring-up of the Waveshare ESP32-S3-Touch-LCD-2, no Resident.
//
// Prints the chip and its memory over USB serial, then draws a test card into
// a full-frame RGB565 canvas (240x320, 150 KB, in PSRAM) and pushes it in one
// transfer, timing the push: that's how stage 3's screen.flip() will work.
//
// What the card proves:
// - offsets: a 1 px white border on the visible edge, all four sides;
// - orientation: "TOP" and the arrow at the top of the picture, "L" / "R" on
//   the left and right (say which end the USB-C port is at);
// - colours: red, green and blue bars, each labelled (all inverted = INVON
//   missing); a grey ramp.
// It also scans the shared I2C bus (touch CST816D at 0x15, IMU QMI8658 at
// 0x6B), reads the IMU's WHO_AM_I, and draws a crosshair where the touch
// panel says the finger is: under the finger means its coordinates match the
// picture's. BOOT (GPIO0) shows as up/down with a count.
#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <esp_heap_caps.h>
#include <esp_system.h>

// Wiring, fixed on the board (Waveshare's docs and demos).
static constexpr int PIN_MOSI = 38, PIN_SCLK = 39, PIN_MISO = 40;  // MISO only reaches the TF card
static constexpr int PIN_LCD_CS = 45, PIN_LCD_DC = 42, PIN_LCD_BL = 1;  // LCD reset isn't wired
static constexpr int PIN_SD_CS = 41;
static constexpr int PIN_SDA = 48, PIN_SCL = 47;
static constexpr int PIN_BOOT = 0;
static constexpr int PIN_BAT = 5;
static constexpr uint8_t TOUCH_ADDR = 0x15, IMU_ADDR = 0x6B;

#ifndef LCD_SPI_HZ
#define LCD_SPI_HZ 80000000  // as Waveshare's demo runs it
#endif
// Adafruit's rotation 2 is MADCTL 0x00, the panel's native scan (on the C6's
// ST7789 rotation 0 mirrored both axes). Which end is up gets checked here.
#ifndef LCD_ROTATION
#define LCD_ROTATION 2
#endif

static constexpr int W = 240, H = 320;

static Adafruit_ST7789 tft(&SPI, PIN_LCD_CS, PIN_LCD_DC, -1);  // -1: software reset (0x01)
static GFXcanvas16* canvas = nullptr;

static uint32_t bootPresses = 0;
static bool bootDown = false;
static uint32_t lastPushUs = 0;
static char i2cFound[64] = "";
static uint8_t imuId = 0;
static bool touching = false;
static int touchX = -1, touchY = -1;
static uint32_t touches = 0;

static void printMemory(const char* when) {
  Serial.printf("[mem] %s: 8-bit %u free (largest %u), internal %u, PSRAM %u\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
}

static const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power-on";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    default: return "other";
  }
}

static bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static void scanI2c() {
  i2cFound[0] = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      char s[8];
      snprintf(s, sizeof s, "%s0x%02X", i2cFound[0] ? " " : "", a);
      strncat(i2cFound, s, sizeof i2cFound - strlen(i2cFound) - 1);
    }
  }
  Serial.printf("[i2c] found: %s\n", i2cFound[0] ? i2cFound : "nothing");
  if (!readRegs(IMU_ADDR, 0x00, &imuId, 1)) imuId = 0;
  Serial.printf("[imu] WHO_AM_I 0x%02X (QMI8658: 0x05)\n", imuId);
}

// CST816D: register 0x02 = finger count, then X (12 bits) and Y. It sleeps
// when idle and may not answer until touched, so a failed read is "no finger".
static void pollTouch() {
  uint8_t b[5];
  bool down = readRegs(TOUCH_ADDR, 0x02, b, 5) && (b[0] & 0x0F) > 0;
  if (down) {
    touchX = ((b[1] & 0x0F) << 8) | b[2];
    touchY = ((b[3] & 0x0F) << 8) | b[4];
  }
  if (down != touching) {
    touching = down;
    if (down) touches++;
    Serial.printf("[touch] %s at %d,%d\n", down ? "down" : "up", touchX, touchY);
  }
}

static void centred(const char* s, int y, uint8_t size, uint16_t colour) {
  int w = (int)strlen(s) * 6 * size;
  canvas->setTextSize(size);
  canvas->setTextColor(colour);
  canvas->setCursor((W - w) / 2, y);
  canvas->print(s);
}

static void drawCard() {
  canvas->fillScreen(ST77XX_BLACK);
  canvas->setTextWrap(false);

  // The visible edge, 1 px.
  canvas->drawRect(0, 0, W, H, ST77XX_WHITE);

  // Which way is up.
  canvas->fillTriangle(W / 2, 8, W / 2 - 12, 24, W / 2 + 12, 24, ST77XX_YELLOW);
  centred("TOP", 28, 2, ST77XX_YELLOW);
  centred("S3-Touch-LCD-2 stage 1", 48, 1, ST77XX_WHITE);

  canvas->setTextSize(2);
  canvas->setTextColor(ST77XX_CYAN);
  canvas->setCursor(4, 152);
  canvas->print("L");
  canvas->setCursor(W - 15, 152);
  canvas->print("R");

  struct Bar { const char* name; uint16_t colour; uint16_t text; };
  const Bar bars[] = {
    {"RED", ST77XX_RED, ST77XX_WHITE},
    {"GREEN", ST77XX_GREEN, ST77XX_BLACK},
    {"BLUE", ST77XX_BLUE, ST77XX_WHITE},
  };
  int y = 64;
  for (const Bar& b : bars) {
    canvas->fillRect(24, y, W - 48, 24, b.colour);
    canvas->setTextSize(2);
    canvas->setTextColor(b.text);
    canvas->setCursor(30, y + 5);
    canvas->print(b.name);
    y += 28;
  }
  for (int i = 0; i < 16; i++) {
    uint8_t v = i * 17;
    canvas->fillRect(24 + i * 12, y + 2, 12, 14, tft.color565(v, v, v));
  }
  y += 24;

  char line[48];
  canvas->setTextSize(1);
  canvas->setTextColor(ST77XX_WHITE);
  snprintf(line, sizeof line, "%s %lu MHz, PSRAM %lu KB", ESP.getChipModel(), (unsigned long)ESP.getCpuFreqMHz(),
           (unsigned long)(ESP.getPsramSize() / 1024));
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "internal %u KB, PSRAM free %u KB",
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) / 1024),
           (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "up %lus  push %lu.%lu ms", (unsigned long)(millis() / 1000),
           (unsigned long)(lastPushUs / 1000), (unsigned long)(lastPushUs % 1000 / 100));
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "I2C: %s", i2cFound[0] ? i2cFound : "nothing");
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "IMU id 0x%02X (QMI8658 0x05)", imuId);
  canvas->setTextColor(imuId == 0x05 ? ST77XX_GREEN : ST77XX_RED);
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "battery pin %lu mV", (unsigned long)analogReadMilliVolts(PIN_BAT));
  canvas->setTextColor(ST77XX_WHITE);
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "BOOT %s, presses %lu", bootDown ? "DOWN" : "up", (unsigned long)bootPresses);
  canvas->setTextColor(bootDown ? ST77XX_GREEN : ST77XX_WHITE);
  canvas->setCursor(10, y); canvas->print(line); y += 12;
  snprintf(line, sizeof line, "touch %s %d,%d (%lu)", touching ? "DOWN" : "up", touchX, touchY, (unsigned long)touches);
  canvas->setTextColor(touching ? ST77XX_GREEN : ST77XX_WHITE);
  canvas->setCursor(10, y); canvas->print(line);

  // Where the touch panel says the finger is.
  if (touchX >= 0) {
    uint16_t c = touching ? ST77XX_MAGENTA : tft.color565(90, 40, 90);
    canvas->drawFastHLine(touchX - 14, touchY, 29, c);
    canvas->drawFastVLine(touchX, touchY - 14, 29, c);
    canvas->drawCircle(touchX, touchY, 8, c);
  }

  centred("BOTTOM", H - 22, 1, ST77XX_YELLOW);
}

static void push() {
  uint32_t t0 = micros();
  tft.drawRGBBitmap(0, 0, canvas->getBuffer(), W, H);
  lastPushUs = micros() - t0;
}

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 2000) delay(10);  // give a monitor time to attach
  Serial.println();
  Serial.println("=== Waveshare ESP32-S3-Touch-LCD-2: stage 1 bring-up ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, reset: %s\n", ESP.getChipModel(),
                ESP.getChipRevision(), ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz(),
                resetReason());
  Serial.printf("Flash: %lu KB at %lu MHz; PSRAM: %lu KB\n", (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getFlashChipSpeed() / 1000000), (unsigned long)(ESP.getPsramSize() / 1024));
  Serial.printf("SDK %s, Arduino core %d.%d.%d\n", ESP.getSdkVersion(), ESP_ARDUINO_VERSION_MAJOR,
                ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);
  printMemory("boot");

  pinMode(PIN_BOOT, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  scanI2c();

  // The TF card shares the bus (unused here): keep it deselected.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);

  tft.init(W, H);  // SWRESET (no reset pin), INVON; 240x320 has no RAM offset
  tft.setSPISpeed(LCD_SPI_HZ);
  tft.setRotation(LCD_ROTATION);
  Serial.printf("[lcd] %dx%d, rotation %d, SPI %lu MHz\n", tft.width(), tft.height(), LCD_ROTATION,
                (unsigned long)(LCD_SPI_HZ / 1000000));

  // Backlight: plain PWM, 10 kHz 10-bit as Waveshare runs it; dark until driven.
  ledcSetup(0, 10000, 10);
  ledcAttachPin(PIN_LCD_BL, 0);
  ledcWrite(0, 1023);

  canvas = new GFXcanvas16(W, H);  // 150 KB: GFX mallocs it, and Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) {
    Serial.println("[lcd] canvas allocation FAILED");
    tft.fillScreen(ST77XX_RED);
    while (true) delay(1000);
  }
  Serial.printf("[lcd] canvas in %s\n", esp_ptr_external_ram(canvas->getBuffer()) ? "PSRAM" : "internal RAM");
  printMemory("after the 150 KB canvas");

  drawCard();
  push();
  Serial.printf("[lcd] full frame pushed in %lu us\n", (unsigned long)lastPushUs);
}

void loop() {
  static uint32_t lastDraw = 0, lastMem = 0, lastTouch = 0;
  uint32_t now = millis();

  bool down = digitalRead(PIN_BOOT) == LOW;
  if (down != bootDown) {
    bootDown = down;
    if (down) bootPresses++;
    Serial.printf("[boot] %s (%lu)\n", down ? "down" : "up", (unsigned long)bootPresses);
    lastDraw = 0;
  }

  if (now - lastTouch >= 20) {
    lastTouch = now;
    bool was = touching;
    int wx = touchX, wy = touchY;
    pollTouch();
    if (touching != was || (touching && (touchX != wx || touchY != wy))) lastDraw = 0;
  }

  if (now - lastDraw >= 1000) {
    lastDraw = now;
    drawCard();
    push();
  }

  if (now - lastMem >= 10000) {
    lastMem = now;
    Serial.printf("[lcd] last push %lu us\n", (unsigned long)lastPushUs);
    printMemory("running");
  }
  delay(2);
}
