# c6-lcd147: Resident on a Waveshare ESP32-C6-LCD-1.47

Resident firmware for the Waveshare ESP32-C6-LCD-1.47 (ESP32-C6FH8: 8 MB flash in the package, no
PSRAM, native USB-C; 1.47" ST7789V3 IPS LCD, 172×320), built in the three stages of Resident's
[start-building guide](https://github.com/inanimate-tech/resident/blob/main/docs/start-building.md).
Each stage is its own buildable PlatformIO project:

```
device-no-resident/       stage 1: chip info, test card, full-frame push timing, RGB LED, BOOT
device-minimal-resident/  stage 2: Wi-Fi (WiFiManager portal) + relay WebSocket + status screen
device/                   stage 3: drivers: screen, lgfx, button, screens (+ DEVICE-SKILL.md),
                          on a rebuilt Arduino core with more RAM for apps (84 KB)
device-prebuilt-core/     the same firmware on the prebuilt core: quick to build, 59 KB for apps
core3.py                  build fixes for Resident's libraries on Arduino core 3.x (stages 2-3)
```

The projects pull Resident from GitHub, pinned to the commit they were built and tested against
(0.10.2, `ecabf22`), so nothing needs cloning.

```bash
cd firmware/c6-lcd147/device && pio run -t upload && pio device monitor
```

`device/`'s first build downloads and compiles ESP-IDF to rebuild the core (several minutes; see
"Memory"). It rebuilds the libraries inside the shared `~/.platformio` framework package, so building
a project on the prebuilt core afterwards (stages 1-2, `device-prebuilt-core/`) reinstalls those,
and the next `device/` build compiles its own again.

On first boot without saved Wi-Fi the board opens a `Resident C6-lcd147 …` hotspot; join it and
enter your network. The screen then shows the 8-character device ID.

## Wiring (fixed on the board)

| Part | GPIO |
|---|---|
| LCD MOSI / SCLK | 6 / 7 |
| LCD CS / DC / RST | 14 / 15 / 21 |
| Backlight (PWM) | 22 |
| TF card MISO / CS (same SPI bus) | 5 / 4 |
| RGB LED | 8 |
| BOOT key (to GND) | 9 |

## Quirks worth knowing

- **It's an ESP32-C6FH8, 8 MB of flash** (esptool: "ESP32-C6FH8 (QFN32) (revision v0.2)"), not the
  4 MB FH4 some listings show. The `esp32-c6-devkitc-1` board profile (8 MB) fits as it is.
- **Arduino core 3.x only.** The C6 needs pioarduino's platform; Resident's examples use
  `espressif32@6.x` (core 2.x). Three things in Resident's libraries need help there, all in
  `core3.py` and the `lib_deps`:
  - Courier's WebSocket client, `esp_websocket_client`, was part of ESP-IDF 4 and is a managed
    component since IDF 5, which the core's prebuilt libraries don't include. The projects take it
    from Espressif's component registry (1.8.0); `tcp_transport`, `http_parser` and `esp-tls`,
    which it needs, are in the core.
  - Esp32Lua's C++ wrapper (unused by Resident, compiled anyway) names `std::string` without
    including `<string>`; core 2.x headers pulled it in by accident. `core3.py` force-includes it
    for Esp32Lua's C++ files only (globally, it breaks OpenThread when `device-lean` compiles
    ESP-IDF).
  - Esp32Lua also carries Lua's standalone `lua.c` and `luac.c`, each with a `main()`. Core 2.x
    linked libraries as archives, so nothing pulled them in; pioarduino links library objects
    directly and the two collide. `core3.py` leaves them out of the build.
  - Core 3.x already compiles C++ as gnu++2b, so Resident's `-std=gnu++17` override isn't needed.
- **Panel:** Adafruit's ST7789 driver at `init(172, 320)` puts the columns at offset 34 and sends
  INVON. Its rotation 2 is the panel's native scan (MADCTL 0x00, as Waveshare's demo): top away from
  the USB-C port. Rotation 0 mirrors both axes.
- **One full frame, pushed in ~32 ms.** `screen`, `lgfx` and the status text share one 172×320
  RGB565 canvas (110 KB), allocated before Wi-Fi so it gets one contiguous block. `flip()` pushes
  it whole at 80 MHz in ~31-33 ms, inside the Lua dispatch (well under the 1 s deadline). There's
  no room for a second buffer to push from in the background.
- **Lua is slow: the C6 has no FPU.** Floats, `math.sin`, `math.sqrt` and `^` are emulated. A
  full-screen `lgfx` flame doing ~137,000 Lua instructions and 985 draw calls a tick took ~285 ms
  (3.5 fps, `dt_ms` averaged over 30 ticks); with lookup tables, integer colour blends and fewer
  calls (~50,000 instructions, 609 calls) it took ~104 ms (10 fps). Bench doesn't model this; the
  device skill's *Speed on a real board* section tells app writers how to stay inside a tick.
- **The RGB LED takes R, G, B** byte order, not a WS2812's G, R, B: `rgbLedWrite(8, r, g, b)` shows
  red as green. Stage 1 swaps them. No Lua module drives it.
- **BOOT is GPIO9**, active low, with the board's own pull-up (a strapping pin). It's the only key.
- **Opening the serial port can reset the chip.** The C6's USB Serial/JTAG resets on DTR low with
  RTS high, and a tool that drops DTR before RTS (pyserial does) passes through that state. Release
  RTS first, then DTR.
- **No coredump partition**, so `esp_core_dump_flash: No core dump partition found!` at boot is
  expected.
- **Local time is UTC until Bench mirrors here.** Before each app it mirrors, Bench sends the zone
  its own apps run in (`{channel: "bench", type: "timezone", data: {tz}}`), and the board applies it
  with `setTimezone` (one lookup through ezTime's server, up to 2 s; the same zone again is skipped,
  and a reboot forgets it). Not as a Resident `hello`, which would set the zone too but also make the
  board drop un-channelled messages until reboot, and `/resident:push-app` still sends those.

## Memory

Without PSRAM, Lua, Wi-Fi, TLS and the WebSocket share the C6's internal SRAM. All figures from
`heap_caps_get_free_size(MALLOC_CAP_8BIT)` and `heap_caps_get_largest_free_block`, on the board.

### Lua gets its own heap

Resident's Lua allocator takes whatever internal RAM is free, and on this board that broke the
connection two ways. A big mirrored app (porous systems) took the heap to ~1 KB, TLS couldn't
allocate, and the WebSocket dropped. Capping Lua's share of free bytes wasn't enough either: a test
app holding thousands of 1 KB strings left ~50 KB free but a 1.3 KB largest block, so TLS (which
needs 16 KB in one piece for a reconnect) still failed. Either way the board stayed off the relay and
couldn't be sent the next app.

So `LuaArena` (in `device/lib/drivers/`) takes one block at boot, before Wi-Fi, makes it a heap of
its own (`multi_heap_register`) and points the sandbox's Lua state at it (`lua_setallocf`). An app
that outgrows it gets "not enough memory" in its own dispatch, and the board stays online and takes
the next app (tested: a memory hog filled the arena, then a pushed app loaded and its collector freed
the hog's memory). Lua's own state and libraries (13 KB) were allocated before the switch and stay
in the shared heap.

### A rebuilt core for more of it

The prebuilt Arduino core keeps 88 KB of code in IRAM, which on the C6 is the same SRAM the heap
comes from, and holds its TLS record buffers for the whole session. `device/` rebuilds the core
(pioarduino's `custom_sdkconfig`) with Wi-Fi's extra and sleep paths, PHY and power-management sleep
code, FreeRTOS's non-ISR functions, the ring buffer and the heap's functions in flash (IRAM code
88 → 54 KB), TLS buffers allocated per record, and a 4 KB esp_timer stack (Arduino sets 8).

| | prebuilt core (`device-prebuilt-core/`) | rebuilt core (`device/`) |
|---|---|---|
| free at boot | 345 KB | 383 KB |
| after the 110 KB canvas | 239 KB | 278 KB |
| Lua arena | 64 KB | 88 KB |
| **free in the arena for apps** | **59 KB** | **84 KB** |
| shared heap, connected: free / largest block | 42 / 19 KB | 54 / 34 KB |
| shared heap, lowest (TLS handshake, app arriving) | 27 KB | 23 KB |

With the prebuilt core, an 80 KB arena left the shared heap a 14 KB largest block, too small for a
TLS reconnect. With the rebuilt core and a 64 KB arena the shared heap had 78 KB free (largest
block 57 KB), so the arena grew to 88.

### What fits

An app arrives as one WebSocket message (the app wrapped in Bench's shim when it mirrors), which is
parsed in the shared heap (ArduinoJson 7 copies the code string, so ~2-3x its size in large blocks)
and compiled in the arena (~4x its size). Bench's estimate (`src/resident/needs.ts`: ~6x the wrapped
size, fitting in 3/4 of the app memory) matches what the rebuilt core runs:

| App, mirrored from Bench | Bench's estimate | rebuilt core (84 KB) | prebuilt core (59 KB) |
|---|---|---|---|
| hello, rainbow, bounce, lgfx hello, tilt ball | 17-27 KB | runs | runs |
| swiss clock (`datetime`) | 62 KB | runs | compiles, then every tick runs out of memory |
| water sim (12 KB wrapped) | 69 KB | compile runs out of memory | message can't be parsed |
| porous systems (13 KB wrapped) | 74 KB | message can't be parsed | message can't be parsed |
| LVGL apps (patterns, ...) | 66-144 KB | no `lvgl`; out of memory | |

No `lvgl`: luavgl's first bind alone keeps ~30 KB.
