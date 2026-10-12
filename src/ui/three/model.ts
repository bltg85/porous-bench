// Builds the "ghosted" wireframe model of a device from its profile's enclosure: every hard edge
// as a thin translucent line, the live screen as a textured plane, buttons as solid caps you can
// press. Units are millimetres; +z points out of the screen.

import * as THREE from 'three';
import type { DeviceProfile, Enclosure, EnclosurePart, Face } from '../../sim/devices/types';
import { LED_PACKAGE_MM } from '../../sim/leds';

export const GHOST = new THREE.LineBasicMaterial({ color: 0x1b4b7a, transparent: true, opacity: 0.72, depthWrite: false });
const GHOST_DIM = new THREE.LineBasicMaterial({ color: 0x1b4b7a, transparent: true, opacity: 0.3, depthWrite: false });

export interface ModelButton {
  mesh: THREE.Mesh;
  input?: number;
  label: string;
  color: THREE.Color;
  rest: THREE.Vector3;
  normal: THREE.Vector3;
}

export interface BuiltModel {
  group: THREE.Group;
  screen: THREE.Mesh;
  texture: THREE.CanvasTexture;
  buttons: ModelButton[];
  radius: number;
  dispose(): void;
}

/** A square whose corner radius reaches its middle is a circle (round glass, a round board). */
function isCircle(w: number, h: number, r: number): boolean {
  return Math.abs(w - h) < 0.01 && r >= w / 2 - 0.01;
}

/** Enough segments that a circle's facets fall under the edge threshold: clean rims, no polygon. */
const CIRCLE_SEGMENTS = 72;

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  // Quadratic corners only approximate a quarter circle: a full circle needs a true arc.
  if (isCircle(w, h, r)) return new THREE.Shape().absarc(0, 0, w / 2, 0, Math.PI * 2, false);
  r = Math.max(0.001, Math.min(r, w / 2, h / 2));
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A rounded slab of w×h×d centred on the origin, as edge lines. `bevel` softens the rim like a moulded case. */
function slab(w: number, h: number, d: number, r: number, bevel: number, material = GHOST): THREE.LineSegments {
  const b = Math.min(bevel, d / 2 - 0.01, w / 4, h / 4);
  const geo = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, h - 2 * b, Math.max(0.1, r - b)), {
    depth: Math.max(0.01, d - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: b > 0 ? 3 : 0,
    curveSegments: isCircle(w, h, r) ? CIRCLE_SEGMENTS : 4,
  });
  geo.translate(0, 0, -(d - 2 * b) / 2);
  // A low threshold keeps each facet of the rounded corners: the striated, hand-drawn look.
  const edges = new THREE.EdgesGeometry(geo, 8);
  geo.dispose();
  return new THREE.LineSegments(edges, material);
}

/** A disc with a round hole through it (a NeoPixel ring's board): true circles, so only its rims draw. */
function annulusShape(r: number, hole: number): THREE.Shape {
  const s = new THREE.Shape().absarc(0, 0, r, 0, Math.PI * 2, false);
  s.holes.push(new THREE.Path().absarc(0, 0, hole, 0, Math.PI * 2, true));
  return s;
}

function annulus(r: number, hole: number, d: number, material = GHOST): THREE.LineSegments {
  const geo = new THREE.ExtrudeGeometry(annulusShape(r, hole), { depth: d, bevelEnabled: false, curveSegments: CIRCLE_SEGMENTS });
  geo.translate(0, 0, -d / 2);
  const edges = new THREE.EdgesGeometry(geo, 8);
  geo.dispose();
  return new THREE.LineSegments(edges, material);
}

function circle(r: number, material = GHOST): THREE.LineLoop {
  const pts = new THREE.EllipseCurve(0, 0, r, r).getPoints(96);
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
}

function outline(w: number, h: number, r: number, material = GHOST): THREE.LineLoop {
  if (isCircle(w, h, r)) return circle(w / 2, material);
  const pts = roundedRect(w, h, r).getPoints(10);
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
}

/** Position and orient a flat object (its +z = outward normal) on a face of the body. */
function onFace(obj: THREE.Object3D, face: Face, u: number, v: number, body: Enclosure['body'], lift: number) {
  const { w, h, d } = body;
  switch (face) {
    case 'front':
      obj.position.set(u, v, d / 2 + lift);
      break;
    case 'back':
      obj.position.set(-u, v, -d / 2 - lift);
      obj.rotation.y = Math.PI;
      break;
    case 'right':
      obj.position.set(w / 2 + lift, v, u);
      obj.rotation.y = Math.PI / 2;
      break;
    case 'left':
      obj.position.set(-w / 2 - lift, v, u);
      obj.rotation.y = -Math.PI / 2;
      break;
    case 'top':
      obj.position.set(u, h / 2 + lift, v);
      obj.rotation.x = -Math.PI / 2;
      break;
    case 'bottom':
      obj.position.set(u, -h / 2 - lift, v);
      obj.rotation.x = Math.PI / 2;
      break;
  }
}

function faceNormal(face: Face): THREE.Vector3 {
  return {
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    left: new THREE.Vector3(-1, 0, 0),
    top: new THREE.Vector3(0, 1, 0),
    bottom: new THREE.Vector3(0, -1, 0),
  }[face];
}

/** A plain enclosure for profiles that don't describe one: the glass plus a thin frame. */
function fallbackEnclosure(p: DeviceProfile): Enclosure {
  const w = p.look.activeWidthMm || p.width / 6;
  const h = p.look.activeHeightMm || p.height / 6;
  return { style: 'pcb', body: { w: w + 6, h: h + 6, d: 1.6, r: 1.5 }, module: { w: w + 3, h: h + 3, d: 1.6, r: 1, x: 0, y: 0 }, screen: { x: 0, y: 0 } };
}

export function buildModel(profile: DeviceProfile, screenCanvas: HTMLCanvasElement): BuiltModel {
  const enc = profile.enclosure ?? fallbackEnclosure(profile);
  const { body } = enc;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // Body
  if (enc.style === 'case') {
    // Front and back outlines joined by the corner facets, plus an inset lip on the front face.
    group.add(slab(body.w, body.h, body.d, body.r, 0));
    const lip = outline(body.w - 3, body.h - 3, Math.max(0.5, body.r - 1.5));
    lip.position.z = body.d / 2 + 0.02;
    group.add(lip);
  } else if (body.hole) {
    group.add(annulus(body.w / 2, body.hole, body.d));
  } else {
    group.add(slab(body.w, body.h, body.d, body.r, 0));
  }

  // Display module on a bare board
  let frontZ = body.d / 2;
  if (enc.module) {
    const m = enc.module;
    const mod = slab(m.w, m.h, m.d, m.r, 0);
    mod.position.set(m.x, m.y, body.d / 2 + m.d / 2);
    group.add(mod);
    frontZ = body.d / 2 + m.d;
  }

  // Screen: rounded like the glass, textured with the live panel
  const sw = profile.look.activeWidthMm || profile.width / 6;
  const sh = profile.look.activeHeightMm || profile.height / 6;
  const radiusMm = ((profile.look.cornerRadiusPx ?? 0) * sw) / profile.width;
  // A ring's face has the board's hole in it: the desk shows through.
  const screenShape = body.hole ? annulusShape(sw / 2, body.hole) : roundedRect(sw, sh, radiusMm);
  const screenGeo = track(new THREE.ShapeGeometry(screenShape, body.hole || isCircle(sw, sh, radiusMm) ? CIRCLE_SEGMENTS : 12));
  const pos = screenGeo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + sw / 2) / sw;
    uv[i * 2 + 1] = (pos.getY(i) + sh / 2) / sh;
  }
  screenGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const texture = track(new THREE.CanvasTexture(screenCanvas));
  texture.magFilter = profile.tech === 'led' ? THREE.LinearFilter : THREE.NearestFilter; // LED glow is painted smooth
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(screenGeo, track(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })));
  screen.position.set(enc.screen.x, enc.screen.y, frontZ + 0.05);
  group.add(screen);
  if (!body.hole) {
    const rim = outline(sw + 0.6, sh + 0.6, radiusMm + 0.3, GHOST_DIM);
    rim.position.copy(screen.position);
    group.add(rim);
  }

  // A ring's LEDs as 5050 packages on the board, each over its light in the texture.
  const leds = profile.look.leds;
  if (leds?.layout === 'ring' && leds.radiusMm) {
    const n = profile.width;
    const h = 1.6;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2; // LED 0 at the top, clockwise (as drawLeds)
      const pkg = new THREE.Group();
      const box = slab(LED_PACKAGE_MM, LED_PACKAGE_MM, h, 0.3, 0, GHOST_DIM);
      box.position.z = h / 2;
      pkg.add(box);
      const window = circle(LED_PACKAGE_MM * 0.36, GHOST_DIM);
      window.position.z = h + 0.01;
      pkg.add(window);
      pkg.position.set(enc.screen.x + Math.cos(a) * leds.radiusMm, enc.screen.y - Math.sin(a) * leds.radiusMm, frontZ + 0.05);
      pkg.rotation.z = -a;
      group.add(pkg);
    }
  }

  // Parts
  const buttons: ModelButton[] = [];
  for (const part of enc.parts ?? []) addPart(part);

  function addPart(part: EnclosurePart) {
    switch (part.kind) {
      case 'button': {
        const depth = 1.2;
        const geo = track(
          new THREE.ExtrudeGeometry(roundedRect(part.w, part.h, Math.min(part.w, part.h) / 2), {
            depth,
            bevelEnabled: false,
            curveSegments: 12,
          }),
        );
        geo.translate(0, 0, -depth / 2);
        const color = new THREE.Color(part.color ?? '#d6dbe6');
        const mesh = new THREE.Mesh(geo, track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 })));
        mesh.add(new THREE.LineSegments(track(new THREE.EdgesGeometry(geo, 30)), GHOST));
        onFace(mesh, part.face, part.u, part.v, body, depth / 2 - 0.2 + (part.z ?? 0));
        group.add(mesh);
        buttons.push({ mesh, input: part.input, label: part.label ?? 'button', color, rest: mesh.position.clone(), normal: faceNormal(part.face) });
        break;
      }
      case 'port': {
        const o = new THREE.Group();
        o.add(outline(part.w, part.h, part.h / 2));
        o.add(outline(part.w - 1.6, part.h - 1.4, (part.h - 1.4) / 2, GHOST_DIM));
        onFace(o, part.face, part.u, part.v, body, 0.02);
        group.add(o);
        break;
      }
      case 'header': {
        const o = new THREE.Group();
        const pitch = 2.54;
        const len = part.pins * pitch;
        const base = slab(part.along === 'u' ? len : 2.5, part.along === 'u' ? 2.5 : len, 2.5, 0.2, 0, GHOST_DIM);
        base.position.z = 1.25;
        o.add(base);
        for (let i = 0; i < part.pins; i++) {
          const off = -len / 2 + pitch / 2 + i * pitch;
          const pin = slab(0.64, 0.64, 6, 0.05, 0);
          pin.position.set(part.along === 'u' ? off : 0, part.along === 'u' ? 0 : off, 3);
          o.add(pin);
        }
        onFace(o, part.face, part.u, part.v, body, 0);
        group.add(o);
        break;
      }
      case 'hole': {
        const pts = new THREE.EllipseCurve(0, 0, part.r, part.r).getPoints(24);
        const ring = new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(pts)), GHOST);
        onFace(ring, part.face, part.u, part.v, body, 0.02);
        group.add(ring);
        break;
      }
      case 'block': {
        const o = slab(part.w, part.h, part.d, part.r ?? 0.3, 0, (part.z ?? 0) > 0 ? GHOST : GHOST_DIM);
        onFace(o, part.face, part.u, part.v, body, (part.z ?? 0) + part.d / 2);
        group.add(o);
        break;
      }
      case 'led': {
        const geo = track(new THREE.CircleGeometry(part.r, 20));
        const led = new THREE.Mesh(geo, track(new THREE.MeshBasicMaterial({ color: part.color, transparent: true, opacity: 0.85 })));
        onFace(led, part.face, part.u, part.v, body, 0.03);
        group.add(led);
        break;
      }
    }
  }

  // As deep as the module in front or whatever stands furthest off a face (a board plugged in behind).
  const reach = Math.max(enc.module?.d ?? 0, ...(enc.parts ?? []).map((p) => (p.kind === 'block' ? (p.z ?? 0) + p.d : 0)));
  const radius = 0.5 * Math.hypot(body.w, body.h, body.d + reach * 2);
  return {
    group,
    screen,
    texture,
    buttons,
    radius,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.LineSegments || o instanceof THREE.LineLoop) o.geometry.dispose();
      });
      disposables.forEach((d) => d.dispose());
    },
  };
}
