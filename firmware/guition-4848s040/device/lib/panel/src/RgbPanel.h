// The Guition ESP32-S3-4848S040's 4" 480x480 ST7701S panel, shared by all
// three stages. The panel has no frame memory of its own: after an init
// sequence over 3-wire SPI, the ESP32-S3's LCD peripheral scans a frame buffer
// in PSRAM out to it over a 16-bit RGB bus, continuously, at a 12 MHz pixel
// clock (~42 frames a second with the porches). Drawing is copying pixels into
// that buffer: drawRows() copies whole rows and writes the cache back, so the
// next scan shows them.
//
// No Resident headers here: stage 1 builds without Resident.
#pragma once
#include <Arduino.h>

namespace RgbPanel {

constexpr int WIDTH = 480, HEIGHT = 480;

// ST7701S init, then the RGB scan (its frame buffer in PSRAM, black), then the
// backlight on. False if the scan didn't start.
bool begin();

// Copy rows y0..y1 (inclusive) of a full-width RGB565 image, in the chip's own
// byte order, into the frame the panel is scanned from.
void drawRows(const uint16_t* rows, int y0, int y1);

// Tear the scan down and start it again, on a new (black) frame buffer: the
// caller pushes its frame again after. For when a long flash write starved the
// scan of PSRAM and the picture slipped (see the README).
bool restart();

void setBacklight(float v);  // 0..1, PWM on GPIO38
float backlight();

uint32_t scans();  // frames scanned out since begin(), counted by interrupt

}  // namespace RgbPanel
