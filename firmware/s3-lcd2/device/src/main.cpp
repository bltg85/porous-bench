// Stage 3: Resident with drivers on the Waveshare ESP32-S3-Touch-LCD-2. Lua
// modules: screen (M5Stick verbs), lgfx (LovyanGFX-style, same frame), lvgl
// (LVGL 9 via luavgl, flushed into the same frame), button (BOOT: tap / hold),
// touchscreen (CST816D: read() and touch_* events), imu (QMI8658), screens
// ("main": 240x320, 16-bit, dark, brightness). Lua and LVGL live in PSRAM.
// Parts on the bench (DHT22, a button) come from Bench while it mirrors an app
// here, so there are no drivers for them.
#include <Arduino.h>
#include <esp_heap_caps.h>
#include <Resident.h>
#include <ResidentLgfxModule.h>
#include <ResidentLvglModule.h>
#include "Lcd.h"
#include "ScreenDriver.h"
#include "CanvasLgfxTarget.h"
#include "ButtonsDriver.h"
#include "TouchDriver.h"
#include "ImuDriver.h"
#include "LvglTimerReaper.h"
#include "AppStore.h"

static constexpr const char* RESIDENT_HOST = "resident.inanimate.tech";
static constexpr uint16_t RESIDENT_PORT = 443;
static constexpr int PIN_BOOT = 0;

ScreenDriver screenDriver;
ButtonsDriver buttonDriver{PIN_BOOT};
TouchDriver touchDriver;
ImuDriver imuDriver;
CanvasLgfxTarget lgfxMain;
Resident::LgfxModule lgfxModule;
Resident::LvglModule lvglModule;
AppStore appStore;  // the last app for the next boot, on LittleFS (NVS is too small)
LvglTimerReaper lvglTimerReaper;  // stops the last app's lvgl.Timers on each app load

static void printMemory(const char* when) {
  Serial.printf("[mem] %s: internal free %u (largest %u, lowest %u), PSRAM free %u (largest %u)\n", when,
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
                (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
                (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM));
}

static Resident::SandboxConfig makeConfig() {
  Resident::SandboxConfig cfg;
  cfg.deviceType = "s3-lcd2";
  cfg.firmwareVersion = "s3-lcd2-0.1";
  lgfxModule.addDisplay("main", &lgfxMain);
  // LVGL's display is only created when an app first calls lvgl.bind("main");
  // it flushes into the same frame as screen/lgfx. Its draw buffer is ours, in
  // internal RAM: LVGL's own (a tenth of the screen, from lv_malloc) landed
  // in PSRAM, where rendering is slower, and took ten strips a frame.
  Resident::LvglModule::DisplayOptions lv;
  lv.bufferRows = 80;
  lv.bufferBytes = 240 * 80 * 2;
  lv.buffer = heap_caps_malloc(lv.bufferBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  lvglModule.addDisplay("main", lv);
  cfg.extensions = {&screenDriver, &buttonDriver, &touchDriver, &imuDriver, &lgfxModule, &lvglModule,
                    &lvglTimerReaper};
  cfg.systemDisplay = &screenDriver;
  cfg.systemButton = &buttonDriver;  // tap = load the saved app now, hold = forget it
  cfg.persistentStore = &appStore;

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
  Serial.println("=== Waveshare ESP32-S3-Touch-LCD-2: Resident + drivers ===");
  Serial.printf("Chip: %s rev %d @ %lu MHz, flash %lu KB, PSRAM %lu KB\n", ESP.getChipModel(),
                ESP.getChipRevision(), (unsigned long)ESP.getCpuFreqMHz(),
                (unsigned long)(ESP.getFlashChipSize() / 1024),
                (unsigned long)(ESP.getPsramSize() / 1024));
  printMemory("boot");

  // Panel and the full-frame canvas first, so Resident's first status has
  // somewhere to go.
  if (!Lcd::begin()) {
    Serial.println("[lcd] canvas allocation FAILED");
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

  // Bench sends the time zone its apps run in before each app it mirrors
  // here, so a clock shows the same time on both screens. It comes on Bench's
  // own channel, not as a Resident `hello`: a hello would also make the board
  // drop un-channelled messages until reboot, which /resident:push-app still
  // sends. setTimezone looks the zone up once (ezTime, up to 2 s); the same
  // zone again is skipped, and a failed lookup leaves the board on UTC.
  sandbox.onMessageWithChannel("bench", [](const char*, const char* type, JsonDocument& doc) {
    if (strcmp(type, "timezone") != 0) return;
    static String applied;
    String tz = doc["data"]["tz"] | "";
    if (tz.isEmpty() || (tz == applied && sandbox.hasTimezone())) return;
    applied = tz;
    sandbox.setTimezone(tz.c_str());
  });

  appStore.begin();  // Resident doesn't start a store the board supplies
  sandbox.setup();
  printMemory("after Resident");
}

void loop() {
  static uint32_t loops = 0, loopUs = 0, loopMax = 0, lastStats = 0;
  uint32_t t0 = micros();
  sandbox.loop();
  uint32_t us = micros() - t0;
  loops++;
  loopUs += us;
  loopMax = max(loopMax, us);

  // Every 30 s: how frames are spent (Resident's loop runs Lua, LVGL's drawing and the pushes).
  if (millis() - lastStats >= 30000) {
    float secs = (millis() - lastStats) / 1000.0f;
    lastStats = millis();
    uint32_t frames, rows, pushUs;
    Lcd::takeStats(frames, rows, pushUs);
    Serial.printf("[perf] %.1f pushes/s, %lu rows each, %.1f ms a push; loop %.1f ms avg, %.1f ms max\n",
                  frames / secs, (unsigned long)(frames ? rows / frames : 0),
                  frames ? pushUs / 1000.0f / frames : 0.0f, loops ? loopUs / 1000.0f / loops : 0.0f,
                  loopMax / 1000.0f);
    loops = loopUs = loopMax = 0;
  }

  static uint32_t lastBeat = 0;
  if (millis() - lastBeat >= 30000) {
    lastBeat = millis();
    Serial.printf("[heartbeat] %s, app %s, last push %lu us\n",
                  sandbox.isConnected() ? "connected" : "offline",
                  sandbox.isAppRunning() ? "running" : "idle", (unsigned long)Lcd::lastPushUs());
    printMemory("now");
  }
}
