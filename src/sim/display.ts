import type { SimClock } from './clock';
import type { DeviceProfile, Tech } from './devices/types';
import { Framebuffer, type Rect } from './framebuffer';
import { Gfx } from './gfx';
import { createPanel, type Panel } from './panels/panel';
import { TouchScreen } from './touchscreen';

export type RefreshMode = 'auto' | 'full' | 'partial';

export interface DisplayStats {
  shows: number;
  bytes: number;
  /** Simulated time spent moving pixels over SPI/I2C. */
  busMs: number;
  /** Simulated time spent waiting for e-paper refreshes. */
  refreshMs: number;
  fullRefreshes: number;
}

/**
 * What a sketch draws on. Drawing goes into an MCU-side frame buffer (like a GFXcanvas or LVGL
 * draw buffer); show() pushes the changed region to the panel. show() takes as long as the
 * transfer would on the real bus (plus the refresh, for e-paper), so frame rates are realistic.
 */
export class Display extends Gfx {
  readonly panel: Panel;
  /** The touch panel over the glass, when the module has one. */
  readonly touch: TouchScreen | null;
  readonly stats: DisplayStats = { shows: 0, bytes: 0, busMs: 0, refreshMs: 0, fullRefreshes: 0 };
  private partialsSinceFull = 0;
  private everRefreshed = false;
  // E-paper, driven the way its firmware drives it: one refresh at a time.
  /** The newest frame shown while the panel was busy: the only one that will reach the glass. */
  private epaperNext: Uint8Array | null = null;
  /** A mode forced by the newest show(): 'full', 'partial', or 'auto'. */
  private epaperMode: RefreshMode = 'auto';
  /** The frame on the glass, or going there. */
  private epaperLast: Uint8Array | null = null;
  /** The refresh loop while it runs: resolves once no frame is waiting. */
  private epaperRun: Promise<void> | null = null;
  private epaperFb: Framebuffer | null = null;

  constructor(
    readonly profile: DeviceProfile,
    private clock: SimClock,
    private signal?: AbortSignal,
  ) {
    super(new Framebuffer(profile.width, profile.height, profile.tech === 'lcd' || profile.tech === 'amoled' || profile.tech === 'led' ? 'rgb565' : 'mono'));
    this.panel = createPanel(profile);
    this.touch = profile.touch ? new TouchScreen(profile.width, profile.height, () => clock.now()) : null;
  }

  get tech(): Tech {
    return this.profile.tech;
  }
  isColor(): boolean {
    return this.fb.format === 'rgb565';
  }
  hasPendingChanges(): boolean {
    return this.fb.isDirty() || this.epaperNext !== null;
  }
  /** An e-paper refresh is running (the panel's BUSY line). */
  refreshing(): boolean {
    return this.epaperRun !== null;
  }
  /** Mark the whole frame changed, so the next show() sends every pixel (a full-frame blit). */
  invalidate(): void {
    this.fb.markAllDirty();
  }

  /** 0..100. LCD backlight PWM / OLED contrast. */
  setBrightness(percent: number): void {
    this.panel.brightness = Math.min(100, Math.max(0, percent)) / 100;
  }
  getBrightness(): number {
    return Math.round(this.panel.brightness * 100);
  }

  /**
   * Push changes to the panel. E-paper: 'auto' picks partial refreshes and a periodic full one
   * (see profile.epaper.fullRefreshEvery); 'full'/'partial' force a mode.
   */
  async show(mode: RefreshMode = 'auto'): Promise<void> {
    if (this.profile.tech === 'epaper') return this.showEpaper(mode);
    const { width, height, tech } = this.profile;
    const dirty = this.fb.takeDirty();
    if (!dirty) return;

    let region: Rect = dirty;
    // A WS2812 chain is always sent end to end.
    if (tech === 'led') region = { x: 0, y: 0, w: width, h: height };
    if (tech === 'oled') {
      // SSD1306 memory is organised in 8-row pages; a transfer covers whole pages.
      const y0 = Math.floor(region.y / 8) * 8;
      const y1 = Math.min(height, Math.ceil((region.y + region.h) / 8) * 8);
      region = { x: region.x, y: y0, w: region.w, h: y1 - y0 };
    }

    const bytes = this.transferBytes(region, false);
    const busMs = this.transferMs(bytes);
    this.panel.write(this.fb, region);
    this.stats.shows++;
    this.stats.bytes += bytes;
    this.stats.busMs += busMs;
    await this.clock.sleep(busMs, this.signal);
  }

  /**
   * E-paper as the firmware drives it: the panel is BUSY until a refresh ends, so a frame shown
   * meanwhile waits, and only the newest waiting frame goes to the glass; a frame identical to the
   * one there isn't refreshed again. Resolves when the frame (or a newer one) is on the glass. Only
   * actual refreshes count towards the periodic full one.
   */
  private showEpaper(mode: RefreshMode): Promise<void> {
    const dirty = this.fb.takeDirty();
    if (dirty || mode !== 'auto') {
      this.epaperNext = (this.fb.data as Uint8Array).slice();
      if (mode !== 'auto') this.epaperMode = mode;
      if (!this.epaperRun) {
        this.epaperRun = this.runEpaper().finally(() => (this.epaperRun = null));
      }
    }
    return this.epaperRun ?? Promise.resolve();
  }

  private async runEpaper(): Promise<void> {
    const { width, height } = this.profile;
    const whole = { x: 0, y: 0, w: width, h: height };
    this.epaperFb ??= new Framebuffer(width, height, 'mono');
    while (this.epaperNext) {
      const frame = this.epaperNext;
      this.epaperNext = null;
      const mode = this.epaperMode;
      this.epaperMode = 'auto';
      const full = !this.everRefreshed || mode === 'full' || (mode === 'auto' && this.needsFullRefresh());
      if (!full && this.epaperLast && sameBytes(frame, this.epaperLast)) continue;
      this.epaperLast = frame;

      const bytes = this.transferBytes(whole, full);
      const busMs = this.transferMs(bytes);
      this.epaperFb.data.set(frame);
      this.panel.write(this.epaperFb, whole);
      this.stats.shows++;
      this.stats.bytes += bytes;
      this.stats.busMs += busMs;
      await this.clock.sleep(busMs, this.signal);

      const busy = this.panel.refresh!(full ? 'full' : 'partial', this.clock.now());
      this.everRefreshed = true;
      if (full) {
        this.partialsSinceFull = 0;
        this.stats.fullRefreshes++;
      } else this.partialsSinceFull++;
      this.stats.refreshMs += busy;
      await this.clock.sleep(busy, this.signal); // the firmware polls BUSY here
    }
  }

  private needsFullRefresh(): boolean {
    const every = this.profile.epaper?.fullRefreshEvery ?? 0;
    return !this.everRefreshed || (every > 0 && this.partialsSinceFull >= every);
  }

  private transferBytes(r: Rect, fullEpaperRefresh: boolean): number {
    switch (this.profile.tech) {
      case 'lcd':
      case 'amoled':
        return r.w * r.h * 2 + 11; // CASET + RASET + RAMWR, then RGB565 pixels
      case 'oled':
        return (r.w * r.h) / 8 + 6; // column/page address commands, then page bytes
      case 'epaper': {
        const ram = Math.ceil(this.profile.width / 8) * this.profile.height;
        return (fullEpaperRefresh ? 2 * ram : ram) + 12; // new (and old) image RAM + update commands
      }
      case 'led':
        return r.w * r.h * 3; // GRB, 8 bits each, for every LED in the chain
    }
  }

  private transferMs(bytes: number): number {
    const { kind, hz } = this.profile.bus;
    // WS2812: 1.25 µs a bit, then a ≥280 µs low to latch.
    if (kind === 'ws2812') return ((bytes * 8) / hz) * 1000 + 0.3;
    // I2C: 9 clocks per byte plus address+control bytes for every ~32-byte chunk.
    // QSPI: four data lines, four bits a clock. RGB: a 16-bit pixel a clock, as the panel scans.
    const clocks = kind === 'i2c' ? bytes * 9 + Math.ceil(bytes / 32) * 18 : kind === 'qspi' ? bytes * 2 : kind === 'rgb' ? bytes / 2 : bytes * 8;
    return (clocks / hz) * 1000;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
