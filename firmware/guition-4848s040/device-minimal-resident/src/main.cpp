// Stage 2: Resident on the Guition ESP32-S3-4848S040. Wi-Fi through
// WiFiManager's captive portal, WebSocket to resident.inanimate.tech/devices/<id>,
// connection status and the device ID on the LCD. Apps get only the built-in
// modules (log, time, store, events, ...); hardware modules come in stage 3.
//
// The status screen draws into the same full-frame canvas stage 3's screen
// module will use (480x480 RGB565, 450 KB, in PSRAM), copied whole into the
// frame the panel is scanned from (RgbPanel), and the heartbeat reports
// internal RAM, PSRAM and how many frames a second the panel is scanned.
//
// The board has no key to spare, so the touch panel (GT911, polled: its INT
// isn't wired) is Resident's system button: during the boot countdown a touch
// loads the saved app now and a long one forgets it.
#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <esp_heap_caps.h>
#include <Resident.h>
#include <RgbPanel.h>

static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;

static constexpr int PIN_SDA = 19, PIN_SCL = 45;
static constexpr uint8_t TOUCH_ADDR = 0x5D;
static constexpr int W = RgbPanel::WIDTH;

static GFXcanvas16* canvas = nullptr;

static void printMemory(const char* when) {
  Serial.printf("[mem] %s: internal free %u (largest %u, lowest %u), PSRAM free %u\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
}

static void centred(GFXcanvas16& c, const String& s, int y, uint8_t size, uint16_t colour) {
  c.setTextSize(size);
  c.setTextColor(colour);
  c.setCursor((W - (int)s.length() * 6 * size) / 2, y);
  c.print(s);
}

// Paints Resident's status strings: "WiFi...", "Configure WiFi\n\n<AP>",
// "Connecting...", and once connected the idle screen
// "Connected\nDevice ID: <id>\nType: guition-4848[\n<n>s]".
class LcdStatusDisplay : public Resident::SystemDisplay {
public:
  const char* name() const override { return "status"; }

  void displayText(const char* text) override {
    Serial.printf("[status] %s\n", text);
    GFXcanvas16& c = *canvas;
    c.fillScreen(0x0000);
    c.setTextWrap(false);

    centred(c, "Resident", 56, 5, 0x07FF);                    // cyan
    centred(c, "Guition ESP32-S3-4848S040", 106, 2, 0x8410);  // grey
    c.drawFastHLine(60, 132, W - 120, 0x4208);

    int y = 160;
    String all(text);
    int start = 0;
    bool first = true;
    while (start <= (int)all.length()) {
      int nl = all.indexOf('\n', start);
      String line = all.substring(start, nl < 0 ? all.length() : nl);
      start = nl < 0 ? all.length() + 1 : nl + 1;

      if (line.startsWith("Device ID: ")) {
        centred(c, "Device ID", y, 2, 0x8410);
        y += 26;
        c.fillRoundRect(60, y - 8, W - 120, 72, 8, 0x18E3);  // the string to read off
        centred(c, line.substring(11), y, 7, 0x07E0);       // green
        y += 84;
      } else {
        // A short first line is the headline; everything else wraps to the width.
        uint8_t size = (first && line.length() <= 16) ? 4 : 2;
        int lineH = 8 * size + 8;
        if (line.length() == 0) y += lineH / 2;
        int chars = (W - 40) / (6 * size);
        for (int i = 0; i < (int)line.length(); i += chars) {
          centred(c, line.substring(i, i + chars), y, size, first ? 0xFFE0 : 0xFFFF);
          y += lineH;
        }
      }
      first = false;
    }
    RgbPanel::drawRows(c.getBuffer(), 0, RgbPanel::HEIGHT - 1);
  }
};

// The touch panel as Resident's system button: down while a finger is. The
// GT911's status register (0x814E) has bit 7 set when a report is ready and
// the finger count in bits 0-3; writing 0 hands the buffer back. A finger with
// no report for 200 ms has gone.
class TouchButton : public Resident::SystemButton {
public:
  const char* name() const override { return "system_button"; }
  void begin() override {
    Wire.begin(PIN_SDA, PIN_SCL, 400000);
    Wire.setTimeOut(20);
    Wire.beginTransmission(TOUCH_ADDR);
    Serial.printf("[touch] GT911 at 0x%02X: %s\n", TOUCH_ADDR, Wire.endTransmission() == 0 ? "found" : "NO ANSWER");
  }
  bool pressed() override {
    uint32_t now = millis();
    if (now - _lastPoll < 10) return _down;
    _lastPoll = now;
    Wire.beginTransmission(TOUCH_ADDR);
    Wire.write(0x81);
    Wire.write(0x4E);
    if (Wire.endTransmission(false) != 0 || Wire.requestFrom(TOUCH_ADDR, (uint8_t)1) != 1) return _down;
    uint8_t status = Wire.read();
    bool down = _down;
    if (status & 0x80) {
      _lastReport = now;
      down = (status & 0x0F) > 0;
      Wire.beginTransmission(TOUCH_ADDR);
      Wire.write(0x81);
      Wire.write(0x4E);
      Wire.write(0);
      Wire.endTransmission();
    } else if (_down && now - _lastReport > 200) {
      down = false;
    }
    if (down != _down) Serial.printf("[touch] %s\n", down ? "down" : "up");
    _down = down;
    return _down;
  }
private:
  bool _down = false;
  uint32_t _lastPoll = 0, _lastReport = 0;
};

static LcdStatusDisplay statusDisplay;
static TouchButton systemButton;

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "guition-4848";
  cfg.firmwareVersion = "guition-4848-stage2";
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
  Serial.println();
  Serial.println("=== Guition ESP32-S3-4848S040: Resident ===");
  Serial.printf("Chip: %s rev %d @ %lu MHz, flash %lu KB, PSRAM %lu KB\n", ESP.getChipModel(),
                ESP.getChipRevision(), (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getPsramSize() / 1024));
  printMemory("boot");

  if (!RgbPanel::begin()) {  // ST7701S init, the RGB scan, the backlight
    Serial.println("[lcd] the RGB scan didn't start");
    while (true) delay(1000);
  }
  canvas = new GFXcanvas16(W, RgbPanel::HEIGHT);  // 450 KB: Arduino puts big blocks in PSRAM
  if (!canvas || !canvas->getBuffer()) {
    Serial.println("[lcd] canvas allocation FAILED");
    while (true) delay(1000);
  }
  printMemory("after the panel and the canvas");

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
  systemButton.pressed();  // keeps the touch log alive outside the countdown

  static uint32_t lastBeat = 0, lastScans = 0;
  if (millis() - lastBeat >= 15000) {
    float secs = (millis() - lastBeat) / 1000.0f;
    lastBeat = millis();
    uint32_t scans = RgbPanel::scans();
    Serial.printf("[heartbeat] %s, app %s, panel scanned %.1f/s\n", sandbox.isConnected() ? "connected" : "offline",
                  sandbox.isAppRunning() ? "running" : "idle", (scans - lastScans) / secs);
    lastScans = scans;
    printMemory("now");
  }
}
