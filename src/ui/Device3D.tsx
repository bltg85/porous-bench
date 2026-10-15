import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { Board } from '../sim/boards';
import type { SimClock } from '../sim/clock';
import type { Imu } from '../sim/inputs/imu';
import type { SketchRun } from '../sim/runner';
import { drawLeds, ledCells } from '../sim/leds';
import { touchByModule } from '../sim/wiring';
import { buildModel, type ModelButton } from './three/model';
import { buildPeripherals, type Grab, microcontroller, type Peripheral, wire, wirePath } from './three/peripherals';

interface Props {
  run: SketchRun;
  clock: SimClock;
  /** The board driving the output: a dev board stands on the desk between the parts and the output. */
  board?: Board;
  /** Quarter turns clockwise: how the module is mounted. */
  mount: () => number;
  onCanvas?(c: HTMLCanvasElement | null): void;
}

const BASE = { pitch: -0.32, yaw: 0.42 };
// With the radar's character on the desk, look across the desk rather than down on it, so it's
// seen standing up.
const BASE_DIORAMA = { pitch: -0.85, yaw: 0.3 };
const PRESS_MM = 0.7;
const GAP = 16; // mm between the device and its parts, and between parts
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 12;
const FIT_MARGIN = 0.86; // fraction of the stage that "fit all" fills

type Pos = { x: number; y: number };

/**
 * Ways to lay parts out automatically: in columns to the right of the device (each at most `f`
 * device-heights tall) or in rows under it (each at most `f` device-widths wide). The first is the
 * default; the layout picks whichever fills the stage best.
 */
const FLOWS = [
  { dir: 'right', f: 1.6 },
  { dir: 'right', f: 1 },
  { dir: 'right', f: 2.6 },
  { dir: 'right', f: 4 },
  { dir: 'below', f: 1 },
  { dir: 'below', f: 1.8 },
  { dir: 'below', f: 3 },
] as const;

/** Imperative view tools for the overlay buttons. */
interface ViewTools {
  fitAll(): void;
  zoomBy(factor: number): void;
  tidy(): void;
}

/** Where the user put things on the desk, per device and sketch. */
function loadDesk(key: string): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Pos>;
  } catch {
    return {};
  }
}
function saveDesk(key: string, desk: Record<string, Pos>) {
  try {
    localStorage.setItem(key, JSON.stringify(desk));
  } catch {
    /* not persisted */
  }
}

/** Nearest point on the outline of an axis-aligned rectangle (xy) to p. */
function nearestOnRect(p: THREE.Vector3, box: THREE.Box3): THREE.Vector3 {
  const x = Math.max(box.min.x, Math.min(box.max.x, p.x));
  const y = Math.max(box.min.y, Math.min(box.max.y, p.y));
  if (x !== p.x || y !== p.y) return new THREE.Vector3(x, y, p.z);
  // Inside the rectangle: go to the closest edge.
  const d = [p.x - box.min.x, box.max.x - p.x, p.y - box.min.y, box.max.y - p.y];
  const i = d.indexOf(Math.min(...d));
  return new THREE.Vector3(i === 0 ? box.min.x : i === 1 ? box.max.x : p.x, i === 2 ? box.min.y : i === 3 ? box.max.y : p.y, p.z);
}

/**
 * The device as a ghosted 3D wireframe with the live screen on it, plus the sketch's external
 * hardware on the desk beside it, wired back with dashed lines. Everything sits on one desk plane.
 *
 * Mouse: drag empty space to orbit (double-click to reset and fit); press a button, knob, pot or the
 * radar to use it; drag the body of the device or of a part to slide it across the desk (⌥ Option-drag
 * moves anything; double-click it to put it back); shift-drag the device to tilt it when its board
 * has an IMU of its own (an IMU you added is a GY-521 on the desk: drag across it). F fits everything in view. Until you zoom or pan, the view keeps everything fitted.
 */
export function Device3D({ run, clock, board, mount, onCanvas }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef(mount);
  mountRef.current = mount;
  // Swapping hardware rebuilds the scene; the orbit survives it.
  const benchVersion = useSyncExternalStore(run.bench.subscribe, run.bench.getVersion);
  // The view (orbit, zoom, pan) survives rebuilds.
  // `manual`: the user zoomed or panned, so stop re-fitting on resizes and rebuilds.
  const orbitRef = useRef({ yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, zoom: 1, panX: 0, panY: 0, manual: false });
  const toolsRef = useRef<ViewTools | null>(null);
  const [movedByHand, setMovedByHand] = useState(false);
  // A frame that threw: rethrown while rendering, so the ErrorBoundary around the view hears of it
  // (an error in a requestAnimationFrame callback never reaches React).
  const [broken, setBroken] = useState<unknown>(undefined);
  if (broken !== undefined) throw broken;

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    onCanvas?.(renderer.domElement);

    const { device } = run;
    const native = document.createElement('canvas');
    // LEDs are painted as glowing dots, so their texture needs room for the glow.
    const leds = device.tech === 'led';
    const cells = leds ? ledCells(device) : null;
    // A ring is seen up close, its packages to scale: give it more pixels per LED.
    const perCell = device.look.leds?.layout === 'ring' ? 64 : 24;
    native.width = cells ? Math.min(2048, cells.w * perCell) : device.width;
    native.height = cells ? Math.min(2048, cells.h * perCell) : device.height;
    const nctx = native.getContext('2d')!;
    const image = new ImageData(device.width, device.height);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(26, 1, 1, 8000);
    const model = buildModel(device, native);

    // The device's body, to grab it by: everything but its buttons (those get pressed).
    const bodyBox = new THREE.Box3();
    model.group.updateMatrixWorld(true);
    for (const child of model.group.children) {
      // Precise (vertex) bounds: the quick ones inflate rotated parts by many millimetres.
      if (!model.buttons.some((b) => b.mesh === child)) bodyBox.expandByObject(child, true);
    }
    const deviceHandle = new THREE.Mesh(
      new THREE.BoxGeometry(...bodyBox.getSize(new THREE.Vector3()).toArray()),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    bodyBox.getCenter(deviceHandle.position);
    model.group.add(deviceHandle);

    // pivot (orbit) → content (centred on the desk) → deskGroup (where the device sits on the desk)
    // → tilt (IMU) → mount (setRotation) → model
    const mountGroup = new THREE.Group();
    mountGroup.add(model.group);
    const tiltGroup = new THREE.Group();
    tiltGroup.add(mountGroup);
    const deskGroup = new THREE.Group();
    deskGroup.add(tiltGroup);
    const content = new THREE.Group();
    content.add(deskGroup);
    const pivot = new THREE.Group();
    pivot.add(content);
    scene.add(pivot);

    const hardware = run.bench.parts();
    // The device's n-th physical button is the bench's built-in button n; built-in parts have no
    // part of their own on the desk. A built-in IMU tilts the device; one you added is a part.
    const inputFor = (b: ModelButton) => (b.input === undefined ? undefined : run.bench.builtinButton(b.input));
    const onDevice = new Set(hardware.filter((p) => run.bench.isBuiltin(p)));
    const imu = hardware.find((i) => i.kind === 'imu' && onDevice.has(i)) as Imu | undefined;

    // External parts on the desk, plus wires back to the device. A bare module or an LED chain
    // can't read them itself: its dev board stands first on the desk, the parts wired to it and it
    // to the output, as they would be on a real desk.
    const mcu = board ? microcontroller(board.id) : null;
    const parts: Peripheral[] = [...(mcu ? [mcu] : []), ...buildPeripherals(hardware, onDevice, !!board && touchByModule(board.id))];
    // Where you put a part is remembered by its id on the bench.
    const partKeys = parts.map((p, i) => (p === mcu ? 'board' : p.input && run.bench.idOf(p.input)) || `part:${i}`);
    const desk = new THREE.Group();
    content.add(desk);
    for (const p of parts) desk.add(p.root);
    const wires = new THREE.Group();
    content.add(wires);
    const base = hardware.some((h) => h.kind === 'ld2410') ? BASE_DIORAMA : BASE;

    // The desk belongs to the bench, not the app: the layout stays when you switch apps.
    const deskKey = `bench:desk:${device.id}`;
    const placed = loadDesk(deskKey);
    const savePlaced = () => {
      saveDesk(deskKey, placed);
      setMovedByHand(Object.keys(placed).length > 0);
    };
    setMovedByHand(Object.keys(placed).length > 0);

    const orbit = orbitRef.current;
    let grab: Grab | null = null;
    let orbiting: { x: number; y: number } | null = null;
    let tilting: { x: number; y: number } | null = null;
    let panning: { x: number; y: number } | null = null;
    let moving: { key: string; obj: THREE.Object3D; start: THREE.Vector3; from: THREE.Vector3 } | null = null;
    let pressed: ModelButton | null = null;
    // A touch panel: the pointer on the screen mesh, in native pixels via its texture coordinates.
    const touchPanel = run.display.touch;
    let touching = false;
    const touchPoint = (e: { clientX: number; clientY: number }): [number, number] | null => {
      setRay(e);
      const [hit] = ray.intersectObject(model.screen, false);
      if (!hit?.uv) return null;
      const nx = hit.uv.x * device.width;
      const ny = (1 - hit.uv.y) * device.height;
      return [Math.min(device.width - 1, Math.floor(nx)), Math.min(device.height - 1, Math.floor(ny))];
    };
    let laidOutFor = -1;
    let framed = false;
    // A camera move in progress (fit, zoom buttons), eased in each frame.
    let goal: { zoom: number; panX: number; panY: number } | null = null;
    let fitAfterLayout: 'instant' | 'ease' | null = orbit.manual ? null : 'instant';
    const fitSize = new THREE.Vector3(model.radius * 2, model.radius * 2, 0);
    const devBox = new THREE.Box3(); // device footprint relative to deskGroup, as currently mounted
    let deskZ = 0; // the desk plane everything stands on and slides along
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const el = renderer.domElement;

    const tan = Math.tan((camera.fov * Math.PI) / 360);
    let fitDist = 100; // camera distance at zoom 1
    const placeCamera = () => {
      // The camera keeps looking straight down -z; zoom moves it in, pan slides it sideways.
      camera.position.set(orbit.panX, orbit.panY, fitDist / orbit.zoom);
      camera.rotation.set(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Fit the desk's width and height (with room for the default tilt), not a bounding sphere,
      // so a wide row of parts still fills the stage.
      fitDist = Math.max(fitSize.y / 2 / tan, fitSize.x / 2 / (tan * camera.aspect)) * 1.3 + fitSize.z;
      placeCamera();
    };
    const onResize = () => {
      resize();
      // A new stage shape may suit another automatic layout; re-flow, and keep things fitted.
      if (!moving) laidOutFor = -1;
      if (!orbit.manual) fitAfterLayout = 'instant';
      // Resizing the canvas clears it, and a ResizeObserver runs after this frame's
      // requestAnimationFrame but before the paint: draw now, or the stage shows one empty frame
      // (a flash, e.g. going full screen).
      paint();
    };

    /**
     * Where the camera must sit to show the device, every part and the wires, seen from the angle
     * the orbit is heading to. The camera looks straight down -z, so a point (x, y, z) is in view
     * when the camera is at least |x − cx| / (tan · aspect) and |y − cy| / tan further back than z.
     */
    const fitGoal = () => {
      if (!host.clientWidth || !host.clientHeight) return null;
      const saved = pivot.rotation.clone();
      pivot.rotation.set(base.pitch + orbit.tPitch, base.yaw + orbit.tYaw, 0, 'YXZ');
      scene.updateMatrixWorld(true);
      // Every vertex you can see — the device, the parts and the wires — in world space. Fully
      // transparent pick helpers (hit boxes, the radar's floor) don't count.
      const pts: THREE.Vector3[] = [];
      const v = new THREE.Vector3();
      content.traverseVisible((o) => {
        const pos = (o as THREE.Mesh).geometry?.attributes?.position;
        const mat = (o as THREE.Mesh).material;
        if (!pos || (mat && !Array.isArray(mat) && mat.transparent && mat.opacity === 0)) return;
        for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).clone());
      });
      pivot.rotation.copy(saved);
      if (!pts.length) return null;
      const all = new THREE.Box3().setFromPoints(pts);
      let cx = (all.min.x + all.max.x) / 2;
      let cy = (all.min.y + all.max.y) / 2;
      const zMid = (all.min.z + all.max.z) / 2;
      const distFor = () => {
        let d = 0;
        for (const p of pts) d = Math.max(d, p.z + Math.max(Math.abs(p.x - cx) / (tan * camera.aspect), Math.abs(p.y - cy) / tan) / FIT_MARGIN);
        return d;
      };
      let dist = distFor();
      // Perspective makes near things look bigger, so the box's centre isn't the picture's centre:
      // nudge the camera to centre what it actually sees, then fit again.
      for (let pass = 0; pass < 3; pass++) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of pts) {
          const k = 1 / (dist - p.z);
          x0 = Math.min(x0, (p.x - cx) * k);
          x1 = Math.max(x1, (p.x - cx) * k);
          y0 = Math.min(y0, (p.y - cy) * k);
          y1 = Math.max(y1, (p.y - cy) * k);
        }
        cx += ((x0 + x1) / 2) * (dist - zMid);
        cy += ((y0 + y1) / 2) * (dist - zMid);
        dist = distFor();
      }
      return { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitDist / dist)), panX: cx, panY: cy };
    };
    const fitAll = (ease: boolean) => {
      const g = fitGoal();
      if (!g) return;
      orbit.manual = false;
      if (ease) goal = g;
      else {
        goal = null;
        Object.assign(orbit, g);
        placeCamera();
      }
    };

    /** Zoom by `factor`, keeping the point under the cursor (in normalised device coordinates) still. */
    const zoomAt = (nx: number, ny: number, factor: number) => {
      goal = null;
      orbit.manual = true;
      const d = fitDist / orbit.zoom;
      const wx = orbit.panX + nx * tan * d * camera.aspect;
      const wy = orbit.panY + ny * tan * d;
      orbit.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, orbit.zoom * factor));
      const d2 = fitDist / orbit.zoom;
      orbit.panX = wx - nx * tan * d2 * camera.aspect;
      orbit.panY = wy - ny * tan * d2;
      placeCamera();
    };

    /** Redraw every wire, from its part to the nearest edge of the board, or of the device without one. */
    const updateWires = () => {
      wires.children.forEach((w) => (w as THREE.Line).geometry.dispose());
      wires.clear();
      content.updateMatrixWorld(true);
      const dev = devBox.clone().translate(deskGroup.position);
      let hub = dev;
      if (mcu?.body) {
        const c = mcu.root.position;
        hub = new THREE.Box3(new THREE.Vector3(c.x - mcu.body.w / 2, c.y - mcu.body.h / 2, deskZ), new THREE.Vector3(c.x + mcu.body.w / 2, c.y + mcu.body.h / 2, deskZ));
        // The board to the output: from the board's edge nearest the device.
        const to = nearestOnRect(c.clone().setZ(deskZ), dev);
        wires.add(wire(nearestOnRect(to, hub), to));
      }
      // Wires to the board would cross the parts between: bend one sideways, as little as clears
      // them, preferring the side away from the output, so the wires gather at the board.
      const devC = dev.getCenter(new THREE.Vector3());
      const rects = parts.map((p) => {
        const c = p.root.position;
        const w = (p.body?.w ?? p.w) * 0.42;
        const h = (p.body?.h ?? p.h) * 0.42;
        return { x0: c.x - w, x1: c.x + w, y0: c.y - h, y1: c.y + h };
      });
      const bow = (from: THREE.Vector3, to: THREE.Vector3, own: number) => {
        if (hub === dev) return undefined;
        const blocked = (b?: THREE.Vector3) =>
          wirePath(from, to, b)
            .getPoints(24)
            .some((pt) => rects.some((r, i) => i !== own && parts[i] !== mcu && pt.x > r.x0 && pt.x < r.x1 && pt.y > r.y0 && pt.y < r.y1));
        if (!blocked()) return undefined;
        const d = new THREE.Vector3(to.x - from.x, to.y - from.y, 0);
        const n = new THREE.Vector3(-d.y, d.x, 0).normalize();
        const mid = from.clone().lerp(to, 0.5);
        if (n.x * (devC.x - mid.x) + n.y * (devC.y - mid.y) > 0) n.negate();
        let last = n;
        for (const k of [16, 28, 42, 58, 76])
          for (const side of [n, n.clone().negate()]) {
            last = side.clone().multiplyScalar(k);
            if (!blocked(last)) return last;
          }
        return n.clone().multiplyScalar(76);
      };
      parts.forEach((p, i) => {
        if (p === mcu) return;
        const from = content.worldToLocal(p.root.localToWorld(p.anchor.clone()));
        from.z = deskZ;
        const to = nearestOnRect(from, hub);
        wires.add(wire(from, to, bow(from, to, i)));
      });
    };

    /** Where each part goes under one automatic flow (null for parts placed by hand). */
    const flowParts = (flow: (typeof FLOWS)[number], dp: Pos): (Pos | null)[] => {
      const devW = devBox.max.x - devBox.min.x;
      const devH = devBox.max.y - devBox.min.y;
      if (flow.dir === 'right') {
        const top = devBox.max.y + dp.y;
        let x = devBox.max.x + dp.x + GAP + 10;
        let y = top;
        let col = 0;
        return parts.map((p, i) => {
          if (placed[partKeys[i]]) return null;
          if (top - (y - p.h) > devH * flow.f && y !== top) {
            x += col + GAP;
            y = top;
            col = 0;
          }
          const at = { x: x + p.w / 2, y: y - p.h / 2 };
          y -= p.h + GAP;
          col = Math.max(col, p.w);
          return at;
        });
      }
      const left = devBox.min.x + dp.x;
      let x = left;
      let y = devBox.min.y + dp.y - GAP - 10;
      let row = 0;
      return parts.map((p, i) => {
        if (placed[partKeys[i]]) return null;
        if (x + p.w - left > devW * flow.f && x !== left) {
          x = left;
          y -= row + GAP;
          row = 0;
        }
        const at = { x: x + p.w / 2, y: y - p.h / 2 };
        x += p.w + GAP;
        row = Math.max(row, p.h);
        return at;
      });
    };
    /** The flow whose footprint, roughly as seen from the default angle, fills the stage best. */
    const bestFlow = (dp: Pos) => {
      const aspect = host.clientWidth && host.clientHeight ? host.clientWidth / host.clientHeight : 1.6;
      let best: { at: (Pos | null)[]; score: number } | null = null;
      for (const flow of FLOWS) {
        const at = flowParts(flow, dp);
        const box = devBox.clone().translate(new THREE.Vector3(dp.x, dp.y, 0));
        parts.forEach((p, i) => {
          const c = at[i] ?? placed[partKeys[i]];
          box.expandByPoint(new THREE.Vector3(c.x - p.w / 2, c.y - p.h / 2, 0));
          box.expandByPoint(new THREE.Vector3(c.x + p.w / 2, c.y + p.h / 2, 0));
        });
        const w = (box.max.x - box.min.x) * Math.cos(base.yaw);
        const h = (box.max.y - box.min.y) * Math.abs(Math.cos(base.pitch));
        // Prefer the default unless another layout is clearly bigger on screen.
        const score: number = Math.min(aspect / w, 1 / h) * (best ? 1 : 1.08);
        if (!best || score > best.score) best = { at, score };
      }
      return best!.at;
    };

    /**
     * Place the device and parts: where the user put them, otherwise the device at the origin and
     * the parts flowing beside or under it, whichever suits the stage. Centres the desk the first time.
     */
    const layout = (quarterTurns: number) => {
      // Measure in desk coordinates: level the orbit pivot while measuring, then restore it.
      const savedPivot = pivot.rotation.clone();
      pivot.rotation.set(0, 0, 0);
      const savedRot = mountGroup.rotation.z;
      const savedTilt = tiltGroup.rotation.clone();
      mountGroup.rotation.z = (-quarterTurns * Math.PI) / 2;
      tiltGroup.rotation.set(0, 0, 0);
      deskGroup.position.set(0, 0, 0);
      const savedContent = content.position.clone();
      content.position.set(0, 0, 0);
      // From the pivot down: refreshing only `content` would keep the pivot's orbit rotation and
      // measure a tilted, inflated box (the desk then sat below the device and wires missed it).
      pivot.updateMatrixWorld(true);
      devBox.setFromObject(model.group, true); // precise, so the desk and the wires meet the real body
      mountGroup.rotation.z = savedRot;
      tiltGroup.rotation.copy(savedTilt);
      content.position.copy(savedContent);
      deskZ = devBox.min.z;

      const dp = placed.device ?? { x: 0, y: 0 };
      deskGroup.position.set(dp.x, dp.y, 0);

      // Auto flow, relative to wherever the device is.
      const at = bestFlow(dp);
      parts.forEach((p, i) => {
        const c = at[i] ?? placed[partKeys[i]];
        p.root.position.set(c.x, c.y, deskZ);
      });
      updateWires();
      if (!framed) {
        // Centre everything once, so orbiting turns around the whole desk; later moves don't jump it.
        framed = true;
        content.position.set(0, 0, 0);
        pivot.updateMatrixWorld(true); // still level here
        const all = new THREE.Box3().setFromObject(content, true);
        content.position.copy(all.getCenter(new THREE.Vector3())).multiplyScalar(-1);
        all.getSize(fitSize);
        resize();
      }
      pivot.rotation.copy(savedPivot);
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    const setRay = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };

    /** Where the pointer ray meets the desk plane, in content coordinates. */
    const onDesk = (): THREE.Vector3 | null => {
      content.updateMatrixWorld(true);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(content.matrixWorld);
      const p = content.localToWorld(new THREE.Vector3(0, 0, deskZ));
      const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, p), new THREE.Vector3());
      return hit ? content.worldToLocal(hit) : null;
    };

    type Hit =
      | { kind: 'button'; button: ModelButton }
      | { kind: 'part'; part: Peripheral; object: THREE.Object3D }
      | { kind: 'move'; key: string; obj: THREE.Object3D };
    /** What's under the pointer. With `moveAnything`, whatever is hit resolves to moving its owner. */
    const pick = (e: { clientX: number; clientY: number }, moveAnything = false): Hit | null => {
      setRay(e);
      const targets: THREE.Object3D[] = [
        ...model.buttons.map((b) => b.mesh),
        ...parts.flatMap((p) => [...p.targets, ...p.handles]),
        deviceHandle,
      ];
      const [first] = ray.intersectObjects(targets, false);
      if (!first) return null;
      const o = first.object;
      const button = model.buttons.find((b) => b.mesh === o);
      if (button || o === deviceHandle) {
        if (moveAnything || !button) return { kind: 'move', key: 'device', obj: deskGroup };
        return { kind: 'button', button };
      }
      const i = parts.findIndex((p) => p.targets.includes(o) || p.handles.includes(o));
      if (i < 0) return null;
      if (moveAnything || parts[i].handles.includes(o)) return { kind: 'move', key: partKeys[i], obj: parts[i].root };
      return { kind: 'part', part: parts[i], object: o };
    };

    const startMove = (key: string, obj: THREE.Object3D): boolean => {
      const start = onDesk();
      if (!start) return false;
      moving = { key, obj, start, from: obj.position.clone() };
      el.style.cursor = 'grabbing';
      return true;
    };

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2) {
        // Right or middle drag pans the view.
        panning = { x: e.clientX, y: e.clientY };
        el.style.cursor = 'grabbing';
        return;
      }
      if (touchPanel && !e.altKey) {
        const p = touchPoint(e);
        if (p) {
          touching = true;
          touchPanel.press(...p);
          return;
        }
      }
      const hit = pick(e, e.altKey);
      if (hit?.kind === 'button') {
        const input = inputFor(hit.button);
        if (input) {
          pressed = hit.button;
          input.setDown(true);
          return;
        }
        // A button the sketch doesn't use is just part of the body.
        if (startMove('device', deskGroup)) return;
      }
      if (hit?.kind === 'part') {
        grab = hit.part.grab(hit.object, ray.ray);
        if (grab) {
          el.style.cursor = 'grabbing';
          return;
        }
        // Nothing to operate there (the buzzer's disc): move the part instead.
        const i = parts.indexOf(hit.part);
        if (startMove(partKeys[i], hit.part.root)) return;
      }
      if (hit?.kind === 'move') {
        if (e.shiftKey && imu && hit.key === 'device') tilting = { x: e.clientX, y: e.clientY };
        else startMove(hit.key, hit.obj);
        return;
      }
      orbiting = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (touching) {
        const p = touchPoint(e);
        if (p) touchPanel?.move(...p);
        return;
      }
      if (panning) {
        goal = null;
        orbit.manual = true;
        const d = fitDist / orbit.zoom;
        orbit.panX -= ((e.clientX - panning.x) / el.clientWidth) * 2 * tan * d * camera.aspect;
        orbit.panY += ((e.clientY - panning.y) / el.clientHeight) * 2 * tan * d;
        panning = { x: e.clientX, y: e.clientY };
        placeCamera();
        return;
      }
      if (moving) {
        setRay(e);
        const p = onDesk();
        if (p) {
          moving.obj.position.x = moving.from.x + (p.x - moving.start.x);
          moving.obj.position.y = moving.from.y + (p.y - moving.start.y);
          updateWires();
        }
        return;
      }
      if (grab) {
        setRay(e);
        grab.move(ray.ray);
        return;
      }
      if (tilting && imu) {
        const t = imu.getTilt();
        imu.setTilt(t.x + (e.clientX - tilting.x) * 0.006, t.y + (e.clientY - tilting.y) * 0.006);
        tilting = { x: e.clientX, y: e.clientY };
        return;
      }
      if (orbiting) {
        orbit.tYaw += (e.clientX - orbiting.x) * 0.008;
        orbit.tPitch = Math.max(-1.3, Math.min(1.3, orbit.tPitch + (e.clientY - orbiting.y) * 0.008));
        orbiting = { x: e.clientX, y: e.clientY };
        return;
      }
      const hit = pick(e, e.altKey);
      if (hit?.kind === 'button') {
        const input = inputFor(hit.button);
        const id = input && run.bench.idOf(input);
        const drives = run.controls.filter((c) => c.connection?.part === id).map((c) => c.label);
        el.style.cursor = input ? 'pointer' : 'move';
        el.title = !input
          ? `${hit.button.label}`
          : drives.length
            ? `${hit.button.label} → ${drives.join(', ')}`
            : `${hit.button.label} (not connected to anything in this app)`;
      } else if (hit?.kind === 'part') {
        el.style.cursor = 'pointer';
        el.title = hit.part.title(hit.object);
      } else if (hit?.kind === 'move') {
        el.style.cursor = 'move';
        el.title =
          hit.key === 'device'
            ? `Drag to slide the device across the desk${imu ? ' · shift-drag to tilt it' : ''} · double-click to put it back`
            : hit.key === 'board'
              ? `${board?.name}, driving the ${device.tech === 'led' ? 'LEDs' : 'display'}: the parts are wired to it · drag to slide it across the desk · double-click to put it back`
              : 'Drag to slide it across the desk · double-click to put it back';
      } else {
        el.style.cursor = 'grab';
        el.title = 'Drag to orbit · scroll or pinch to zoom · right-drag to pan · double-click to reset the view · ⌥ Option-drag moves anything';
      }
    };
    const onUp = () => {
      if (moving) {
        placed[moving.key] = { x: moving.obj.position.x, y: moving.obj.position.y };
        savePlaced();
        moving = null;
      }
      if (pressed) inputFor(pressed)?.setDown(false);
      if (touching) touchPanel?.release();
      touching = false;
      grab?.up();
      pressed = null;
      grab = null;
      orbiting = null;
      tilting = null;
      panning = null;
    };
    const onDbl = (e: MouseEvent) => {
      const hit = pick(e, true);
      if (hit?.kind === 'move' && placed[hit.key]) {
        // Put it back where the automatic layout wants it.
        delete placed[hit.key];
        savePlaced();
        laidOutFor = -1;
        return;
      }
      // Empty desk: back to the default angle, with everything in view.
      orbit.tYaw = 0;
      orbit.tPitch = 0;
      fitAll(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.('input, select, textarea, [contenteditable]')) return;
      fitAll(true);
    };
    toolsRef.current = {
      fitAll: () => fitAll(true),
      zoomBy: (factor) => {
        orbit.manual = true;
        const from = goal ?? orbit;
        goal = { zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, from.zoom * factor)), panX: from.panX, panY: from.panY };
      },
      tidy: () => {
        // Forget every hand placement, re-flow, re-centre the desk, then fit it.
        for (const k of Object.keys(placed)) delete placed[k];
        savePlaced();
        framed = false;
        laidOutFor = -1;
        fitAfterLayout = 'ease';
      },
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const hit = pick(e);
      if (hit?.kind === 'part' && hit.part.wheel && !e.ctrlKey) {
        hit.part.wheel(hit.object, e.deltaY); // scrolling over the encoder turns it
        return;
      }
      // Wheel or trackpad pinch (which arrives as ctrl + wheel): zoom towards the cursor.
      const r = el.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
      // A mouse notch reports 100–240 px depending on the browser and screen density; a trackpad
      // pinch reports many small steps. Cap each event so a notch is a gentle ~13% either way.
      const delta = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      zoomAt(nx, ny, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0012)));
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault(); // right-drag pans
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);

    let raf = 0;
    let first = true;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      paint();
    };
    const paint = () => {
      try {
        draw();
      } catch (e) {
        cancelAnimationFrame(raf);
        setBroken(e ?? new Error('the 3D view stopped'));
      }
    };
    const draw = () => {
      const quarter = ((mountRef.current() % 4) + 4) % 4;
      if (quarter !== laidOutFor) {
        laidOutFor = quarter;
        layout(quarter);
      }

      run.display.panel.render(clock.now(), image.data);
      if (leds) drawLeds(nctx, device, image.data, 0, 0, native.width, native.height);
      else nctx.putImageData(image, 0, 0);
      model.texture.needsUpdate = true;

      // Buttons on the device follow their inputs (mouse or keyboard).
      for (const b of model.buttons) {
        const down = !!inputFor(b)?.isPressed();
        b.mesh.position.copy(b.rest).addScaledVector(b.normal, down ? -PRESS_MM : 0);
        (b.mesh.material as THREE.MeshBasicMaterial).color.copy(b.color).multiplyScalar(down ? 1.25 : 1);
      }
      for (const p of parts) p.update();

      // The IMU tilts the device: right on the tilt pad lowers its right edge, down lowers the bottom.
      if (imu) {
        const t = imu.getTilt();
        const tx = Math.asin(Math.max(-1, Math.min(1, t.x))) * 0.75;
        const ty = Math.asin(Math.max(-1, Math.min(1, t.y))) * 0.75;
        tiltGroup.rotation.y += (tx - tiltGroup.rotation.y) * 0.25;
        tiltGroup.rotation.x += (ty - tiltGroup.rotation.x) * 0.25;
        const s = imu.isShaking() ? 1.8 : 0;
        const k = performance.now() / 1000;
        tiltGroup.position.set(Math.sin(k * 57) * s, Math.sin(k * 43 + 1) * s * 0.6, 0);
      }

      orbit.yaw += (orbit.tYaw - orbit.yaw) * 0.18;
      orbit.pitch += (orbit.tPitch - orbit.pitch) * 0.18;
      pivot.rotation.set(base.pitch + orbit.pitch, base.yaw + orbit.yaw, 0, 'YXZ');
      if (fitAfterLayout && laidOutFor === quarter) {
        fitAll(fitAfterLayout === 'ease');
        fitAfterLayout = null;
      }
      if (goal) {
        // Ease zoom in log space so zooming in and out feel alike.
        const k = 0.18;
        orbit.zoom = Math.exp(Math.log(orbit.zoom) + (Math.log(goal.zoom) - Math.log(orbit.zoom)) * k);
        orbit.panX += (goal.panX - orbit.panX) * k;
        orbit.panY += (goal.panY - orbit.panY) * k;
        const near = Math.abs(Math.log(goal.zoom / orbit.zoom)) < 0.002 && Math.hypot(goal.panX - orbit.panX, goal.panY - orbit.panY) < 0.05;
        if (near) {
          Object.assign(orbit, goal);
          goal = null;
        }
        placeCamera();
      }
      const target = (-quarter * Math.PI) / 2;
      let diff = target - mountGroup.rotation.z;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // turn the short way
      mountGroup.rotation.z += first ? diff : diff * 0.2;
      first = false;
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey);
      toolsRef.current = null;
      onUp();
      model.dispose();
      deviceHandle.geometry.dispose();
      desk.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.MeshBasicMaterial).map?.dispose();
        }
      });
      wires.traverse((o) => o instanceof THREE.Line && o.geometry.dispose());
      renderer.dispose();
      renderer.forceContextLoss(); // dispose() keeps the WebGL context; browsers cap how many stay alive
      el.remove();
      onCanvas?.(null);
    };
  }, [run, clock, onCanvas, benchVersion, board?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={hostRef} className="device-3d">
      <div className="view-tools" role="toolbar" aria-label="View">
        <button onClick={() => toolsRef.current?.zoomBy(1.3)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button onClick={() => toolsRef.current?.zoomBy(1 / 1.3)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button onClick={() => toolsRef.current?.fitAll()} title="Fit everything in view (F)">
          Fit all
        </button>
        <button
          onClick={() => toolsRef.current?.tidy()}
          disabled={!movedByHand}
          title={movedByHand ? 'Tidy: put every part back in an automatic layout that suits the stage, then fit' : 'Nothing has been moved by hand'}
        >
          Tidy
        </button>
      </div>
    </div>
  );
}
