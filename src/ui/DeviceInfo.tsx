import type { ReactNode } from 'react';
import type { DeviceProfile } from '../sim/devices/types';

function maxFps(d: DeviceProfile): number {
  const n = d.width * d.height;
  if (d.tech === 'led') return 1000 / (((n * 24) / d.bus.hz) * 1000 + 0.3);
  const bytes = d.tech === 'lcd' || d.tech === 'amoled' ? n * 2 : n / 8;
  const clocks = d.bus.kind === 'i2c' ? bytes * 9 * 1.06 : d.bus.kind === 'qspi' ? bytes * 2 : d.bus.kind === 'rgb' ? bytes / 2 : bytes * 8;
  return d.bus.hz / clocks;
}

/** A line of the spec table: its name, its value, and optionally more on hover. */
export type Fact = [name: string, value: ReactNode, title?: string];

/**
 * The output: its pickers (children), then one table of facts (`facts` first: the board driving it,
 * the libraries and memory it gives apps), then the wiring and porting notes folded away.
 */
export function DeviceInfo({ device, facts = [], children }: { device: DeviceProfile; facts?: Fact[]; children?: ReactNode }) {
  // Round glass is sold by its diameter; everything else by its diagonal.
  const diag = (device.shape === 'round' ? device.look.activeWidthMm : Math.hypot(device.look.activeWidthMm, device.look.activeHeightMm)) / 25.4;
  const bus =
    device.bus.kind === 'ws2812'
      ? `one wire @ ${device.bus.hz / 1e3} kHz`
      : device.bus.kind !== 'i2c'
        ? `${device.bus.kind.toUpperCase()} @ ${device.bus.hz / 1e6} MHz`
        : `I2C @ ${device.bus.hz / 1e3} kHz · 0x${(device.bus.i2cAddress ?? 0x3c).toString(16)}`;
  const leds = device.look.leds;
  return (
    <div className="display-info">
      {children}
      <table className="readout">
        <tbody>
          {facts.map(([name, value, title]) => (
            <tr key={name} title={title}>
              <th>{name}</th>
              <td>{value}</td>
            </tr>
          ))}
          <tr>
            <th>{leds ? 'LEDs' : 'panel'}</th>
            <td>
              {leds
                ? `${device.width * device.height} · ${leds.layout === 'grid' ? `${device.width}×${device.height} grid` : leds.layout} · ${leds.pitchMm.toFixed(1)} mm apart`
                : `${device.width}×${device.height} · ${diag.toFixed(2)}″`}
            </td>
          </tr>
          <tr>
            <th>controller</th>
            <td>{device.controller}</td>
          </tr>
          <tr>
            <th>bus</th>
            <td>{bus}</td>
          </tr>
          {device.ram && (
            <tr title="The controller's RAM, and where the visible area starts in it">
              <th>RAM window</th>
              <td>
                {device.ram.width}×{device.ram.height} · x+{device.ram.offsetX}, y+{device.ram.offsetY}
              </td>
            </tr>
          )}
          {device.epaper ? (
            <>
              <tr>
                <th>full refresh</th>
                <td>{device.epaper.fullRefreshMs} ms</td>
              </tr>
              <tr>
                <th>partial refresh</th>
                <td>{device.epaper.partialRefreshMs} ms</td>
              </tr>
            </>
          ) : (
            <tr title="The most full frames a second the bus can carry">
              <th>frame rate</th>
              <td>≤ {Math.floor(maxFps(device))} fps</td>
            </tr>
          )}
        </tbody>
      </table>
      {(device.wiring || device.porting || device.url) && (
        <details className="display-more">
          <summary>Wiring and porting notes</summary>
          {device.wiring && (
            <>
              <h3>Wiring</h3>
              <div className="pins">
                {Object.entries(device.wiring).map(([fn, gpio]) => (
                  <span key={fn} className="pin">
                    {fn} <b>GPIO{gpio}</b>
                  </span>
                ))}
              </div>
            </>
          )}
          {device.porting && (
            <>
              <h3>Porting notes</h3>
              <ul className="notes">
                {device.porting.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          {device.url && (
            <a href={device.url} target="_blank" rel="noreferrer">
              Manufacturer docs ↗
            </a>
          )}
        </details>
      )}
    </div>
  );
}
