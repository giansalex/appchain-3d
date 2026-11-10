import * as THREE from 'three';
import { CORAL, NOISE_GLSL, Ship, dotTexture, ease, hash01, makeLabel, tween } from './util.js';
import { CHAINS, chainInfo } from './data.js';

export const PLANET_R = 10;

// Exterior view: Juno as a living planet among its IBC neighbours.
export class Space {
  constructor() {
    this.scene = new THREE.Scene();
    this.pickables = [];
    this.ships = [];
    this.neighbors = new Map();
    this.pulse = 0;
    this.buildStars();
    this.buildPlanet();
    this.buildSatellites(25);
    Object.keys(CHAINS).slice(0, 6).forEach((id) => this.getNeighbor(id));
  }

  buildStars() {
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
          vec3 c = mix(vec3(0.035,0.03,0.07), vec3(0.24,0.08,0.14), smoothstep(0.5,0.85,n));
          c += vec3(0.05,0.07,0.2) * smoothstep(0.55,0.9,m);
          gl_FragColor = vec4(pow(c, vec3(2.2)),1.0); // authored in display space
        }`,
    }));
    this.scene.add(neb);
  }

  buildPlanet() {
    this.uniforms = { uTime: { value: 0 }, uPulse: { value: 0 }, uLight: { value: new THREE.Vector3(0.7, 0.35, 0.6).normalize() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `varying vec3 vObj; varying vec3 vN; varying vec3 vView;
        void main(){ vObj = normalize(position); vN = normalize(mat3(modelMatrix)*normal);
          vec4 wp = modelMatrix*vec4(position,1.0); vView = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `${NOISE_GLSL}
        uniform float uTime; uniform float uPulse; uniform vec3 uLight;
        varying vec3 vObj; varying vec3 vN; varying vec3 vView;
        void main(){
          vec3 p = vObj*2.2;
          float land = fbm(p + 3.0);
          float mask = smoothstep(-0.02, 0.12, land);
          // glowing "network" veins: ridged noise
          float ridge = 1.0 - abs(fbm(p*2.6 + vec3(0.0, uTime*0.02, 0.0)))*5.0;
          float veins = smoothstep(0.55, 1.0, ridge) * mask;
          float cities = smoothstep(0.35, 0.6, noise(p*14.0)) * mask;
          float day = clamp(dot(vN, uLight)*0.8 + 0.35, 0.0, 1.0);
          vec3 ocean = vec3(0.07,0.04,0.12);
          vec3 ground = vec3(0.32,0.12,0.17);
          vec3 base = mix(ocean, ground, mask) * (0.25 + day);
          vec3 coral = vec3(0.94,0.51,0.49);
          float flow = 0.6 + 0.4*sin(uTime*1.5 + land*30.0);
          vec3 glow = coral * (veins*(0.9*flow + uPulse*1.6) + cities*0.25*(1.2-day));
          float fres = pow(1.0 - max(dot(vN, vView), 0.0), 2.6);
          vec3 c = base + glow + coral*fres*(0.55 + uPulse*0.6);
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        }`,
    });
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 96, 96), mat);
    this.planet.userData = { type: 'planet' };
    this.scene.add(this.planet);
    this.pickables.push(this.planet);

    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R * 1.22, 64, 64), new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vView;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.0);
          vView = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: `uniform float uPulse; varying vec3 vN; varying vec3 vView;
        void main(){ float f = pow(max(dot(-vN, vView), 0.0), 3.2);
          gl_FragColor = vec4(pow(vec3(0.94,0.51,0.49), vec3(2.2))*f*(0.9+uPulse*1.2), f); }`,
    }));
    this.scene.add(this.atmo);

    // Block shockwave ring
    this.wave = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 128),
      new THREE.MeshBasicMaterial({ color: CORAL, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.wave.rotation.x = Math.PI / 2 - 0.35;
    this.scene.add(this.wave);

    this.label = makeLabel('JUNO', { height: 2.2, color: '#ffd9d6', weight: 700 });
    this.label.position.set(0, PLANET_R + 4.2, 0);
    this.scene.add(this.label);
  }

  buildSatellites(n) {
    if (this.sats) { this.scene.remove(this.sats); this.sats.geometry.dispose(); }
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = PLANET_R * 1.55 + (i % 3) * 0.5;
      pos.set([Math.cos(a) * r, Math.sin(a * 3) * 0.3, Math.sin(a) * r], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sats = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.75, map: dotTexture(), color: '#ffe3e0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sats.rotation.x = -0.35;
    this.scene.add(this.sats);
  }

  setValidators(list) { this.buildSatellites(list.length); }

  getNeighbor(chainId) {
    if (this.neighbors.has(chainId)) return this.neighbors.get(chainId);
    const info = chainInfo(chainId);
    const i = this.neighbors.size;
    // Spread neighbours on a wide ring with hashed elevation so each chain has a stable home.
    const a = hash01(chainId) * 0.6 + i * 2.39996;
    const r = 58 + hash01(chainId, 7) * 30;
    const pos = new THREE.Vector3(Math.cos(a) * r, (hash01(chainId, 3) - 0.5) * 36, Math.sin(a) * r);
    const size = 1.6 + hash01(chainId, 11) * 1.6;
    const g = new THREE.Group();
    g.position.copy(pos);
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(size, 32, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(info.color).multiplyScalar(0.3) }),
    );
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture(), color: info.color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(size * 5);
    const label = makeLabel(info.name, { height: 1.7, color: '#dbe1ff' });
    label.position.y = size + 2.2;
    g.add(body, halo, label);
    this.scene.add(g);
    const nb = { pos, size, info, group: g, halo };
    this.neighbors.set(chainId, nb);
    return nb;
  }

  onBlock() {
    this.pulse = 1;
    this.wave.scale.setScalar(PLANET_R * 1.02);
    this.wave.material.opacity = 0.9;
    tween({
      dur: 1.6, easing: ease.out,
      update: (k) => { this.wave.scale.setScalar(PLANET_R * (1.02 + k * 1.3)); this.wave.material.opacity = 0.9 * (1 - k); },
    });
  }

  onIbc(ibc, { replay = false } = {}) {
    const nb = this.getNeighbor(ibc.chainId);
    const dir = nb.pos.clone().normalize();
    const surface = dir.clone().multiplyScalar(PLANET_R * 1.02);
    const mid = surface.clone().lerp(nb.pos, 0.5).add(new THREE.Vector3(0, 10, 0));
    const pts = ibc.dir === 'out' ? [surface, mid, nb.pos] : [nb.pos, mid, surface];
    const label = `${ibc.dir === 'out' ? '→' : '←'} ${ibc.chainName}${ibc.amount ? ' · ' + ibc.amount : ''}${replay ? ' · replay' : ''}`;
    this.ships.push(new Ship(this.scene, new THREE.QuadraticBezierCurve3(...pts), {
      color: ibc.color, dur: 6, size: 0.8, label, easing: ease.inOut,
      onDone: () => {
        tween({ dur: 1.2, update: (k) => { nb.halo.material.opacity = 0.9 - 0.6 * k; } });
      },
    }));
  }

  update(dt, t) {
    this.uniforms.uTime.value = t;
    this.pulse = Math.max(0, this.pulse - dt * 1.3);
    this.uniforms.uPulse.value = this.pulse;
    this.planet.rotation.y += dt * 0.035;
    this.sats.rotation.y -= dt * 0.12;
    this.stars.rotation.y += dt * 0.002;
    this.ships = this.ships.filter((s) => s.update(dt));
  }
}
