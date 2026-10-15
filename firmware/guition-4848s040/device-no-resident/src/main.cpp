// Stage 1: bring-up of the Guition ESP32-S3-4848S040, no Resident.
//
// Prints the chip and its memory over serial (UART0, through the CH340 on the
// USB-C), starts the panel (RgbPanel: the ST7701S init over 3-wire SPI, then
// the RGB scan from a frame buffer in PSRAM), counts how many frames a second
// it scans out, and draws a test card into a full-frame RGB565 canvas
// (480x480, 450 KB, in PSRAM) copied into the scanned frame in one go, timing
// the copy: that's how stage 3's screen.flip() will work.
//
// What the card proves:
// - the picture sits where it should: a 1 px white border on the outermost
//   pixels, all four sides (a missing side or a black gap = porches wrong, or
//   the picture slipped), and a magenta square in each corner;
// - orientation: "TOP" and the arrow at the top of the picture, "L" / "R" on
//   the left and right (say which side the USB-C is on: the sources make it
//   the right);
// - colours: red, green and blue bars, each labelled (swapped red and blue =
//   wrong data pin order, all inverted = the panel wants INVON); a ramp of each
//   channel (banding in red and blue only = 0xCD 0x00 didn't take: 4 bits
//   instead of 5) and a grey ramp;
// - the backlight: it ramps from off to full at start (PWM on GPIO38).
// It scans the I2C bus (GT911 expected at 0x5D) and draws a crosshair where
// the touch panel says the finger is: under the finger means its coordinates
// match the picture's.
//
// Two touch buttons at the bottom test a guess this firmware is built on: a
// flash write (saving an app) stalls PSRAM, which on IDF 4.4's RGB driver can
// slip the picture until the scan restarts. FLASH writes 256 KB to LittleFS;
// RESTART tears the scan down and starts it again, then pushes the card.
#include <Arduino.h>
#include <Wire.h>
#include <LittleFS.h>
#include <Adafruit_GFX.h>
#include <esp_heap_caps.h>
#include <esp_system.h>
#include <RgbPanel.h>

static constexpr int PIN_SDA = 19, PIN_SCL = 45;  // the touch panel's bus; INT and RST aren't wired
static constexpr uint8_t TOUCH_ADDR = 0x5D;
static constexpr int W = RgbPanel::WIDTH, H = RgbPanel::HEIGHT;

static constexpr uint16_t BLACK = 0x0000, WHITE = 0xFFFF, RED = 0xF800, GREEN = 0x07E0, BLUE = 0x001F;
static constexpr uint16_t CYAN = 0x07FF, MAGENTA = 0xF81F, YELLOW = 0xFFE0, DIM = 0x4208;

static GFXcanvas16* canvas = nullptr;

static uint32_t lastPushUs = 0;
static float scanHz = 0;
static char i2cFound[64] = "";
static char touchId[8] = "?";
static bool touching = false;
static int touchX = -1, touchY = -1;
static uint32_t touches = 0;
static char flashResult[48] = "not run";

// The two test buttons, bottom left and right.
struct Box { int x, y, w, h; const char* label; };
static constexpr Box FLASH_BOX = {24, 404, 200, 56, "FLASH"};
static constexpr Box RESTART_BOX = {W - 224, 404, 200, 56, "RESTART"};

static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

static void printMemory(const char* when) {
  Serial.printf("[mem] %s: internal %u free (largest %u), PSRAM %u free (largest %u)\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM));
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

static bool readRegs(uint16_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(reg >> 8);
  Wire.write(reg & 0xFF);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(TOUCH_ADDR, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static void writeReg(uint16_t reg, uint8_t v) {
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(reg >> 8);
  Wire.write(reg & 0xFF);
  Wire.write(v);
  Wire.endTransmission();
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

// GT911: the status register (0x814E) has bit 7 set when a report is ready
// and the finger count in bits 0-3; the first finger's x and y follow at
// 0x8150 (low byte first). Writing 0 to the status hands the buffer back.
// It reports about every 10 ms while a finger is down, and once on release.
static void pollTouch() {
  uint8_t status = 0;
  if (!readRegs(0x814E, &status, 1) || !(status & 0x80)) return;
  bool down = (status & 0x0F) > 0;
  uint8_t p[4] = {0};
  if (down && readRegs(0x8150, p, 4)) {
    touchX = p[0] | (p[1] << 8);
    touchY = p[2] | (p[3] << 8);
  }
  writeReg(0x814E, 0);
  if (down != touching) {
    touching = down;
    if (down) touches++;
    Serial.printf("[touch] %s at %d,%d (status %02X)\n", down ? "down" : "up", touchX, touchY, status);
  }
}

static void centred(const char* s, int y, uint8_t size, uint16_t colour) {
  int w = (int)strlen(s) * 6 * size;
  canvas->setTextSize(size);
  canvas->setTextColor(colour);
  canvas->setCursor((W - w) / 2, y);
  canvas->print(s);
}

static void drawBox(const Box& b, bool lit) {
  canvas->fillRoundRect(b.x, b.y, b.w, b.h, 8, lit ? CYAN : DIM);
  canvas->setTextSize(3);
  canvas->setTextColor(lit ? BLACK : WHITE);
  canvas->setCursor(b.x + (b.w - (int)strlen(b.label) * 18) / 2, b.y + (b.h - 24) / 2);
  canvas->print(b.label);
}

static bool inside(const Box& b, int x, int y) {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

static void drawCard() {
  canvas->fillScreen(BLACK);
  canvas->setTextWrap(false);

  // The outermost pixels, and a square in each corner.
  canvas->drawRect(0, 0, W, H, WHITE);
  for (int cx : {2, W - 18})
    for (int cy : {2, H - 18}) canvas->fillRect(cx, cy, 16, 16, MAGENTA);

  // Which way is up.
  canvas->fillTriangle(W / 2, 12, W / 2 - 20, 40, W / 2 + 20, 40, YELLOW);
  centred("TOP", 46, 3, YELLOW);
  centred("Guition 4848S040 stage 1", 76, 2, WHITE);
  canvas->setTextSize(4);
  canvas->setTextColor(CYAN);
  canvas->setCursor(24, H / 2 - 16);
  canvas->print("L");
  canvas->setCursor(W - 48, H / 2 - 16);
  canvas->print("R");

  struct Bar { const char* name; uint16_t colour; uint16_t text; };
  const Bar bars[] = {{"RED", RED, WHITE}, {"GREEN", GREEN, BLACK}, {"BLUE", BLUE, WHITE}};
  int y = 104;
  for (const Bar& b : bars) {
    canvas->fillRect(72, y, W - 144, 26, b.colour);
    canvas->setTextSize(2);
    canvas->setTextColor(b.text);
    canvas->setCursor(80, y + 6);
    canvas->print(b.name);
    y += 30;
  }
  // A ramp of each channel, then grey, one column a step: smooth in all four
  // means every data line works and red and blue have their full depth.
  for (int i = 0; i < W - 144; i++) {
    uint8_t v = i * 255 / (W - 145);
    canvas->drawFastVLine(72 + i, y, 10, rgb565(v, 0, 0));
    canvas->drawFastVLine(72 + i, y + 10, 10, rgb565(0, v, 0));
    canvas->drawFastVLine(72 + i, y + 20, 10, rgb565(0, 0, v));
    canvas->drawFastVLine(72 + i, y + 30, 10, rgb565(v, v, v));
  }
  y += 50;

  char line[64];
  snprintf(line, sizeof line, "scan %.1f Hz, frame copy %lu.%lu ms", scanHz, (unsigned long)(lastPushUs / 1000),
           (unsigned long)(lastPushUs % 1000 / 100));
  centred(line, y, 2, WHITE); y += 22;
  snprintf(line, sizeof line, "PSRAM %lu KB, up %lus", (unsigned long)(ESP.getPsramSize() / 1024),
           (unsigned long)(millis() / 1000));
  centred(line, y, 2, WHITE); y += 22;
  snprintf(line, sizeof line, "I2C: %s", i2cFound[0] ? i2cFound : "nothing");
  centred(line, y, 2, strstr(i2cFound, "0x5D") ? GREEN : RED); y += 22;
  snprintf(line, sizeof line, "touch %s %d,%d (%lu) GT%s", touching ? "DOWN" : "up", touchX, touchY,
           (unsigned long)touches, touchId);
  centred(line, y, 2, touching ? GREEN : WHITE); y += 22;
  snprintf(line, sizeof line, "flash test: %s", flashResult);
  centred(line, y, 2, WHITE);

  drawBox(FLASH_BOX, touching && inside(FLASH_BOX, touchX, touchY));
  drawBox(RESTART_BOX, touching && inside(RESTART_BOX, touchX, touchY));

  // Where the touch panel says the finger is.
  if (touchX >= 0) {
    uint16_t c = touching ? MAGENTA : rgb565(90, 40, 90);
    canvas->drawFastHLine(touchX - 24, touchY, 49, c);
    canvas->drawFastVLine(touchX, touchY - 24, 49, c);
    canvas->drawCircle(touchX, touchY, 12, c);
  }

  centred("BOTTOM", H - 14, 1, YELLOW);
}

static void push() {
  uint32_t t0 = micros();
  RgbPanel::drawRows(canvas->getBuffer(), 0, H - 1);
  lastPushUs = micros() - t0;
}

// 256 KB to a file on LittleFS, as a big app save would be, timed.
static void flashTest() {
  static uint8_t block[4096];
  memset(block, 0xA5, sizeof block);
  uint32_t t0 = millis();
  File f = LittleFS.open("/flash-test.bin", "w");
  size_t n = 0;
  for (int i = 0; f && i < 64; i++) n += f.write(block, sizeof block);
  if (f) f.close();
  LittleFS.remove("/flash-test.bin");
  snprintf(flashResult, sizeof flashResult, "%u KB in %lu ms", (unsigned)(n / 1024), (unsigned long)(millis() - t0));
  Serial.printf("[flash] wrote %s: did the picture slip?\n", flashResult);
}

static void measureScan() {
  uint32_t s0 = RgbPanel::scans(), t0 = millis();
  delay(1000);
  scanHz = (RgbPanel::scans() - s0) * 1000.0f / (millis() - t0);
}

void setup() {
  Serial.begin(115200);
  Serial.println();
  Serial.println("=== Guition ESP32-S3-4848S040: stage 1 bring-up ===");
  Serial.printf("Chip: %s rev %d, %d core(s) @ %lu MHz, reset: %s\n", ESP.getChipModel(),
                ESP.getChipRevision(), ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz(),
                resetReason());
  Serial.printf("Flash: %lu KB at %lu MHz; PSRAM: %lu KB\n", (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getFlashChipSpeed() / 1000000), (unsigned long)(ESP.getPsramSize() / 1024));
  Serial.printf("SDK %s, Arduino core %d.%d.%d\n", ESP.getSdkVersion(), ESP_ARDUINO_VERSION_MAJOR,
                ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);
  printMemory("boot");

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  Wire.setTimeOut(20);
  scanI2c();
  uint8_t id[4] = {0};
  if (readRegs(0x8140, id, 4)) snprintf(touchId, sizeof touchId, "%.4s", (const char*)id);
  Serial.printf("[touch] product id: %s\n", touchId);

  if (!RgbPanel::begin()) {
    Serial.println("[lcd] the RGB scan didn't start");
    while (true) delay(1000);
  }
  RgbPanel::setBacklight(0);
  printMemory("after the panel's 450 KB frame");

  canvas = new GFXcanvas16(W, H);  // 450 KB: GFX mallocs it, and Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) {
    Serial.println("[lcd] canvas allocation FAILED");
    while (true) delay(1000);
  }
  Serial.printf("[lcd] canvas in %s\n", esp_ptr_external_ram(canvas->getBuffer()) ? "PSRAM" : "internal RAM");
  printMemory("after the 450 KB canvas");

  drawCard();
  push();
  for (int i = 0; i <= 50; i++) {  // the backlight, off to full in 2 s
    RgbPanel::setBacklight(i / 50.0f);
    delay(40);
  }
  measureScan();
  Serial.printf("[lcd] scanning at %.1f Hz; full frame copied in %lu us\n", scanHz, (unsigned long)lastPushUs);

  bool fs = LittleFS.begin(true);  // the default table's spiffs partition, formatted the first time
  Serial.printf("[flash] LittleFS %s\n", fs ? "mounted" : "didn't mount");
  if (!fs) snprintf(flashResult, sizeof flashResult, "no LittleFS");
}

void loop() {
  static uint32_t lastDraw = 0, lastMem = 0, lastTouch = 0;
  uint32_t now = millis();

  if (now - lastTouch >= 10) {
    lastTouch = now;
    bool was = touching;
    int wx = touchX, wy = touchY;
    pollTouch();
    if (touching != was || (touching && (touchX != wx || touchY != wy))) lastDraw = 0;
    // A release over a button runs it.
    if (was && !touching && inside(FLASH_BOX, touchX, touchY) && strcmp(flashResult, "no LittleFS") != 0) {
      flashTest();
    } else if (was && !touching && inside(RESTART_BOX, touchX, touchY)) {
      Serial.printf("[lcd] restarting the scan: %s\n", RgbPanel::restart() ? "ok" : "FAILED");
      drawCard();
      push();
    }
  }

  if (now - lastDraw >= 1000) {
    lastDraw = now;
    drawCard();
    push();
  }

  if (now - lastMem >= 10000) {
    static uint32_t lastScans = RgbPanel::scans();
    uint32_t scans = RgbPanel::scans();
    if (lastMem) scanHz = (scans - lastScans) * 1000.0f / (now - lastMem);
    lastScans = scans;
    lastMem = now;
    Serial.printf("[lcd] scanning at %.1f Hz, last copy %lu us\n", scanHz, (unsigned long)lastPushUs);
    printMemory("running");
  }
  delay(2);
}
