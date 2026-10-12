#include "ScreenDriver.h"
#include "Lcd.h"
#include "qrcode.h"

extern "C" {
  #include "lua/lua.h"
  #include "lua/lualib.h"
  #include "lua/lauxlib.h"
}

using Lcd::canvas;

static constexpr uint16_t BLACK = 0x0000, WHITE = 0xFFFF, GREY = 0x8410, DARK = 0x4208;
static constexpr uint16_t CYAN = 0x07FF, YELLOW = 0xFFE0, GREEN = 0x07E0, ID_BG = 0x18E3;

// Channel arguments, 0-255; missing trailing ones take the default.
static uint16_t colourArgs(lua_State* L, int idx, int def) {
  int r = (int)luaL_optinteger(L, idx, def);
  int g = (int)luaL_optinteger(L, idx + 1, def);
  int b = (int)luaL_optinteger(L, idx + 2, def);
  return Lcd::rgb565(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255));
}
static int argi(lua_State* L, int idx) { return (int)luaL_checknumber(L, idx); }

void ScreenDriver::onAppReset() {
  // Each app starts on a black frame at full brightness. The glass keeps the
  // previous picture until the new app flips, as on Bench.
  canvas->fillScreen(BLACK);
  Lcd::setBrightness(1.0f);
}

static void centred(GFXcanvas16& c, const String& s, int y, uint8_t size, uint16_t colour) {
  c.setTextSize(size);
  c.setTextColor(colour);
  c.setCursor((Lcd::WIDTH - (int)s.length() * 6 * size) / 2, y);
  c.print(s);
}

// Resident's status strings: "WiFi...", "Configure WiFi\n\n<AP>",
// "Connecting...", the idle screen "Connected\nDevice ID: <id>\nType: xiao-round"
// (with a countdown line while a saved app waits to load), an app's
// description on load. Centred, each line as wide as the round glass is where
// it falls.
void ScreenDriver::displayText(const char* text) {
  Serial.printf("[status] %s\n", text);
  if (_appRunning) return;
  GFXcanvas16& c = *canvas;
  const int W = Lcd::WIDTH, H = Lcd::HEIGHT;
  c.fillScreen(BLACK);
  c.setTextWrap(false);

  centred(c, "Resident", 34, 2, CYAN);
  centred(c, "Round Display for XIAO", 54, 1, GREY);
  c.drawFastHLine(50, 68, W - 100, DARK);

  int y = 80;
  String all(text);
  int start = 0;
  bool first = true;
  while (start <= (int)all.length()) {
    int nl = all.indexOf('\n', start);
    String line = all.substring(start, nl < 0 ? all.length() : nl);
    start = nl < 0 ? all.length() + 1 : nl + 1;

    if (line.startsWith("Device ID: ")) {
      centred(c, "Device ID", y, 1, GREY);
      y += 12;
      c.fillRoundRect(28, y - 4, W - 56, 32, 4, ID_BG);  // the string to read off
      centred(c, line.substring(11), y, 3, GREEN);
      y += 38;
    } else {
      // A short first line is the headline; everything else is small, in lines
      // that fit the circle where they fall.
      uint8_t size = (first && line.length() <= 12) ? 2 : 1;
      int lineH = 8 * size + 4;
      if (line.length() == 0) y += lineH / 2;
      for (int i = 0; i < (int)line.length();) {
        int dy = abs(y + lineH / 2 - H / 2);
        int half = dy < H / 2 - 8 ? (int)sqrtf(float((H / 2 - 8) * (H / 2 - 8) - dy * dy)) : 0;
        int chars = max(8, 2 * half / (6 * size));
        centred(c, line.substring(i, i + chars), y, size, first ? YELLOW : WHITE);
        i += chars;
        y += lineH;
      }
    }
    first = false;
  }
  c.setTextWrap(true);
  Lcd::present();
}

Resident::Screen ScreenDriver::screen(int i) const {
  (void)i;
  Resident::Screen s;
  s.name = "main";
  s.target = &Lcd::panel;
  s.shape = "round";
  s.depth = 16;
  s.dpi = 188;  // 240 px across 32.4 mm, as Bench reports it
  s.scheme = "dark";
  return s;
}

// screens.set("main", { brightness = 0..1 })
bool ScreenDriver::setScreen(int i, const char* key, lua_State* L, int idx) {
  (void)i;
  if (strcmp(key, "brightness") != 0) return false;
  Lcd::setBrightness((float)luaL_checknumber(L, idx));
  return true;
}

// screens.get("main") extras, as Bench reports them.
void ScreenDriver::getScreen(int i, lua_State* L) {
  (void)i;
  lua_pushnumber(L, Lcd::brightness());
  lua_setfield(L, -2, "brightness");
  lua_pushstring(L, "Seeed Studio Round Display for XIAO");
  lua_setfield(L, -2, "model");
  lua_pushstring(L, "GC9A01");
  lua_setfield(L, -2, "controller");
  lua_pushstring(L, "lcd");
  lua_setfield(L, -2, "tech");
}

// screen.clear([r, g, b]): default black
int ScreenDriver::clear(lua_State* L) {
  canvas->fillScreen(colourArgs(L, 1, 0));
  return 0;
}

// screen.text(x, y, str[, size = 2[, r, g, b]]): default white
int ScreenDriver::text(lua_State* L) {
  int x = argi(L, 1), y = argi(L, 2);
  const char* str = luaL_checkstring(L, 3);
  int size = (int)luaL_optinteger(L, 4, 2);
  canvas->setTextColor(colourArgs(L, 5, 255));
  canvas->setTextSize(constrain(size, 1, 16));
  canvas->setCursor(x, y);
  canvas->print(str);
  return 0;
}

int ScreenDriver::fillRect(lua_State* L) {
  canvas->fillRect(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), colourArgs(L, 5, 0));
  return 0;
}

int ScreenDriver::rect(lua_State* L) {
  canvas->drawRect(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), colourArgs(L, 5, 0));
  return 0;
}

int ScreenDriver::line(lua_State* L) {
  canvas->drawLine(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), colourArgs(L, 5, 0));
  return 0;
}

int ScreenDriver::triangle(lua_State* L) {
  canvas->drawTriangle(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), argi(L, 5), argi(L, 6),
                       colourArgs(L, 7, 0));
  return 0;
}

int ScreenDriver::fillTriangle(lua_State* L) {
  canvas->fillTriangle(argi(L, 1), argi(L, 2), argi(L, 3), argi(L, 4), argi(L, 5), argi(L, 6),
                       colourArgs(L, 7, 0));
  return 0;
}

int ScreenDriver::pixel(lua_State* L) {
  canvas->drawPixel(argi(L, 1), argi(L, 2), colourArgs(L, 3, 0));
  return 0;
}

// screen.qr(x, y, text[, scale = 4[, r, g, b]]): QR v3..v10, ECC low,
// default black modules; the caller clears a light background behind it.
int ScreenDriver::qr(lua_State* L) {
  int x = argi(L, 1), y = argi(L, 2);
  const char* str = luaL_checkstring(L, 3);
  int scale = max(1, (int)luaL_optinteger(L, 4, 4));
  uint16_t c = colourArgs(L, 5, 0);

  static uint8_t buf[512];  // enough for version 10 (~407 bytes)
  QRCode code;
  int8_t result = -1;
  for (uint8_t version = 3; version <= 10 && result != 0; version++)
    result = qrcode_initText(&code, buf, version, ECC_LOW, str);
  if (result != 0) return luaL_error(L, "screen.qr: text too long for QR v10");

  for (uint8_t py = 0; py < code.size; py++)
    for (uint8_t px = 0; px < code.size; px++)
      if (qrcode_getModule(&code, px, py))
        canvas->fillRect(x + px * scale, y + py * scale, scale, scale, c);
  return 0;
}

int ScreenDriver::flip(lua_State* L) {
  (void)L;
  Lcd::presentDirty();
  return 0;
}

// screen.set_brightness(0..255): the backlight's PWM duty.
int ScreenDriver::setBrightness(lua_State* L) {
  int v = constrain((int)luaL_checknumber(L, 1), 0, 255);
  Lcd::setBrightness(v / 255.0f);
  return 0;
}

int ScreenDriver::width(lua_State* L) {
  lua_pushinteger(L, Lcd::WIDTH);
  return 1;
}

int ScreenDriver::height(lua_State* L) {
  lua_pushinteger(L, Lcd::HEIGHT);
  return 1;
}
