// Stops the `lvgl.Timer`s an app made when the next app loads.
//
// Resident keeps one Lua state for as long as the board runs, and luavgl
// keeps each timer alive in that state's registry (light userdata -> the
// timer). On an app reset Resident's LVGL module replaces the screen, which
// deletes the outgoing app's objects, but nothing stops its timers: they go on
// calling the old app's callbacks against deleted objects ("bad argument #1 to
// 'index' (expect lua lvgl object, got null)", drawn by luavgl as a box on the
// screen 30 times a second), and keep the old app's data alive. Seen on the
// board mirroring the flame twice; a timer even outlives an app that failed to
// compile, because it starts while the chunk runs.
//
// So on every app reset this finds the timers in the registry and calls
// luavgl's own `delete` on each (it drops the callback and the registry entry
// and pauses the timer; garbage collection frees it). Registers no functions,
// so apps get no global for it. Bench runs every app in a fresh Lua state,
// which is why the browser never shows this.
#pragma once
#include <Arduino.h>
#include <ResidentExtension.h>
#include <ResidentLuaModule.h>

extern "C" {
  #include "lua/lua.h"
  #include "lua/lauxlib.h"
}

class LvglTimerReaper : public Resident::Extension {
public:
  const char* name() const override { return "lvgl_timers"; }
  void registerModule(Resident::LuaModule& m) override { _lua = m.state(); }

  void onAppReset() override {
    lua_State* L = _lua;
    if (!L) return;
    const int top = lua_gettop(L);

    // Collect first: deleting a timer edits the registry being walked.
    lua_newtable(L);
    const int found = lua_gettop(L);
    int n = 0;
    lua_pushnil(L);
    while (lua_next(L, LUA_REGISTRYINDEX) != 0) {
      if (lua_type(L, -2) == LUA_TLIGHTUSERDATA && luaL_testudata(L, -1, "lv_timer")) {
        lua_rawseti(L, found, ++n);  // pops the timer, keeps the key for lua_next
      } else {
        lua_pop(L, 1);
      }
    }

    for (int i = 1; i <= n; i++) {
      lua_rawgeti(L, found, i);
      lua_getfield(L, -1, "delete");  // luavgl's method, through lv_timer's __index
      lua_pushvalue(L, -2);
      if (lua_pcall(L, 1, 0, 0) != LUA_OK) lua_pop(L, 1);
      lua_pop(L, 1);
    }
    lua_settop(L, top);
    if (n) Serial.printf("[lvgl] stopped %d timer(s) the last app left running\n", n);
  }

private:
  lua_State* _lua = nullptr;
};
