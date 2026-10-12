// Stage 2: Resident on the Waveshare ESP32-S3-Touch-LCD-2. Wi-Fi through
// WiFiManager's captive portal, WebSocket to resident.inanimate.tech/devices/<id>,
// connection status and the device ID on the LCD. Apps get only the built-in
// modules (log, time, store, events, ...); hardware modules come in stage 3.
//
// The status screen draws into the same full-frame canvas stage 3's screen
// module will use (240x320 RGB565, 150 KB, in PSRAM), and the heartbeat
// reports internal RAM and PSRAM.
#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <esp_heap_caps.h>
#include <Resident.h>

static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;

// Wiring, fixed on the board.
static constexpr int PIN_MOSI = 38, PIN_SCLK = 39, PIN_MISO = 40;
static constexpr int PIN_LCD_CS = 45, PIN_LCD_DC = 42, PIN_LCD_BL = 1;  // LCD reset isn't wired
static constexpr int PIN_SD_CS = 41;
static constexpr int PIN_BOOT = 0;

static constexpr int W = 240, H = 320;
static constexpr uint32_t LCD_SPI_HZ = 80000000;

static Adafruit_ST7789 tft(&SPI, PIN_LCD_CS, PIN_LCD_DC, -1);  // -1: software reset
static GFXcanvas16* canvas = nullptr;

static void printMemory(const char* when) {
  Serial.printf("[mem] %s: internal free %u (largest %u, lowest %u), PSRAM free %u\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
}

// Paints Resident's status strings: "WiFi...", "Configure WiFi\n\n<AP>",
// "Connecting...", and once connected the idle screen
// "Connected\nDevice ID: <id>\nType: s3-lcd2[\n<n>s]".
class LcdStatusDisplay : public Resident::SystemDisplay {
public:
  const char* name() const override { return "status"; }

  void displayText(const char* text) override {
    Serial.printf("[status] %s\n", text);
    GFXcanvas16& c = *canvas;
    c.fillScreen(ST77XX_BLACK);
    c.setTextWrap(false);

    c.setTextSize(2);
    c.setTextColor(ST77XX_CYAN);
    c.setCursor(12, 22);
    c.print("Resident");
    c.setTextSize(1);
    c.setTextColor(0x8410);  // grey
    c.setCursor(12, 42);
    c.print("ESP32-S3-Touch-LCD-2");
    c.drawFastHLine(12, 56, W - 24, 0x4208);

    int y = 68;
    String all(text);
    int start = 0;
    bool first = true;
    while (start <= (int)all.length()) {
      int nl = all.indexOf('\n', start);
      String line = all.substring(start, nl < 0 ? all.length() : nl);
      start = nl < 0 ? all.length() + 1 : nl + 1;

      if (line.startsWith("Device ID: ")) {
        c.setTextSize(1);
        c.setTextColor(0x8410);
        c.setCursor(12, y);
        c.print("Device ID");
        y += 12;
        c.fillRoundRect(8, y - 4, W - 16, 32, 4, 0x18E3);  // the string to read off
        c.setTextSize(3);
        c.setTextColor(ST77XX_GREEN);
        c.setCursor(14, y);
        c.print(line.substring(11));
        y += 38;
      } else {
        // A short first line is the headline; everything else is small and wraps.
        uint8_t size = (first && line.length() <= 12) ? 2 : 1;
        c.setTextSize(size);
        c.setTextColor(first ? ST77XX_YELLOW : ST77XX_WHITE);
        int chars = (W - 24) / (6 * size);
        int lineH = 8 * size + 4;
        if (line.length() == 0) y += lineH / 2;
        for (int i = 0; i < (int)line.length(); i += chars) {
          c.setCursor(12, y);
          c.print(line.substring(i, i + chars));
          y += lineH;
        }
      }
      first = false;
    }
    tft.drawRGBBitmap(0, 0, c.getBuffer(), W, H);
  }
};

// BOOT (GPIO0, active low) as Resident's system button: during the boot
// countdown a tap loads the saved app now, a long press forgets it.
class BootButton : public Resident::SystemButton {
public:
  const char* name() const override { return "system_button"; }
  void begin() override { pinMode(PIN_BOOT, INPUT_PULLUP); }
  bool pressed() override {
    bool raw = digitalRead(PIN_BOOT) == LOW;
    uint32_t now = millis();
    if (raw != _raw) { _raw = raw; _changedMs = now; }
    if (now - _changedMs >= 20 && _stable != _raw) {
      _stable = _raw;
      Serial.printf("[button] BOOT %s\n", _stable ? "down" : "up");
    }
    return _stable;
  }
private:
  bool _raw = false, _stable = false;
  uint32_t _changedMs = 0;
};

static LcdStatusDisplay statusDisplay;
static BootButton systemButton;

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "s3-lcd2";
  cfg.firmwareVersion = "s3-lcd2-stage2";
  cfg.systemDisplay = &statusDisplay;
  cfg.systemButton = &systemButton;

  // Courier::Config has a constructor with default args, so designated
  // initializers don't compile under strict ESP-IDF builds.
  Courier::Config courier;
  courier.host = RESIDENT_HOST;
  courier.port = RESIDENT_PORT;
  cfg.network = courier;
  return cfg;
}

Resident::Sandbox sandbox{makeConfig()};

void setup() {
  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 1500) delay(10);  // give a monitor time to attach
  Serial.println();
  Serial.println("=== Waveshare ESP32-S3-Touch-LCD-2: Resident ===");
  Serial.printf("Chip: %s rev %d @ %lu MHz, flash %lu KB, PSRAM %lu KB\n", ESP.getChipModel(),
                ESP.getChipRevision(), (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getPsramSize() / 1024));
  printMemory("boot");

  // The TF card shares the bus (unused): keep it deselected.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);
  SPI.begin(PIN_SCLK, PIN_MISO, PIN_MOSI, -1);
  tft.init(W, H);          // SWRESET, INVON; no RAM offset
  tft.setSPISpeed(LCD_SPI_HZ);
  tft.setRotation(2);      // the panel's native scan: USB-C at the bottom
  tft.fillScreen(ST77XX_BLACK);
  ledcSetup(0, 10000, 10); // backlight: 10 kHz, 10-bit, as Waveshare runs it
  ledcAttachPin(PIN_LCD_BL, 0);
  ledcWrite(0, 1023);

  canvas = new GFXcanvas16(W, H);  // 150 KB: Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) {
    Serial.println("[lcd] canvas allocation FAILED");
    tft.fillScreen(ST77XX_RED);
    while (true) delay(1000);
  }
  printMemory("after the canvas");

  sandbox.setIdleScreenTitle("Connected");

  // Override the default /agents/<type>-agent/<id> path with the canonical
  // /devices/<id> path used by resident.inanimate.tech.
  sandbox.onTransportsWillConnect([]() {
    String wsPath = String("/devices/") + sandbox.getDeviceId();
    sandbox.ws().setEndpoint(RESIDENT_HOST, RESIDENT_PORT, wsPath.c_str());
    Serial.printf("[resident] device ID %s, WS wss://%s%s\n", sandbox.getDeviceId().c_str(),
                  RESIDENT_HOST, wsPath.c_str());
  });

  sandbox.setup();
}

void loop() {
  sandbox.loop();
  systemButton.pressed();  // keeps BOOT's serial log alive outside the countdown

  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 15000) {
    lastBeat = millis();
    Serial.printf("[heartbeat] %s, app %s\n", sandbox.isConnected() ? "connected" : "offline",
                  sandbox.isAppRunning() ? "running" : "idle");
    printMemory("now");
  }
}
