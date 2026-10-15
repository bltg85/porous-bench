// The touch panel's I2C bus (SDA GPIO19, SCL GPIO45, 400 kHz as rzeldent's and
// ESPHome's configs run it; pull-ups on the board). Only the GT911 is on it, at
// 0x5D, and it doesn't reach a header. GT911 registers are 16-bit addresses,
// high byte first. Started once, by whichever driver begins first.
#pragma once
#include <Arduino.h>
#include <Wire.h>

namespace Bus {

constexpr int PIN_SDA = 19, PIN_SCL = 45;

inline void begin() {
  static bool started = false;
  if (started) return;
  started = true;
  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  Wire.setTimeOut(20);
}

inline bool readRegs(uint8_t addr, uint16_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg >> 8);
  Wire.write(reg & 0xFF);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

inline bool writeReg(uint8_t addr, uint16_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg >> 8);
  Wire.write(reg & 0xFF);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

}  // namespace Bus
