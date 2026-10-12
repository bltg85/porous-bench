// Board-level Resident state that outlives a single run: the relay connection, the device ID,
// the app loaded over the wire (persisted like NVS, so it survives a reload), the time zone, and
// a pointer to whichever app is running right now.

import type { ResidentHost } from './host';
import { type IncomingApp, newDeviceId, type RelayStatus, ResidentRelay } from './relay';
import { Zone } from './zone';

export interface LiveApp extends IncomingApp {
  name: string;
  /** Where it came from: pushed over the relay, written in the editor, a dropped .lua file, or a share link. */
  source: 'relay' | 'editor' | 'file' | 'link';
}

type Level = 'info' | 'warn' | 'error';

const KEY = 'bench:resident';

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${KEY}:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
/** The app kept from last time, unless what's stored isn't one. */
function savedLive(): LiveApp | null {
  const app = load<LiveApp>('live');
  return typeof app?.code === 'string' && typeof app.name === 'string' ? app : null;
}
function save(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(`${KEY}:${key}`);
    else localStorage.setItem(`${KEY}:${key}`, JSON.stringify(v));
  } catch {
    /* not persisted */
  }
}

class ResidentSession {
  readonly relay: ResidentRelay;
  live: LiveApp | null = savedLive();
  zone = new Zone();
  /** The Resident app running now, if the current sketch is one. */
  host: ResidentHost | null = null;
  /** Console sink, set by the UI. */
  log: (level: Level, text: string) => void = () => {};
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    const id = load<string>('deviceId') ?? newDeviceId();
    save('deviceId', id);
    this.relay = new ResidentRelay(id, load<string>('relayHost') ?? 'resident.inanimate.tech', {
      onApp: (app) => {
        this.log('info', `relay: app received${app.description ? ` — ${app.description}` : ''}`);
        this.setLive({ ...app, name: app.description ?? 'Pushed app', source: 'relay' });
      },
      onChunk: (code) => {
        if (!this.host) return this.log('warn', 'relay: chunk dropped, no app running');
        const err = this.host.chunk(code);
        this.log(err ? 'error' : 'info', err ? `chunk error: ${err}` : 'chunk applied');
      },
      onEvent: (e) => {
        if (!this.host?.queue({ ...e, ts_ms: undefined })) this.log('warn', `relay: event '${e.name}' dropped (no app with on_event)`);
      },
      onForget: () => {
        save('live', null);
        this.log('info', 'relay: forget — the saved app will not restore on reload');
      },
      onTimezone: (tz) => {
        if (!Zone.valid(tz)) return this.log('warn', `relay: unknown time zone '${tz}'`);
        this.zone = new Zone(tz);
        this.log('info', `relay: time zone ${tz}`);
        this.notify();
      },
      onStatus: () => this.notify(),
      onLog: (text) => this.log('info', text),
    });
    if (load<boolean>('connected')) this.relay.connect();
  }

  get deviceId(): string {
    return this.relay.deviceId;
  }
  get status(): RelayStatus {
    return this.relay.status;
  }

  connect(): void {
    save('connected', true);
    this.relay.connect();
    this.notify();
  }
  disconnect(): void {
    save('connected', false);
    this.relay.disconnect();
    this.notify();
  }
  newId(): void {
    const was = this.relay.status !== 'off';
    this.relay.disconnect();
    this.relay.deviceId = newDeviceId();
    save('deviceId', this.relay.deviceId);
    if (was) this.relay.connect();
    this.notify();
  }

  setLive(app: LiveApp): void {
    this.live = app;
    this.notify();
  }
  /** Called once the app compiled and init() ran: that's when the device persists it. */
  persistLive(app: LiveApp): void {
    if (this.live === app) save('live', app);
  }

  telemetry(name: string, data: Record<string, unknown> = {}, generationId?: string): void {
    this.relay.sendSystem('telemetry', { name, ...(generationId ? { generationId } : {}), ...data });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = (): number => this.version;
  private notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}

export const session = new ResidentSession();
