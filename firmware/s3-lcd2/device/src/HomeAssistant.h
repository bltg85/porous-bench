// Optional: every app event (events.send) also goes to a Home Assistant webhook
// on the local network, so an app can switch lights without anything in the
// cloud listening. Off unless src/HomeAssistantConfig.h (gitignored; copy
// HomeAssistantConfig.example.h) sets HA_WEBHOOK_URL.
//
// The POST body is the event's envelope as the relay gets it:
// {"channel":"app","type":"lamp","data":{"on":false,"level":70},"from":"b4df8785",...}.
// An automation with a webhook trigger reads it as trigger.json.
//
// The request runs on its own task on core 0: a POST over the LAN takes tens
// of milliseconds, a dead address up to the timeout, and Resident's loop (Lua,
// LVGL, the panel) must not wait for it.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>

#if __has_include("HomeAssistantConfig.h")
#include "HomeAssistantConfig.h"
#endif
#ifndef HA_WEBHOOK_URL
#define HA_WEBHOOK_URL ""
#endif

namespace HomeAssistant {

static QueueHandle_t queue = nullptr;

inline bool enabled() { return HA_WEBHOOK_URL[0] != '\0'; }

static void task(void*) {
  for (;;) {
    char* body = nullptr;
    if (xQueueReceive(queue, &body, portMAX_DELAY) != pdTRUE) continue;
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.setConnectTimeout(2000);
      http.setTimeout(2000);
      http.begin(HA_WEBHOOK_URL);
      http.addHeader("Content-Type", "application/json");
      int code = http.POST((uint8_t*)body, strlen(body));
      http.end();
      Serial.printf("[ha] %s -> %d\n", body, code);
    } else {
      Serial.println("[ha] no Wi-Fi, event not sent");
    }
    free(body);
  }
}

inline void begin() {
  if (!enabled()) return;
  queue = xQueueCreate(8, sizeof(char*));
  xTaskCreatePinnedToCore(task, "ha", 6144, nullptr, 1, nullptr, 0);
  Serial.printf("[ha] app events also go to %s\n", HA_WEBHOOK_URL);
}

// Queues a copy of the event; never blocks. A full queue drops it (only a
// flood of events fills eight slots faster than the LAN takes them).
inline void post(const JsonDocument& doc) {
  if (!queue) return;
  size_t need = measureJson(doc) + 1;
  char* body = (char*)malloc(need);
  if (!body) return;
  serializeJson(doc, body, need);
  if (xQueueSend(queue, &body, 0) != pdTRUE) {
    Serial.println("[ha] queue full, event dropped");
    free(body);
  }
}

}  // namespace HomeAssistant
