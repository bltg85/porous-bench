import { ledProfile, type Output } from '../leds';
import type { DeviceProfile } from './types';

// Every other .ts file in this folder is a device: drop a new file in to add one.
const modules = import.meta.glob<{ default: DeviceProfile }>(['./*.ts', '!./index.ts', '!./types.ts'], { eager: true });

export const devices: DeviceProfile[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => techOrder(a) - techOrder(b) || a.name.localeCompare(b.name));

export function findDevice(id: string): DeviceProfile | undefined {
  return devices.find((d) => d.id === id);
}

/** The profile for an output: a display by its id (undefined if there's no such display), or an LED chain built to its size. */
export function outputDevice(o: Output): DeviceProfile | undefined {
  return o.kind === 'display' ? findDevice(o.device) : ledProfile(o);
}

function techOrder(d: DeviceProfile) {
  return { lcd: 0, amoled: 1, oled: 2, epaper: 3, led: 4 }[d.tech];
}

export type { DeviceProfile, Tech } from './types';
