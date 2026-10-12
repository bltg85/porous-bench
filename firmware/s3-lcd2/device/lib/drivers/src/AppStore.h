// Where Resident keeps the last app for the next boot: a file on the 12 MB
// LittleFS partition instead of an NVS blob.
//
// Resident saves an app that loaded cleanly so a reboot brings it back, by
// default into NVS. This board's NVS partition is 20 KB and also holds Wi-Fi
// and the `store` module, so a 17 KB app (the S3 flame with rain) failed to
// save ("persist_too_big", silent) and a reboot brought back an older, smaller
// one. The app now goes to /app.lua; the `store` module's data stays in NVS.
//
// Resident doesn't call begin() on a store the board supplies: main.cpp does,
// before sandbox.setup().
#pragma once
#include <LittleFS.h>
#include <ResidentNvsStore.h>

class AppStore : public Resident::NvsPersistentStore {
public:
  bool begin() override {
    bool nvs = NvsPersistentStore::begin();
    _fs = LittleFS.begin(true);  // the "spiffs" partition, formatted the first time
    Serial.printf("[store] apps saved to %s\n", _fs ? "LittleFS" : "NVS (LittleFS didn't mount)");
    return nvs;
  }

  bool save(const char* source, size_t len) override {
    if (!_fs) return NvsPersistentStore::save(source, len);
    File f = LittleFS.open(PATH, "w");
    if (!f) return false;
    bool ok = f.write((const uint8_t*)source, len) == len;
    f.close();
    if (ok) NvsPersistentStore::clear();  // an older copy in NVS would only confuse a fallback
    Serial.printf("[store] app saved: %u bytes\n", (unsigned)len);
    return ok;
  }

  String load() override {
    if (_fs && LittleFS.exists(PATH)) {
      File f = LittleFS.open(PATH, "r");
      String s = f.readString();
      f.close();
      Serial.printf("[store] app loaded: %u bytes\n", (unsigned)s.length());
      return s;
    }
    return NvsPersistentStore::load();  // saved before this firmware
  }

  void clear() override {
    if (_fs) LittleFS.remove(PATH);
    NvsPersistentStore::clear();
  }

private:
  static constexpr const char* PATH = "/app.lua";
  bool _fs = false;
};
