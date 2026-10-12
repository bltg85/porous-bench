// Stage 1: bring-up of the Seeed Studio Round Display for XIAO on a XIAO
// ESP32S3, no Resident.
//
// Prints the chip and its memory over USB serial, then draws a test card into
// a full-frame RGB565 canvas (240x240, 112.5 KB, in PSRAM) and pushes it in
// one transfer, timing the push: that's how stage 3's screen.flip() will work.
//
// What the card proves:
// - the glass: a 1 px white circle of radius 119 on the visible edge, and the
//   square's corners (outside the glass, never seen) in magenta;
// - orientation: "TOP" and the arrow at the top of the picture, "L" / "R" on
//   the left and right (say which side the XIAO's USB-C port is on);
// - colours: red, green and blue bars, each labelled (swapped red and blue =
//   wrong RGB/BGR order, all inverted = INVON missing); a grey ramp.
// It also scans the I2C bus (touch CHSC6X at 0x2E, RTC PCF8563 at 0x51),
// reads the RTC, and draws a crosshair where the touch panel says the finger
// is: under the finger means its coordinates match the picture's. BOOT (GPIO0)
// shows as up/down with a count.
#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_GC9A01A.h>
#include <esp_heap_caps.h>
#include <esp_system.h>

// Wiring, fixed by the display's sockets (Seeed's driver and the v1.1 schematic).
// XIAO D-names: D0 1, D1 2, D2 3, D3 4, D4 5, D5 6, D6 43, D7 44, D8 7, D9 8, D10 9.
static constexpr int PIN_SCLK = 7, PIN_MISO = 8, PIN_MOSI = 9;  // D8, D9, D10
static constexpr int PIN_LCD_CS = 2, PIN_LCD_DC = 4;            // D1, D3; the LCD's reset is an RC
static constexpr int PIN_LCD_BL = 43;                           // D6, through the KE switch's 2
static constexpr int PIN_SD_CS = 3;                             // D2
static constexpr int PIN_SDA = 5, PIN_SCL = 6;                  // D4, D5
static constexpr int PIN_TOUCH_INT = 44;                        // D7, low while touched
static constexpr int PIN_BAT = 1;                               // D0, through the KE switch's 1
static constexpr int PIN_BOOT = 0;
static constexpr uint8_t TOUCH_ADDR = 0x2E, RTC_ADDR = 0x51;

#ifndef LCD_SPI_HZ
#define LCD_SPI_HZ 80000000  // clean on the glass, full frame 19 ms (Seeed asks for 50 MHz, which the S3 makes 40: 31 ms)
#endif
#ifndef LCD_ROTATION
#define LCD_ROTATION 0
#endif

static constexpr int W = 240, H = 240, R = 120;

static Adafruit_GC9A01A tft(&SPI, PIN_LCD_DC, PIN_LCD_CS, -1);  // -1: software reset (0x01)
static GFXcanvas16* canvas = nullptr;

static uint32_t bootPresses = 0;
static bool bootDown = false;
static uint32_t lastPushUs = 0;
static char i2cFound[64] = "";
static char rtcTime[24] = "no RTC";
static bool touching = false, touchInt = false;
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
}

// PCF8563: seconds, minutes, hours from register 0x02, BCD; bit 7 of the
// seconds (VL) is set when the clock lost power and its time can't be trusted.
static void readRtc() {
  uint8_t b[3];
  if (!readRegs(RTC_ADDR, 0x02, b, 3)) {
    snprintf(rtcTime, sizeof rtcTime, "no RTC");
    return;
  }
  auto bcd = [](uint8_t v) { return (v >> 4) * 10 + (v & 0x0F); };
  snprintf(rtcTime, sizeof rtcTime, "%02d:%02d:%02d%s", bcd(b[2] & 0x3F), bcd(b[1] & 0x7F), bcd(b[0] & 0x7F),
           (b[0] & 0x80) ? " (lost)" : "");
}

// CHSC6X, as Seeed's driver reads it: 5 bytes, no register; byte 0 is 1 while
// a finger is down, x in byte 2, y in byte 4. It doesn't answer while idle, so
// read only when INT is low (it is while touched, and once more on release)
// or a finger was down; a read it doesn't answer is "no finger".
static void pollTouch() {
  touchInt = digitalRead(PIN_TOUCH_INT) == LOW;
  if (!touchInt && !touching) return;
  uint8_t b[5] = {0};
  bool down = false;
  if (Wire.requestFrom(TOUCH_ADDR, (uint8_t)5) == 5) {
    for (uint8_t& x : b) x = Wire.read();
    down = b[0] == 0x01;
  }
  if (down) {
    touchX = b[2];
    touchY = b[4];
  }
  if (down != touching) {
    touching = down;
    if (down) touches++;
    Serial.printf("[touch] %s at %d,%d (INT %s; %02X %02X %02X %02X %02X)\n", down ? "down" : "up", touchX, touchY,
                  touchInt ? "low" : "high", b[0], b[1], b[2], b[3], b[4]);
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
  canvas->fillScreen(GC9A01A_BLACK);
  canvas->setTextWrap(false);

  // The square's corners, outside the glass: seen only if the circle is off.
  for (int cx : {0, W - 1})
    for (int cy : {0, H - 1}) canvas->fillCircle(cx, cy, 14, GC9A01A_MAGENTA);
  // The visible edge, 1 px.
  canvas->drawCircle(R, R, R - 1, GC9A01A_WHITE);

  // Which way is up.
  canvas->fillTriangle(W / 2, 8, W / 2 - 12, 24, W / 2 + 12, 24, GC9A01A_YELLOW);
  centred("TOP", 28, 2, GC9A01A_YELLOW);
  centred("XIAO round stage 1", 46, 1, GC9A01A_WHITE);

  canvas->setTextSize(2);
  canvas->setTextColor(GC9A01A_CYAN);
  canvas->setCursor(6, R - 7);
  canvas->print("L");
  canvas->setCursor(W - 17, R - 7);
  canvas->print("R");

  struct Bar { const char* name; uint16_t colour; uint16_t text; };
  const Bar bars[] = {
    {"RED", GC9A01A_RED, GC9A01A_WHITE},
    {"GREEN", GC9A01A_GREEN, GC9A01A_BLACK},
    {"BLUE", GC9A01A_BLUE, GC9A01A_WHITE},
  };
  int y = 58;
  for (const Bar& b : bars) {
    canvas->fillRect(40, y, W - 80, 20, b.colour);
    canvas->setTextSize(2);
    canvas->setTextColor(b.text);
    canvas->setCursor(46, y + 3);
    canvas->print(b.name);
    y += 23;
  }
  for (int i = 0; i < 16; i++) {
    uint8_t v = i * 17;
    canvas->fillRect(32 + i * 11, y + 1, 11, 10, tft.color565(v, v, v));
  }
  y += 16;

  char line[48];
  canvas->setTextSize(1);
  snprintf(line, sizeof line, "PSRAM %lu KB, push %lu.%lu ms", (unsigned long)(ESP.getPsramSize() / 1024),
           (unsigned long)(lastPushUs / 1000), (unsigned long)(lastPushUs % 1000 / 100));
  centred(line, y, 1, GC9A01A_WHITE); y += 11;
  snprintf(line, sizeof line, "I2C: %s", i2cFound[0] ? i2cFound : "nothing");
  centred(line, y, 1, strstr(i2cFound, "0x2E") && strstr(i2cFound, "0x51") ? GC9A01A_GREEN : GC9A01A_RED); y += 11;
  snprintf(line, sizeof line, "RTC %s  up %lus", rtcTime, (unsigned long)(millis() / 1000));
  centred(line, y, 1, GC9A01A_WHITE); y += 11;
  snprintf(line, sizeof line, "battery pin %lu mV", (unsigned long)analogReadMilliVolts(PIN_BAT));
  centred(line, y, 1, GC9A01A_WHITE); y += 11;
  snprintf(line, sizeof line, "BOOT %s, presses %lu", bootDown ? "DOWN" : "up", (unsigned long)bootPresses);
  centred(line, y, 1, bootDown ? GC9A01A_GREEN : GC9A01A_WHITE); y += 11;
  snprintf(line, sizeof line, "touch %s %d,%d (%lu) INT %s", touching ? "DOWN" : "up", touchX, touchY,
           (unsigned long)touches, touchInt ? "lo" : "hi");
  centred(line, y, 1, touching ? GC9A01A_GREEN : GC9A01A_WHITE);

  // Where the touch panel says the finger is.
  if (touchX >= 0) {
    uint16_t c = touching ? GC9A01A_MAGENTA : tft.color565(90, 40, 90);
    canvas->drawFastHLine(touchX - 14, touchY, 29, c);
    canvas->drawFastVLine(touchX, touchY - 14, 29, c);
    canvas->drawCircle(touchX, touchY, 8, c);
  }

  centred("BOTTOM", H - 20, 1, GC9A01A_YELLOW);
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
  Serial.println("=== Seeed Round Display for XIAO on a XIAO ESP32S3: stage 1 bring-up ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, reset: %s\n", ESP.getChipModel(),
                ESP.getChipRevision(), ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz(),
                resetReason());
  Serial.printf("Flash: %lu KB at %lu MHz; PSRAM: %lu KB\n", (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getFlashChipSpeed() / 1000000), (unsigned long)(ESP.getPsramSize() / 1024));
  Serial.printf("SDK %s, Arduino core %d.%d.%d\n", ESP.getSdkVersion(), ESP_ARDUINO_VERSION_MAJOR,
                ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);
  printMemory("boot");

  pinMode(PIN_BOOT, INPUT_PULLUP);
  pinMode(PIN_TOUCH_INT, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL, 100000);  // as Seeed runs the touch panel
  Wire.setTimeOut(20);
  scanI2c();
  readRtc();
  Serial.printf("[rtc] %s\n", rtcTime);

  // The microSD card shares the bus (unused here): keep it deselected.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);

  tft.begin(LCD_SPI_HZ);  // SWRESET (no reset pin), Adafruit's GC9A01A init, INVON
  tft.setRotation(LCD_ROTATION);
  Serial.printf("[lcd] %dx%d, rotation %d, SPI %lu MHz\n", tft.width(), tft.height(), LCD_ROTATION,
                (unsigned long)(LCD_SPI_HZ / 1000000));

  // Backlight: PWM through the KE switch's 2 (with it off, it's always on).
  ledcSetup(0, 10000, 10);
  ledcAttachPin(PIN_LCD_BL, 0);
  ledcWrite(0, 1023);

  canvas = new GFXcanvas16(W, H);  // 112.5 KB: GFX mallocs it, and Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) {
    Serial.println("[lcd] canvas allocation FAILED");
    tft.fillScreen(GC9A01A_RED);
    while (true) delay(1000);
  }
  Serial.printf("[lcd] canvas in %s\n", esp_ptr_external_ram(canvas->getBuffer()) ? "PSRAM" : "internal RAM");
  printMemory("after the 112.5 KB canvas");

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
    readRtc();
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
