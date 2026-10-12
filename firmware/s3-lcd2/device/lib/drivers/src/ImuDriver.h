// `imu`: the QMI8658 6-axis IMU (I2C 0x6B), as Bench's imu module.
//
//   imu.accel() -> ax, ay, az in g      imu.gyro() -> gx, gy, gz in °/s
//   imu.temp()  -> °C (Bench returns 0)
//
// Bench's body frame, the one its apps are written for: lying face-up at rest
// accel ≈ (0, 0, 1); x grows as the screen's right edge tips down and y as its
// bottom edge (the USB-C end) tips down, so a ball rolls with +x to the right
// and +y down the screen. The chip's axes are mapped onto that in
// ImuDriver.cpp, measured on the board.
#pragma once
#include <cstdint>
#include <ResidentDriver.h>
#include <ResidentLuaModule.h>

class ImuDriver : public Resident::Driver {
public:
  const char* name() const override { return "imu"; }
  void registerModule(Resident::LuaModule& m) override {
    m.method<ImuDriver, &ImuDriver::accel>("accel");
    m.method<ImuDriver, &ImuDriver::gyro>("gyro");
    m.method<ImuDriver, &ImuDriver::temp>("temp");
  }
  void begin() override;
  bool ok() const { return _ok; }

private:
  static constexpr uint8_t ADDR = 0x6B;

  bool readAll();  // accel, gyro and temperature into _a, _g, _t
  void calibrateGyro();
  int accel(lua_State* L);
  int gyro(lua_State* L);
  int temp(lua_State* L);

  bool _ok = false;
  float _a[3] = {0, 0, 1}, _g[3] = {0, 0, 0}, _t = 0;
  float _raw[3] = {0, 0, 0}, _bias[3] = {0, 0, 0};  // gyro, chip axes, °/s
};
