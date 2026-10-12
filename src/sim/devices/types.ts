// A DeviceProfile describes one display product as data. The simulator derives everything from it:
// resolution, pixel format, how fast frames can travel over the bus, and how the panel looks.
// The hardware fields (controller, RAM offsets, wiring) aren't simulated byte-for-byte; they're
// recorded so porting a sketch to the real board has the facts in one place.

/** lcd/amoled/oled/epaper are displays; led is addressable LEDs (WS2812): a strip, a ring or a matrix.
 *  lcd: backlit colour. amoled: colour, each pixel emits (black is off). oled: 1-bit (SSD1306). */
export type Tech = 'lcd' | 'amoled' | 'oled' | 'epaper' | 'led';

/** A face of the body. Coordinates on a face are (u, v) in mm from its centre:
 *  front/back: u = x (right), v = y (up) · left/right: u = depth (towards the viewer), v = y
 *  top/bottom: u = x, v = depth. Everything is in the panel's native orientation. */
export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export type EnclosurePart =
  /** Clickable: `input` is the n-th button the sketch declares (Resident apps: 0 = A, 1 = B).
   *  `z`: mm off the face, for a key on a board plugged in behind. */
  | { kind: 'button'; face: Face; u: number; v: number; w: number; h: number; z?: number; input?: number; color?: string; label?: string }
  | { kind: 'port'; face: Face; u: number; v: number; w: number; h: number; label?: string }
  | { kind: 'header'; face: Face; u: number; v: number; pins: number; along: 'u' | 'v'; label?: string }
  | { kind: 'hole'; face: Face; u: number; v: number; r: number }
  | { kind: 'led'; face: Face; u: number; v: number; r: number; color: string; label?: string }
  /** A box standing `z` mm off the face, `d` deep: a board plugged in behind, its sockets, its shield can. */
  | { kind: 'block'; face: Face; u: number; v: number; w: number; h: number; d: number; z?: number; r?: number };

/** The physical part around the glass, drawn as a ghosted wireframe in the 3D view (mm). */
export interface Enclosure {
  /** 'case' = a moulded device (rounded, bevelled); 'pcb' = a bare board with the display module on top. */
  style: 'case' | 'pcb';
  /** `hole`: a round hole through the board's centre, radius in mm (a NeoPixel ring); the body is then a disc. */
  body: { w: number; h: number; d: number; r: number; hole?: number };
  /** pcb style: the display module (glass + frame) sitting on the board's front. */
  module?: { w: number; h: number; d: number; r: number; x: number; y: number };
  /** Centre of the active area relative to the body centre. */
  screen: { x: number; y: number };
  parts?: EnclosurePart[];
}

export interface DeviceProfile {
  id: string;
  name: string;
  tech: Tech;
  /** Visible pixels in the panel's native orientation. */
  width: number;
  height: number;
  /** Round glass: only the circle inscribed in width × height is visible (screens.get reports it). */
  shape?: 'rect' | 'round';

  controller: string;
  /** ws2812: one-wire, 24 bits per LED at 800 kHz, the whole chain every time. qspi: 4 data lines. */
  bus: { kind: 'spi' | 'qspi' | 'i2c' | 'ws2812'; hz: number; i2cAddress?: number };
  /** Where the visible area sits inside controller RAM (what drivers call colstart/rowstart). */
  ram?: { width: number; height: number; offsetX: number; offsetY: number };
  /** setRotation() the board's firmware applies (e.g. M5StickC Plus2 runs landscape). Used for Resident apps. */
  firmwareRotation?: number;
  /** A touch panel over the glass: apps get `touchscreen` and `touch_*` events. */
  touch?: { controller: string; i2cAddress?: number };
  /** The boards (ids in src/sim/boards.ts) that can drive it, the default first. Unset: any generic board. */
  boards?: string[];
  /** Hardware built into the board besides its buttons (those come from the enclosure). */
  builtins?: ('imu' | 'buzzer')[];
  /** Function → GPIO on boards with a built-in display. */
  wiring?: Record<string, number>;
  /** Things a driver must get right on real hardware. */
  porting?: string[];
  url?: string;

  enclosure?: Enclosure;

  look: {
    activeWidthMm: number;
    activeHeightMm: number;
    cornerRadiusPx?: number;
    /** OLED: lit pixel. E-paper: paper. */
    light?: string;
    /** OLED: unlit pixel. E-paper: ink. */
    dark?: string;
    /** Two-colour OLED glass: the first N rows use accentColor. */
    accentRows?: number;
    accentColor?: string;
    /** LEDs: how they sit (width × height of them; the frame buffer holds them as they sit, row by row). */
    /** `radiusMm`: a ring's LEDs sit on a circle of this radius (mm), centred on the board. */
    /** `chain`: on a matrix, the way the chain runs through the grid (unset: row by row). */
    leds?: { layout: 'line' | 'ring' | 'grid'; pitchMm: number; radiusMm?: number; chain?: ChainLayout };
  };

  epaper?: {
    fullRefreshMs: number;
    partialRefreshMs: number;
    /** show('auto') does a full refresh after this many partial ones. */
    fullRefreshEvery: number;
  };
}

/**
 * How a matrix's chain runs through its grid from the LED where data comes in, at the top left:
 * along the rows or down the columns, and on a serpentine panel every other line backwards, so the
 * chain never jumps back across the board.
 */
export interface ChainLayout {
  along: 'rows' | 'columns';
  serpentine: boolean;
}
