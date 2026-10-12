// The board's one I2C bus (SDA 48, SCL 47, 400 kHz), shared by the CST816D
// touch panel (0x15) and the QMI8658 IMU (0x6B). Started once, by whichever
// driver begins first.
#pragma once
#include <Arduino.h>
#include <Wire.h>

namespace Bus {

inline void begin() {
  static bool started = false;
  if (started) return;
  started = true;
  Wire.begin(48, 47, 400000);
}

inline bool readRegs(uint8_t addr, uint8_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)n) != n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

inline bool writeReg(uint8_t addr, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

}  // namespace Bus
