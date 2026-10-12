#include "ImuDriver.h"
#include <Arduino.h>
#include "Bus.h"

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

// Bench's x, y, z from the chip's: which chip axis, and its sign. Measured on
// the board (2026-10-12, device-apps/imu-check.lua): face-up the chip reads
// z = -1 g, the right edge tipped down reads chip -y, the bottom edge chip +x.
//
// Bench's frame (x right, y down the screen, z out of it) is mirror-image to
// the chip's right-handed one, so the gyro can't just take the accelerometer's
// signs. Its x and y follow Bench's model (imu.ts: gx is the rate the bottom
// edge tips down, gy minus the rate the right edge does), worked out from the
// same mounting; its z is positive turning counter-clockwise seen from above.
static constexpr int8_t ACCEL_AXES[3][2] = {{1, -1}, {0, 1}, {2, -1}};
static constexpr int8_t GYRO_AXES[3][2] = {{1, 1}, {0, -1}, {2, -1}};

// QMI8658 registers.
static constexpr uint8_t WHO_AM_I = 0x00, CTRL1 = 0x02, CTRL2 = 0x03, CTRL3 = 0x04, CTRL7 = 0x08;
static constexpr uint8_t TEMP_L = 0x33, RESET = 0x60;
static constexpr float ACCEL_LSB_PER_G = 8192.0f;  // ±4 g
static constexpr float GYRO_LSB_PER_DPS = 64.0f;   // ±512 °/s

void ImuDriver::begin() {
  Bus::begin();
  uint8_t id = 0;
  if (!Bus::readRegs(ADDR, WHO_AM_I, &id, 1) || id != 0x05) {
    Serial.printf("[imu] QMI8658 not found (WHO_AM_I 0x%02X)\n", id);
    return;
  }
  Bus::writeReg(ADDR, RESET, 0xB0);
  delay(15);
  Bus::writeReg(ADDR, CTRL1, 0x40);  // register auto-increment, little-endian
  Bus::writeReg(ADDR, CTRL2, 0x15);  // accel ±4 g, 250 Hz
  Bus::writeReg(ADDR, CTRL3, 0x55);  // gyro ±512 °/s, 250 Hz
  Bus::writeReg(ADDR, CTRL7, 0x03);  // accel and gyro on
  delay(80);                          // the first samples read as zeros
  _ok = readAll();
  calibrateGyro();
  if (_ok) readAll();  // once more, with the bias taken off
  Serial.printf("[imu] QMI8658: accel %.2f %.2f %.2f g, gyro %.1f %.1f %.1f dps, %.1f C\n", _a[0], _a[1], _a[2],
                _g[0], _g[1], _g[2], _t);
}

// The gyro reads a few °/s at rest (-4.6 on x on this board): average half a
// second at boot and subtract it. Skipped if the board was moving then.
void ImuDriver::calibrateGyro() {
  if (!_ok) return;
  float sum[3] = {0, 0, 0};
  const int n = 50;
  for (int i = 0; i < n; i++) {
    if (!readAll()) return;
    for (int k = 0; k < 3; k++) {
      if (fabsf(_raw[k]) > 20.0f) {
        Serial.println("[imu] moving at boot: gyro not calibrated");
        return;
      }
      sum[k] += _raw[k];
    }
    delay(10);
  }
  for (int k = 0; k < 3; k++) _bias[k] = sum[k] / n;
  Serial.printf("[imu] gyro bias %.2f %.2f %.2f dps\n", _bias[0], _bias[1], _bias[2]);
}

bool ImuDriver::readAll() {
  uint8_t b[14];  // TEMP_L .. GZ_H
  if (!Bus::readRegs(ADDR, TEMP_L, b, sizeof b)) return false;
  auto s16 = [&](int i) { return (int16_t)(b[i] | (b[i + 1] << 8)); };
  float rawA[3], rawG[3];
  for (int i = 0; i < 3; i++) {
    rawA[i] = s16(2 + i * 2) / ACCEL_LSB_PER_G;
    _raw[i] = s16(8 + i * 2) / GYRO_LSB_PER_DPS;
    rawG[i] = _raw[i] - _bias[i];
  }
  for (int i = 0; i < 3; i++) {
    _a[i] = rawA[ACCEL_AXES[i][0]] * ACCEL_AXES[i][1];
    _g[i] = rawG[GYRO_AXES[i][0]] * GYRO_AXES[i][1];
  }
  _t = (int8_t)b[1] + b[0] / 256.0f;
  return true;
}

int ImuDriver::accel(lua_State* L) {
  if (_ok) readAll();
  for (float v : _a) lua_pushnumber(L, v);
  return 3;
}

int ImuDriver::gyro(lua_State* L) {
  if (_ok) readAll();
  for (float v : _g) lua_pushnumber(L, v);
  return 3;
}

int ImuDriver::temp(lua_State* L) {
  if (_ok) readAll();
  lua_pushnumber(L, _t);
  return 1;
}
