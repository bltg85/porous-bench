// The display's I2C bus (SDA D4 = GPIO5, SCL D5 = GPIO6, 100 kHz as Seeed's
// driver runs it; a touch read is 5 bytes, ~0.6 ms), shared by
// the CHSC6X touch panel (0x2E) and the PCF8563 RTC (0x51). Its pull-ups are on
// the display board's 3.3 V, which the board's power switch cuts: switched off,
// every transfer waits out its timeout, so keep that short. Started once, by
// whichever driver begins first.
#pragma once
#include <Arduino.h>
#include <Wire.h>

namespace Bus {

inline void begin() {
  static bool started = false;
  if (started) return;
  started = true;
  Wire.begin(5, 6, 100000);
  Wire.setTimeOut(20);
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
