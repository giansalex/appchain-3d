import * as THREE from 'three';
import { NOISE_GLSL, Ship, dotTexture, ease, hash01, makeLabel, srgbVec } from './util';
import type { Planet } from './types';

const HUB_R = 9.5;
const PLANET_R = 7.5;
const RING_R = 54;
const MAX_SHIPS = 14;

// Home view: the included Cosmos chains as planets. The hub sits at the centre,
// the other chains ring it. IBC transfers between them fly as ships; click a planet to enter it.
export interface PlanetBody {
  chain: Planet;
  pos: THREE.Vector3;
  r: number;
  body: THREE.Mesh;
  uniforms: { uPulse: { value: number } };
  kick: number;
  spin: number;
}

export class Space {
  readonly scene = new THREE.Scene();
  readonly pickables: THREE.Object3D[] = [];
  private planets = new Map<string, PlanetBody>();
  private hover: string | null = null;
  private time = { value: 0 };
  private ships: Ship[] = [];
  private stars!: THREE.Points;

  constructor(chains: Planet[]) {
    this.buildStars();
    const ring = chains.filter((c) => !c.hub);
    chains.forEach((c) => {
      if (c.hub) return this.addPlanet(c, new THREE.Vector3(0, 0, 0), HUB_R);
      const i = ring.indexOf(c);
      const a = (i / ring.length) * Math.PI * 2 + 0.6;
      return this.addPlanet(c, new THREE.Vector3(Math.cos(a) * RING_R, (i % 2 ? -1 : 1) * 7, Math.sin(a) * RING_R), PLANET_R);
    });
    this.buildLinks();
  }

  private buildStars(): void {
    const n = 5000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(500 + Math.random() * 700);
      pos.set([v.x, v.y, v.z], i * 3);
      const c = new THREE.Color().setHSL(Math.random() < 0.25 ? 0.01 : 0.6, 0.6, 0.55 + Math.random() * 0.4);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 3.2, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(this.stars);

    // Soft nebula backdrop
    const neb = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `${NOISE_GLSL}
        varying vec3 vP;
        void main(){
          float n = fbm(vP*2.2) * 0.5 + 0.5;
          float m = fbm(vP*4.0 + 7.0) * 0.5 + 0.5;
          vec3 c = mix(vec3(0.03,0.03,0.075), vec3(0.17,0.08,0.2), smoothstep(0.5,0.85,n));
          c += vec3(0.05,0.07,0.2) * smoothstep(0.55,0.9,m);
          gl_FragColor = vec4(pow(c, vec3(2.2)),1.0); // authored in display space
        }`,
    }));
    this.scene.add(neb);
  }

  private addPlanet(chain: Planet, pos: THREE.Vector3, r: number): void {
    const uniforms = {
      uTime: this.time, uPulse: { value: 0 }, uColor: { value: srgbVec(chain.color) },
      uSeed: { value: hash01(chain.key) * 40 }, uLight: { value: new THREE.Vector3(0.7, 0.35, 0.6).normalize() },
    };
    const group = new THREE.Group();
    group.position.copy(pos);
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 96, 96), new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `varying vec3 vObj; varying vec3 vN; varying vec3 vView;
        void main(){ vObj = normalize(position); vN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0); vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `${NOISE_GLSL}
        uniform float uTime; uniform float uPulse; uniform float uSeed; uniform vec3 uLight; uniform vec3 uColor;
        varying vec3 vObj; varying vec3 vN; varying vec3 vView;
        void main(){
          vec3 p = vObj*2.2 + uSeed;
          float land = fbm(p + 3.0);
          float mask = smoothstep(-0.02, 0.12, land);
          // glowing "network" veins: ridged noise
          float ridge = 1.0 - abs(fbm(p*2.6 + vec3(0.0, uTime*0.02, 0.0)))*5.0;
          float veins = smoothstep(0.55, 1.0, ridge) * mask;
          float cities = smoothstep(0.35, 0.6, noise(p*14.0)) * mask;
          float day = clamp(dot(vN, uLight)*0.8 + 0.35, 0.0, 1.0);
          vec3 ocean = uColor*0.07 + vec3(0.015,0.012,0.05);
          vec3 ground = uColor*0.3 + vec3(0.03,0.0,0.03);
          vec3 base = mix(ocean, ground, mask) * (0.25 + day);
          float flow = 0.6 + 0.4*sin(uTime*1.5 + land*30.0);
          vec3 glow = uColor * (veins*(0.9*flow + uPulse*1.2) + cities*0.25*(1.2-day));
          float fres = pow(1.0 - max(dot(vN, vView), 0.0), 2.6);
          vec3 c = base + glow + uColor*fres*(0.55 + uPulse*0.6);
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        }`,
    }));
    body.userData = { type: 'planet', chain };
    this.pickables.push(body);

    const atmo = new THREE.Mesh(new THREE.SphereGeometry(r * 1.22, 64, 64), new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vView;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.0);
          vView = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `uniform float uPulse; uniform vec3 uColor; varying vec3 vN; varying vec3 vView;
        void main(){ float f = pow(max(dot(-vN, vView), 0.0), 3.2);
          gl_FragColor = vec4(pow(uColor, vec3(2.2))*f*(0.9+uPulse*1.2), f); }`,
    }));

    const tint = `#${new THREE.Color(chain.color).lerp(new THREE.Color('#ffffff'), 0.7).getHexString()}`;
    const label = makeLabel(chain.name.toUpperCase(), { height: 2.4, color: tint, weight: 700 });
    label.position.set(0, r + 3.6, 0);
    const sub = makeLabel(chain.chainId, { height: 1.3, color: '#b9bfe0', opacity: 0.8 });
    sub.position.set(0, r + 1.5, 0);
    group.add(body, atmo, label, sub);
    this.scene.add(group);
    this.planets.set(chain.key, { chain, pos, r, body, uniforms, kick: 0, spin: 0.025 + hash01(chain.key, 3) * 0.03 });
  }

  // Faint IBC lanes: every chain here has open channels to every other.
  private buildLinks(): void {
    const pts: THREE.Vector3[] = [];
    const all = [...this.planets.values()];
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => pts.push(a.pos, b.pos)));
    this.scene.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: '#8b93ff', transparent: true, opacity: 0.13, depthWrite: false, blending: THREE.AdditiveBlending }),
    ));
  }

  // An IBC transfer: a ship leaves one planet, arcs over the lane and lands on the other.
  launchTransfer(fromKey: string, toKey: string, { label = '' } = {}): boolean {
    const a = this.planets.get(fromKey), b = this.planets.get(toKey);
    if (!a || !b || a === b || this.ships.length >= MAX_SHIPS) return false;
    const dir = b.pos.clone().sub(a.pos);
    const dist = dir.length();
    dir.normalize();
    // Bow each flight off the straight lane (mostly upward, a little sideways) so ships don't stack.
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const bow = new THREE.Vector3(0, 1, 0).multiplyScalar(dist * (0.14 + Math.random() * 0.1))
      .addScaledVector(side, dist * (Math.random() - 0.5) * 0.22);
    const mid = a.pos.clone().lerp(b.pos, 0.5).add(bow);
    const start = a.pos.clone().addScaledVector(mid.clone().sub(a.pos).normalize(), a.r * 1.05);
    const end = b.pos.clone().addScaledVector(mid.clone().sub(b.pos).normalize(), b.r * 1.05);
    a.kick = Math.max(a.kick, 0.5);
    this.ships.push(new Ship(this.scene, new THREE.QuadraticBezierCurve3(start, mid, end), {
      color: a.chain.color, dur: 3.6 + dist / 22, size: 1.2, label, easing: ease.inOut,
      onDone: () => { b.kick = 1; },
    }));
    return true;
  }

  clearShips(): void {
    this.ships.forEach((s) => s.dispose());
    this.ships = [];
  }

  planet(key: string): PlanetBody | undefined { return this.planets.get(key); }
  setHover(key: string | null): void { this.hover = key; }

  update(dt: number, t: number): void {
    this.time.value = t;
    this.stars.rotation.y += dt * 0.002;
    for (const [key, p] of this.planets) {
      p.body.rotation.y += dt * p.spin;
      const u = p.uniforms.uPulse;
      p.kick = Math.max(0, p.kick - dt * 0.9);
      u.value += (Math.max(key === this.hover ? 0.7 : 0, p.kick) - u.value) * Math.min(1, dt * 6);
    }
    this.ships = this.ships.filter((s) => s.update(dt));
  }
}
