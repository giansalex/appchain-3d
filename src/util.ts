import * as THREE from 'three';

// '#rrggbb' → raw sRGB components, for shaders that author colour in display space.
export function srgbVec(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ---------- text sprites ----------
export interface LabelOpts { color?: string; height?: number; weight?: number; bg?: string | null; opacity?: number }
export function makeLabel(text: string, { color = '#ffffff', height = 2, weight = 600, bg = null, opacity = 1 }: LabelOpts = {}): THREE.Sprite {
  const fs = 56;
  const font = `${weight} ${fs}px "Space Grotesk", "Inter", system-ui, sans-serif`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = font;
  const pad = bg ? 28 : 8;
  c.width = Math.min(2048, Math.ceil(g.measureText(text).width) + pad * 2);
  c.height = fs + pad * 2;
  g.font = font;
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(0, 0, c.width, c.height, 24);
    g.fill();
  }
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // tinted just below the bloom threshold so text stays sharp
  const mat = new THREE.SpriteMaterial({ map: tex, color: '#bdbdbd', transparent: true, depthWrite: false, opacity });
  const s = new THREE.Sprite(mat);
  s.scale.set((height * c.width) / c.height, height, 1);
  s.userData.dispose = () => { tex.dispose(); mat.dispose(); };
  return s;
}

let _dot: THREE.CanvasTexture | undefined;
export function dotTexture(): THREE.CanvasTexture {
  if (_dot) return _dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}

// ---------- tweens ----------
export type Easing = (t: number) => number;
export interface Tween { t: number; dur: number; easing: Easing; update?: (k: number) => void; done?: () => void; dead: boolean }
export interface TweenOpts { dur?: number; delay?: number; easing?: Easing; update?: (k: number) => void; done?: () => void }

const tweens: Tween[] = [];
export const ease = {
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  linear: (t: number) => t,
};
export function tween({ dur = 1, delay = 0, easing = ease.inOut, update, done }: TweenOpts): Tween {
  const tw: Tween = { t: -delay, dur, easing, update, done, dead: false };
  tweens.push(tw);
  return tw;
}
export function stepTweens(dt: number): void {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (tw.dead) { tweens.splice(i, 1); continue; }
    tw.t += dt;
    if (tw.t < 0) continue;
    const k = Math.min(1, tw.t / tw.dur);
    tw.update?.(tw.easing(k));
    if (k >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
}

export function hash01(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// A particle pool: glowing points that fly from A to B along a soft arc.
interface Flyer { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; arc: number; onArrive?: () => void }
export interface FlyerOpts { dur?: number; delay?: number; arc?: number; onArrive?: () => void }

export class Flyers {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private items: (Flyer | null)[];
  private pos: Float32Array;
  private col: Float32Array;
  private cursor = 0;

  constructor(private max = 600, size = 2.2) {
    this.items = new Array<Flyer | null>(max).fill(null);
    this.pos = new Float32Array(max * 3).fill(1e5);
    this.col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, { dur = 0.9, delay = 0, arc = 0, onArrive }: FlyerOpts = {}): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const c = new THREE.Color(color);
    this.col.set([c.r, c.g, c.b], i * 3);
    this.items[i] = { from: from.clone(), to: to.clone(), t: -delay, dur, arc, onArrive };
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const f = this.items[i];
      if (!f) continue;
      f.t += dt;
      if (f.t < 0) continue;
      const k = Math.min(1, f.t / f.dur);
      const e = k * k;
      const x = f.from.x + (f.to.x - f.from.x) * e;
      const y = f.from.y + (f.to.y - f.from.y) * e + Math.sin(k * Math.PI) * f.arc;
      const z = f.from.z + (f.to.z - f.from.z) * e;
      this.pos.set([x, y, z], i * 3);
      if (k >= 1) {
        this.pos.set([1e5, 1e5, 1e5], i * 3);
        this.items[i] = null;
        f.onArrive?.();
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// A glowing ship with a fading trail that follows a curve (used for IBC packets).
export interface ShipOpts { color?: string; dur?: number; size?: number; label?: string; easing?: Easing; onDone?: (p: THREE.Vector3) => void }

export class Ship {
  private dur: number;
  private t = 0;
  private easing: Easing;
  private onDone?: (p: THREE.Vector3) => void;
  private group = new THREE.Group();
  private head: THREE.Mesh;
  private trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private label?: THREE.Sprite;
  private N = 28;

  constructor(private scene: THREE.Scene, private curve: THREE.Curve<THREE.Vector3>,
    { color = '#5eead4', dur = 5, size = 1, label = '', easing = ease.in, onDone }: ShipOpts = {}) {
    this.dur = dur;
    this.easing = easing;
    this.onDone = onDone;
    const col = new THREE.Color(color);
    this.head = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7 * size, 0),
      new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color('#ffffff'), 0.5) }),
    );
    this.head.scale.set(0.7, 0.7, 2.2);
    this.group.add(this.head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture(), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.setScalar(5 * size);
    this.head.add(glow);

    const pos = new Float32Array(this.N * 3);
    const cols = new Float32Array(this.N * 3);
    for (let i = 0; i < this.N; i++) {
      const f = 1 - i / this.N;
      cols.set([col.r * f, col.g * f, col.b * f], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.trail.frustumCulled = false;
    this.group.add(this.trail);
    const p0 = curve.getPoint(0);
    for (let i = 0; i < this.N; i++) pos.set([p0.x, p0.y, p0.z], i * 3);
    if (label) {
      this.label = makeLabel(label, { height: 1.6 * size, bg: 'rgba(8,10,20,0.8)', color: '#ffffff' });
      this.group.add(this.label);
    }
    scene.add(this.group);
  }

  /** Advance the flight; returns false once the ship has arrived and removed itself. */
  update(dt: number): boolean {
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    const e = this.easing(k);
    const p = this.curve.getPoint(e);
    this.head.position.copy(p);
    this.head.lookAt(this.curve.getPoint(Math.min(1, e + 0.01)));
    const arr = this.trail.geometry.attributes.position.array;
    arr.copyWithin(3, 0, (this.N - 1) * 3);
    arr.set([p.x, p.y, p.z], 0);
    this.trail.geometry.attributes.position.needsUpdate = true;
    if (this.label) this.label.position.copy(p).add(new THREE.Vector3(0, this.label.scale.y * 1.6, 0));
    if (k >= 1) { this.dispose(); this.onDone?.(p); return false; }
    return true;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.trail.geometry.dispose();
    this.trail.material.dispose();
    this.head.geometry.dispose();
    (this.head.material as THREE.Material).dispose();
    this.label?.userData.dispose();
  }
}

export const NOISE_GLSL = /* glsl */`
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
float noise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); vec3 u=f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
`;
