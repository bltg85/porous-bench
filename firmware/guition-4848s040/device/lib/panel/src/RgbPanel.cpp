#include "RgbPanel.h"
#include <initializer_list>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_rgb.h>

namespace RgbPanel {

// The panel's init bus: 3-wire SPI, 9 bits a word (D/C, then 8 bits MSB
// first), mode 3. Only used at start; SCK and MOSI are the TF card's too.
static constexpr int PIN_CS = 39, PIN_SCK = 48, PIN_MOSI = 47;
// The RGB bus. Data lines in esp_lcd's order: D0-D4 blue, D5-D10 green,
// D11-D15 red, as ESPHome's and Arduino_GFX's configs wire them.
static constexpr int PIN_DE = 18, PIN_VSYNC = 17, PIN_HSYNC = 16, PIN_PCLK = 21;
static constexpr int PIN_DATA[16] = {4, 5, 6, 7, 15, 8, 20, 3, 46, 9, 10, 11, 12, 13, 14, 0};
static constexpr int PIN_BL = 38;
// Timing as Arduino_GFX runs this board with the same init sequence (ESPHome
// uses 8/10/20 and 8/10/10 with its own). Line: 480 + 10 + 8 + 50 clocks;
// frame: 480 + 10 + 8 + 20 lines; at 12 MHz, 42.3 frames a second.
static constexpr uint32_t PCLK_HZ = 12000000;
// The backlight's PWM: ESPHome runs it at 150 Hz, others at 100 Hz.
static constexpr int BL_CHANNEL = 0, BL_HZ = 150, BL_BITS = 10;

static esp_lcd_panel_handle_t s_panel = nullptr;
static volatile uint32_t s_scans = 0;
static float s_backlight = 1.0f;

static void spiWord(bool data, uint8_t v) {
  uint16_t word = (data ? 0x100 : 0) | v;
  for (int bit = 8; bit >= 0; bit--) {
    digitalWrite(PIN_SCK, LOW);
    digitalWrite(PIN_MOSI, (word >> bit) & 1);
    delayMicroseconds(1);
    digitalWrite(PIN_SCK, HIGH);  // the panel latches on the rising edge
    delayMicroseconds(1);
  }
}

static void command(uint8_t cmd, std::initializer_list<uint8_t> params = {}) {
  digitalWrite(PIN_CS, LOW);
  spiWord(false, cmd);
  for (uint8_t p : params) spiWord(true, p);
  digitalWrite(PIN_CS, HIGH);
}

// Arduino_GFX's st7701_type9_init_operations, "Init code for 480x480 square
// (86 Box) GUITION ESP32-4848S040 display", from the manufacturer. 0xCD 0x00
// keeps red and blue at full depth; no INVON; 0x3A 0x60: 18-bit interface,
// of which the board wires 16.
static void initSequence() {
  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_SCK, OUTPUT);
  pinMode(PIN_MOSI, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_SCK, HIGH);

  // There's no reset pin: a software reset first, so a warm restart starts clean.
  command(0x01);
  delay(120);

  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x10});  // command bank 0
  command(0xC0, {0x3B, 0x00});
  command(0xC1, {0x0D, 0x02});
  command(0xC2, {0x31, 0x05});
  command(0xCD, {0x00});
  command(0xB0, {0x00, 0x11, 0x18, 0x0E, 0x11, 0x06, 0x07, 0x08,
                 0x07, 0x22, 0x04, 0x12, 0x0F, 0xAA, 0x31, 0x18});  // positive gamma
  command(0xB1, {0x00, 0x11, 0x19, 0x0E, 0x12, 0x07, 0x08, 0x08,
                 0x08, 0x22, 0x04, 0x11, 0x11, 0xA9, 0x32, 0x18});  // negative gamma

  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x11});  // command bank 1: power
  command(0xB0, {0x60});  // Vop 4.7375 V
  command(0xB1, {0x32});  // VCOM
  command(0xB2, {0x07});  // VGH 15 V
  command(0xB3, {0x80});
  command(0xB5, {0x49});  // VGL -10.17 V
  command(0xB7, {0x85});
  command(0xB8, {0x21});  // AVDD 6.6 V, AVCL -4.6 V
  command(0xC1, {0x78});
  command(0xC2, {0x78});
  command(0xE0, {0x00, 0x1B, 0x02});
  command(0xE1, {0x08, 0xA0, 0x00, 0x00, 0x07, 0xA0, 0x00, 0x00, 0x00, 0x44, 0x44});
  command(0xE2, {0x11, 0x11, 0x44, 0x44, 0xED, 0xA0, 0x00, 0x00, 0xEC, 0xA0, 0x00, 0x00});
  command(0xE3, {0x00, 0x00, 0x11, 0x11});
  command(0xE4, {0x44, 0x44});
  command(0xE5, {0x0A, 0xE9, 0xD8, 0xA0, 0x0C, 0xEB, 0xD8, 0xA0,
                 0x0E, 0xED, 0xD8, 0xA0, 0x10, 0xEF, 0xD8, 0xA0});
  command(0xE6, {0x00, 0x00, 0x11, 0x11});
  command(0xE7, {0x44, 0x44});
  command(0xE8, {0x09, 0xE8, 0xD8, 0xA0, 0x0B, 0xEA, 0xD8, 0xA0,
                 0x0D, 0xEC, 0xD8, 0xA0, 0x0F, 0xEE, 0xD8, 0xA0});
  command(0xEB, {0x02, 0x00, 0xE4, 0xE4, 0x88, 0x00, 0x40});
  command(0xEC, {0x3C, 0x00});
  command(0xED, {0xAB, 0x89, 0x76, 0x54, 0x02, 0xFF, 0xFF, 0xFF,
                 0xFF, 0xFF, 0xFF, 0x20, 0x45, 0x67, 0x98, 0xBA});

  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x13});  // command bank 3
  command(0xE5, {0xE4});
  command(0xFF, {0x77, 0x01, 0x00, 0x00, 0x00});  // back to the user commands

  command(0x3A, {0x60});
  command(0x11);  // sleep out
  delay(120);
  command(0x29);  // display on
}

static bool IRAM_ATTR onScan(esp_lcd_panel_handle_t, esp_lcd_rgb_panel_event_data_t*, void*) {
  s_scans++;
  return false;
}

static bool startScan() {
  esp_lcd_rgb_panel_config_t cfg = {};
  cfg.clk_src = LCD_CLK_SRC_PLL160M;
  cfg.timings.pclk_hz = PCLK_HZ;
  cfg.timings.h_res = WIDTH;
  cfg.timings.v_res = HEIGHT;
  cfg.timings.hsync_pulse_width = 8;
  cfg.timings.hsync_back_porch = 50;
  cfg.timings.hsync_front_porch = 10;
  cfg.timings.vsync_pulse_width = 8;
  cfg.timings.vsync_back_porch = 20;
  cfg.timings.vsync_front_porch = 10;
  cfg.data_width = 16;
  cfg.psram_trans_align = 64;
  cfg.hsync_gpio_num = PIN_HSYNC;
  cfg.vsync_gpio_num = PIN_VSYNC;
  cfg.de_gpio_num = PIN_DE;
  cfg.pclk_gpio_num = PIN_PCLK;
  for (int i = 0; i < 16; i++) cfg.data_gpio_nums[i] = PIN_DATA[i];
  cfg.disp_gpio_num = -1;
  cfg.on_frame_trans_done = onScan;
  cfg.flags.fb_in_psram = 1;  // 480 x 480 x 2 = 450 KB

  if (esp_lcd_new_rgb_panel(&cfg, &s_panel) != ESP_OK) {
    s_panel = nullptr;
    return false;
  }
  esp_lcd_panel_reset(s_panel);
  esp_lcd_panel_init(s_panel);  // starts the scan, which never stops on its own
  return true;
}

bool begin() {
  // Backlight off while the panel starts, so the power-on garbage never shows.
  ledcSetup(BL_CHANNEL, BL_HZ, BL_BITS);
  ledcAttachPin(PIN_BL, BL_CHANNEL);
  ledcWrite(BL_CHANNEL, 0);

  initSequence();
  if (!startScan()) return false;
  setBacklight(s_backlight);
  return true;
}

void drawRows(const uint16_t* rows, int y0, int y1) {
  if (!s_panel) return;
  y0 = max(y0, 0);
  y1 = min(y1, HEIGHT - 1);
  if (y1 < y0) return;
  esp_lcd_panel_draw_bitmap(s_panel, 0, y0, WIDTH, y1 + 1, rows);
}

bool restart() {
  if (s_panel) esp_lcd_panel_del(s_panel);
  s_panel = nullptr;
  return startScan();
}

void setBacklight(float v) {
  s_backlight = constrain(v, 0.0f, 1.0f);
  ledcWrite(BL_CHANNEL, (uint32_t)(s_backlight * ((1 << BL_BITS) - 1) + 0.5f));
}

float backlight() { return s_backlight; }

uint32_t scans() { return s_scans; }

}  // namespace RgbPanel
