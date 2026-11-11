import * as THREE from 'three';
import { Flyers, NOISE_GLSL, Ship, dotTexture, ease, hash01, makeLabel, srgbVec, tween } from './util';
import { KINDS } from './data';
import type { Block, IbcTransfer, Planet, Proposal, Validator } from './types';

const CORE = new THREE.Vector3(0, 0, 0);
const FLOOR_Y = -6;
const PORT = new THREE.Vector3(104, FLOOR_Y, 0);
const GOV_R = 108;
const SHELL_R = 420;
const MAX_BLOCKS = 34;

export type ViewName = 'overview' | 'core' | 'validators' | 'blocks' | 'gov' | 'ibc';
type Vec3 = [number, number, number];
export const VIEWS: Record<ViewName, { pos: Vec3; target: Vec3 }> = {
  overview: { pos: [0, 78, 205], target: [0, 16, 0] },
  core: { pos: [30, 12, 38], target: [0, 3, 0] },
  validators: { pos: [0, 46, 92], target: [0, 4, 0] },
  blocks: { pos: [52, 62, 62], target: [0, 62, 0] },
  gov: { pos: [-38, 26, 18], target: [-GOV_R, 16, 0] },
  ibc: { pos: [168, 26, 78], target: [104, 34, 0] },
};

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  VOTING_PERIOD: { label: 'VOTING', color: '#f0827d' },
  PASSED: { label: 'PASSED', color: '#86efac' },
  REJECTED: { label: 'REJECTED', color: '#f87171' },
  FAILED: { label: 'FAILED', color: '#f87171' },
  DEPOSIT_PERIOD: { label: 'DEPOSIT', color: '#fde68a' },
};
export const statusStyle = (s: string): { label: string; color: string } => STATUS_STYLE[s] || { label: s, color: '#cbd5e1' };

// The world inside the planet: consensus core, validator ring, block helix,
// mempool swirl, governance hall and the IBC spaceport.
// One Interior is built per visit, themed with the chain's colour, and disposed on exit.
type Pillar = THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
type BlockMesh = THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
type Ring = THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
interface GovPanel {
  group: THREE.Group;
  frame: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  tex: THREE.CanvasTexture;
  voting: boolean;
  baseY: number;
  phase: number;
}

export class Interior {
  readonly scene = new THREE.Scene();
  pickables: THREE.Object3D[] = [];

  private accent: THREE.Color;
  private accentLight: THREE.Color;
  private labelColor: string;
  private validators: Pillar[] = [];
  private blocks: BlockMesh[] = [];
  private ships: Ship[] = [];
  private queue: { at: number; fn: () => void }[] = [];
  private time = 0;
  private step = 0;
  private corePulse = 0;
  private govPanels: GovPanel[] = [];
  private coreLight: THREE.PointLight;
  private flyers: Flyers;
  private shellU!: { uTime: { value: number }; uPulse: { value: number }; uAccent: { value: THREE.Vector3 } };
  private dust!: THREE.Points;
  private coreBall!: THREE.Mesh;
  private coreGlow!: THREE.Sprite;
  private cage!: THREE.LineSegments;
  private rings!: Ring[];
  private valGroup!: THREE.Group;
  private mem!: { n: number; a: Float32Array; r: Float32Array; y: Float32Array; s: Float32Array };
  private memPoints!: THREE.Points;
  private helixGroup!: THREE.Group;
  private chainLine!: THREE.Line;
  private blockGeo!: THREE.BoxGeometry;
  private blockEdges!: THREE.EdgesGeometry;
  private gates!: Ring[];
  private gov!: THREE.Group;

  constructor(private chain: Planet) {
    const white = new THREE.Color('#ffffff');
    this.accent = new THREE.Color(chain.color);
    this.accentLight = this.accent.clone().lerp(white, 0.4);
    this.labelColor = `#${new THREE.Color(chain.color).lerp(white, 0.72).getHexString()}`;

    this.scene.add(new THREE.AmbientLight('#8a6f8f', 0.9));
    this.coreLight = new THREE.PointLight(this.accentLight, 260, 400, 1.6);
    this.scene.add(this.coreLight);

    this.buildShell();
    this.buildCore();
    this.buildFloor();
    this.buildMempool();
    this.buildChain();
    this.buildPort();
    this.buildGovHall();

    this.flyers = new Flyers(900, 2.4);
    this.scene.add(this.flyers.points);
  }

  private later(delay: number, fn: () => void): void { this.queue.push({ at: this.time + delay, fn }); }

  // ---------- environment ----------
  private buildShell(): void {
    this.shellU = { uTime: { value: 0 }, uPulse: { value: 0 }, uAccent: { value: srgbVec(this.chain.color) } };
    const shell = new THREE.Mesh(new THREE.SphereGeometry(SHELL_R, 64, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: this.shellU, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `${NOISE_GLSL}
        uniform float uTime; uniform float uPulse; uniform vec3 uAccent; varying vec3 vP;
        float hex(vec2 p){ p.x *= 0.57735*2.0; p.y += mod(floor(p.x), 2.0)*0.5; p = abs(fract(p)-0.5);
          return abs(max(p.x*1.5 + p.y, p.y*2.0) - 1.0); }
        void main(){
          float lat = asin(clamp(vP.y,-1.0,1.0)); float lon = atan(vP.z, vP.x);
          vec2 uv = vec2(lon*9.0, lat*14.0);
          float poles = smoothstep(1.35, 0.9, abs(lat));
          float line = smoothstep(0.05, 0.0, hex(uv)) * poles;
          float n = fbm(vP*3.0 + vec3(0.0, uTime*0.03, 0.0))*0.5+0.5;
          vec3 deep = mix(vec3(0.04,0.025,0.08), uAccent*0.2 + vec3(0.0,0.0,0.03), smoothstep(-0.9,0.9,vP.y));
          vec3 c = deep + uAccent*0.2*smoothstep(0.5,0.9,n)*0.5;
          // a wave of light sweeps up the shell with each committed block
          float wave = smoothstep(0.12, 0.0, abs(vP.y - (uPulse*2.2 - 1.1)));
          c += uAccent * line * (0.22 + 0.3*n + wave*0.9);
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0); // authored in display space
        }`,
    }));
    this.scene.add(shell);

    // drifting dust for depth
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 320);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.4, map: dotTexture(), color: this.accentLight, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.dust);
  }

  private buildCore(): void {
    const core = new THREE.Group();
    this.coreBall = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 3), new THREE.MeshBasicMaterial({ color: this.accentLight }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture(), color: this.accent, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.setScalar(34);
    this.coreGlow = glow;
    this.cage = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(7.5, 1)),
      new THREE.LineBasicMaterial({ color: this.accent, transparent: true, opacity: 0.7 }),
    );
    core.add(this.coreBall, glow, this.cage);

    // Three consensus rings: propose, prevote, precommit
    this.rings = [10.5, 12.6, 14.7].map((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.16, 8, 120),
        new THREE.MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0.25 }),
      );
      ring.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.7, 0);
      core.add(ring);
      return ring;
    });
    this.coreBall.userData = { type: 'core' };
    this.pickables.push(this.coreBall);
    this.scene.add(core);

    const lbl = makeLabel('CONSENSUS CORE', { height: 1.5, color: this.labelColor, opacity: 0.85 });
    lbl.position.set(0, -11, 0);
    this.scene.add(lbl);
  }

  private buildFloor(): void {
    const grid = new THREE.PolarGridHelper(74, 24, 6, 96, this.accent, this.accent.clone().multiplyScalar(0.35));
    grid.position.y = FLOOR_Y;
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.28;
    this.scene.add(grid);
    const disc = new THREE.Mesh(
      new THREE.RingGeometry(20, 74, 96),
      new THREE.MeshBasicMaterial({ color: '#1a0b16', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = FLOOR_Y - 0.1;
    this.scene.add(disc);
    this.valGroup = new THREE.Group();
    this.scene.add(this.valGroup);
    const lbl = makeLabel('VALIDATOR RING', { height: 1.8, color: this.labelColor, opacity: 0.8 });
    lbl.position.set(0, FLOOR_Y + 1.5, 70);
    this.scene.add(lbl);
  }

  private buildMempool(): void {
    const n = 420;
    this.mem = { n, a: new Float32Array(n), r: new Float32Array(n), y: new Float32Array(n), s: new Float32Array(n) };
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const kinds = Object.values(KINDS);
    for (let i = 0; i < n; i++) {
      this.mem.a[i] = Math.random() * Math.PI * 2;
      this.mem.r[i] = 17 + Math.random() * 9;
      this.mem.y[i] = (Math.random() - 0.5) * 5;
      this.mem.s[i] = 0.25 + Math.random() * 0.5;
      const c = new THREE.Color(kinds[i % kinds.length].color).multiplyScalar(0.7);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.memPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.memPoints);
  }

  private buildChain(): void {
    this.helixGroup = new THREE.Group();
    this.scene.add(this.helixGroup);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAX_BLOCKS + 2) * 3), 3));
    this.chainLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: this.accent, transparent: true, opacity: 0.55 }));
    this.chainLine.frustumCulled = false;
    this.helixGroup.add(this.chainLine);
    this.blockGeo = new THREE.BoxGeometry(1, 1, 1);
    this.blockEdges = new THREE.EdgesGeometry(this.blockGeo);
    const lbl = makeLabel('BLOCK HELIX', { height: 1.8, color: this.labelColor, opacity: 0.8 });
    lbl.position.set(0, 20 + MAX_BLOCKS * 3.3, 0);
    this.scene.add(lbl);
  }

  private helix(i: number): THREE.Vector3 {
    const a = i * 0.56;
    return new THREE.Vector3(Math.cos(a) * 14, 17 + i * 3.1, Math.sin(a) * 14);
  }

  private buildPort(): void {
    const g = new THREE.Group();
    g.position.copy(PORT);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 15, 1.2, 6),
      new THREE.MeshStandardMaterial({ color: '#10202a', emissive: '#0f766e', emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.4 }),
    );
    const padEdge = new THREE.LineSegments(new THREE.EdgesGeometry(pad.geometry), new THREE.LineBasicMaterial({ color: '#5eead4' }));
    g.add(pad, padEdge);
    this.gates = [0, 1, 2, 3].map((i) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(7 + i * 2.6, 0.22, 8, 64),
        new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.55 - i * 0.08 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 10 + i * 11;
      g.add(ring);
      return ring;
    });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 4.5, 60, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 30;
    g.add(beam);
    const lbl = makeLabel('IBC SPACEPORT', { height: 2, color: '#a7f3e6', opacity: 0.9 });
    lbl.position.set(0, -4, 0);
    g.add(lbl);
    pad.userData = { type: 'port' };
    this.pickables.push(pad);
    this.scene.add(g);
    const portLight = new THREE.PointLight('#5eead4', 200, 120, 1.6);
    portLight.position.copy(PORT).add(new THREE.Vector3(0, 12, 0));
    this.scene.add(portLight);
  }

  private buildGovHall(): void {
    this.gov = new THREE.Group();
    this.scene.add(this.gov);
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(GOV_R - 5, GOV_R + 5, 64, 1, Math.PI - 1.0, 2.0),
      new THREE.MeshBasicMaterial({ color: '#2a1230', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = FLOOR_Y;
    // RingGeometry lies in XY with theta from +X; after the -90° X rotation theta maps to (x, -z), so π faces -X.
    this.scene.add(arc);
    const lbl = makeLabel('GOVERNANCE HALL', { height: 2, color: '#e9d5ff', opacity: 0.9 });
    lbl.position.set(-GOV_R, FLOOR_Y - 3, 0);
    this.scene.add(lbl);
  }

  // ---------- validators ----------
  setValidators(list: Validator[]): void {
    // Rebuild only when the set changes size/order; otherwise just refresh data.
    const same = this.validators.length === list.length && this.validators.every((p, i) => p.userData.v.operator === list[i].operator);
    if (same) { list.forEach((v, i) => { this.validators[i].userData.v = v; }); return; }
    this.validators.forEach((p) => {
      this.valGroup.remove(p);
      p.geometry.dispose(); p.material.dispose();
      p.userData.label?.userData.dispose();
    });
    this.pickables = this.pickables.filter((o) => o.userData.type !== 'validator');
    this.validators = [];
    this.valGroup.clear();

    const max = list[0]?.power || 1;
    const baseHue = this.accent.getHSL({ h: 0, s: 0, l: 0 }).h;
    let ring = 0, placed = 0;
    while (placed < list.length) {
      const R = 34 + ring * 13;
      const cap = Math.min(list.length - placed, Math.floor((2 * Math.PI * R) / 7.6));
      for (let k = 0; k < cap; k++) {
        const v = list[placed + k];
        const a = (k / cap) * Math.PI * 2 + ring * 0.4 + Math.PI / 2;
        const h = 5 + 30 * Math.pow(v.power / max, 0.6);
        const geo = new THREE.CylinderGeometry(2.1, 2.6, h, 6);
        geo.translate(0, h / 2, 0);
        const hue = (baseHue + 0.07 * (placed + k) / Math.max(1, list.length)) % 1; // hue drifts with rank
        const mat = new THREE.MeshStandardMaterial({
          color: '#241018', emissive: new THREE.Color().setHSL(hue, 0.85, 0.5), emissiveIntensity: 0.2, metalness: 0.5, roughness: 0.35,
        });
        const pillar: Pillar = new THREE.Mesh(geo, mat);
        pillar.position.set(Math.cos(a) * R, FLOOR_Y, Math.sin(a) * R);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: mat.emissive, transparent: true, opacity: 0.8 }));
        pillar.add(edges);
        pillar.userData = { type: 'validator', v, h, flash: 0, bad: 0, top: pillar.position.clone().add(new THREE.Vector3(0, h + 0.6, 0)) };
        if (list.length <= 60 || placed + k < 30) {
          const name = v.moniker.length > 18 ? v.moniker.slice(0, 17) + '…' : v.moniker;
          const lbl = makeLabel(name, { height: 1.15, color: this.labelColor, opacity: 0.9 });
          lbl.position.set(0, h + 2, 0);
          pillar.add(lbl);
          pillar.userData.label = lbl;
        }
        this.valGroup.add(pillar);
        this.validators.push(pillar);
        this.pickables.push(pillar);
      }
      placed += cap;
      ring++;
    }
  }

  // ---------- governance ----------
  setProposals(list: Proposal[]): void {
    this.govPanels.forEach((p) => {
      this.gov.remove(p.group);
      p.tex.dispose();
    });
    this.pickables = this.pickables.filter((o) => o.userData.type !== 'proposal');
    this.govPanels = [];
    const n = list.length;
    list.forEach((p, i) => {
      const a = Math.PI + (i - (n - 1) / 2) * 0.235;
      const tex = new THREE.CanvasTexture(drawProposal(p));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const voting = p.status === 'VOTING_PERIOD';
      const st = statusStyle(p.status);
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(22, 13.75),
        // slightly dimmed so hologram text stays under the bloom threshold and remains crisp
        new THREE.MeshBasicMaterial({ map: tex, color: '#b8b8b8', transparent: true, opacity: 0.96, side: THREE.DoubleSide }),
      );
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(23, 14.75)),
        new THREE.LineBasicMaterial({ color: st.color, transparent: true, opacity: voting ? 1 : 0.45 }),
      );
      const group = new THREE.Group();
      const y = 14 + (i % 2) * 5;
      group.position.set(Math.cos(a) * GOV_R, y, -Math.sin(a) * GOV_R);
      group.lookAt(0, y, 0);
      const stem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -7.4, 0), new THREE.Vector3(0, FLOOR_Y - y, 0)]),
        new THREE.LineBasicMaterial({ color: st.color, transparent: true, opacity: 0.35 }),
      );
      group.add(panel, frame, stem);
      panel.userData = { type: 'proposal', p };
      this.gov.add(group);
      this.pickables.push(panel);
      this.govPanels.push({ group, frame, tex, voting, baseY: y, phase: i * 1.3 });
    });
  }

  // ---------- consensus + blocks ----------
  setStep(step: number): void { this.step = step; }

  onBlock(b: Block): void {
    const core = CORE.clone();
    // 1. proposer broadcasts: a beam from the proposer's tower to the core
    const prop = b.proposer && this.validators[b.proposer.index];
    if (prop) {
      prop.userData.flash = 2.2;
      const geo = new THREE.BufferGeometry().setFromPoints([prop.userData.top, core]);
      const beam = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#fff3c4', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.scene.add(beam);
      tween({ dur: 1.5, easing: ease.linear, update: (k) => { beam.material.opacity = 1 - k; }, done: () => { this.scene.remove(beam); geo.dispose(); beam.material.dispose(); } });
    }
    // 2. validators that signed the commit send their votes to the core
    this.validators.forEach((p, i) => {
      if (b.signers.has(i)) {
        p.userData.flash = Math.max(p.userData.flash, 1);
        this.flyers.spawn(p.userData.top, core, '#ffe4d6', { dur: 0.75, delay: 0.1 + Math.random() * 0.25, arc: 5 });
      } else if (b.signers.size) {
        p.userData.bad = 1; // missed this commit
      }
    });
    // 3. transactions leave the mempool and are packed into the block
    b.txs.slice(0, 90).forEach((tx) => {
      const from = new THREE.Vector3().randomDirection().multiplyScalar(48 + Math.random() * 40);
      from.y = Math.abs(from.y) * 0.6 + 4;
      this.flyers.spawn(from, core, KINDS[tx.kind].color, { dur: 0.85, delay: Math.random() * 0.3, arc: 6 });
    });
    // 4. commit: the core fires and a new block is born
    this.later(1.0, () => {
      this.corePulse = 1;
      this.shellU.uPulse.value = 0;
      tween({ dur: 2.2, easing: ease.out, update: (k) => { this.shellU.uPulse.value = k; }, done: () => { this.shellU.uPulse.value = 0; } });
      this.addBlock(b);
    });
  }

  private addBlock(b: Block): void {
    const n = b.txs.length;
    const size = 2.3 + Math.min(2.2, Math.sqrt(n) * 0.55);
    const mat = new THREE.MeshStandardMaterial({
      color: '#2b1119', emissive: n ? this.accent : this.accent.clone().multiplyScalar(0.4), emissiveIntensity: n ? 0.6 : 0.3,
      metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.92,
    });
    const mesh: BlockMesh = new THREE.Mesh(this.blockGeo, mat);
    mesh.scale.setScalar(0.01);
    mesh.add(new THREE.LineSegments(this.blockEdges, new THREE.LineBasicMaterial({ color: this.labelColor })));
    const lbl = makeLabel(`#${b.height.toLocaleString('en-US')}${n ? ` · ${n} tx` : ''}`, { height: 1.2, color: this.labelColor });
    lbl.scale.multiplyScalar(1 / size); // keep label size independent of block scale
    lbl.position.set(0, 0.5 + 1.1 / size, 0);
    lbl.center.set(0.5, 0);
    mesh.add(lbl);
    mesh.userData = { type: 'block', b, size, label: lbl, spin: (Math.random() - 0.5) * 0.6, base: mat.emissiveIntensity, glow: 0 };
    mesh.position.copy(CORE);
    this.helixGroup.add(mesh);
    this.pickables.push(mesh);
    this.blocks.unshift(mesh);
    tween({ dur: 0.6, easing: ease.out, update: (k) => mesh.scale.setScalar(Math.max(0.01, size * k)) });
    while (this.blocks.length > MAX_BLOCKS) {
      const old = this.blocks.pop()!;
      this.pickables.splice(this.pickables.indexOf(old), 1);
      tween({
        dur: 0.8, update: (k) => old.scale.setScalar(Math.max(0.01, old.userData.size * (1 - k))),
        done: () => { this.helixGroup.remove(old); old.material.dispose(); old.userData.label.userData.dispose(); },
      });
    }
  }

  // ---------- lookups (search, deep links) ----------
  /** Light up a validator's tower and return the top of it, or null if it is not in the ring. */
  focusValidator(operator: string): THREE.Vector3 | null {
    const pillar = this.validators.find((p) => p.userData.v.operator === operator);
    if (!pillar) return null;
    pillar.userData.flash = 3;
    return pillar.userData.top.clone();
  }

  /** Light up a block in the helix and return where it is, or null if it has scrolled away (or was never witnessed). */
  focusBlock(height: number): THREE.Vector3 | null {
    const mesh = this.blocks.find((m) => m.userData.b.height === height);
    if (!mesh) return null;
    mesh.userData.glow = 2;
    return mesh.getWorldPosition(new THREE.Vector3());
  }

  // ---------- IBC ----------
  launchShip(ibc: IbcTransfer, { replay = false } = {}): void {
    // Each counterparty chain gets a stable exit point in the sky above the port.
    const az = (hash01(ibc.chainId) - 0.5) * 2.4;
    const el = 0.35 + hash01(ibc.chainId, 5) * 0.6;
    const exit = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(SHELL_R - 8);
    const pad = PORT.clone().add(new THREE.Vector3(0, 1.5, 0));
    const up = PORT.clone().add(new THREE.Vector3(0, 95, 0));
    const out = ibc.dir === 'out';
    const curve = out ? new THREE.QuadraticBezierCurve3(pad, up, exit) : new THREE.QuadraticBezierCurve3(exit, up, pad);
    const label = `${out ? '→' : '←'} ${ibc.chainName}${ibc.amount ? ' · ' + ibc.amount : ''}${replay ? ' · replay' : ''}`;
    this.ships.push(new Ship(this.scene, curve, {
      color: ibc.color, dur: out ? 7 : 6, size: 2, label, easing: out ? ease.in : ease.out,
      onDone: (p) => this.flash(p, ibc.color, out ? 40 : 14),
    }));
    this.gates.forEach((g, i) => {
      tween({ dur: 0.9, delay: (out ? i : 3 - i) * 0.18, easing: ease.out, update: (k) => { g.scale.setScalar(1 + 0.35 * Math.sin(k * Math.PI)); } });
    });
  }

  private flash(p: THREE.Vector3, color: string, size: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.copy(p);
    this.scene.add(s);
    tween({ dur: 0.9, easing: ease.out, update: (k) => { s.scale.setScalar(size * (0.3 + k)); s.material.opacity = 1 - k; }, done: () => { this.scene.remove(s); s.material.dispose(); } });
  }

  // Free GPU resources when the visitor leaves the planet (the dot texture is shared, keep it).
  dispose(): void {
    const shared = dotTexture();
    this.scene.traverse((o) => {
      const { geometry, material: m } = o as Partial<THREE.Mesh<THREE.BufferGeometry, THREE.Material & { map?: THREE.Texture | null }>>;
      geometry?.dispose();
      if (m) { if (m.map && m.map !== shared) m.map.dispose(); m.dispose(); }
    });
    this.queue = [];
  }

  // ---------- frame ----------
  update(dt: number, t: number): void {
    this.time += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].at <= this.time) { const q = this.queue.splice(i, 1)[0]; q.fn(); }
    }
    this.shellU.uTime.value = t;
    this.dust.rotation.y += dt * 0.01;

    // core
    this.corePulse = Math.max(0, this.corePulse - dt * 1.4);
    const breathe = 1 + Math.sin(t * 2.4) * 0.04 + this.corePulse * 0.55;
    this.coreBall.scale.setScalar(breathe);
    this.coreGlow.scale.setScalar(34 + this.corePulse * 40);
    this.coreLight.intensity = 260 + this.corePulse * 700;
    this.cage.rotation.y += dt * 0.3;
    this.cage.rotation.x += dt * 0.11;
    this.rings.forEach((r, i) => {
      r.rotation.z += dt * (0.25 + i * 0.12) * (i % 2 ? -1 : 1);
      const active = this.step === 3 || this.step === i;
      const target = this.step === 3 ? 1 : active ? 0.95 : this.step > i ? 0.5 : 0.14;
      r.material.opacity += (target - r.material.opacity) * Math.min(1, dt * 8);
      const s = 1 + (active ? 0.03 * Math.sin(t * 9) : 0);
      r.scale.setScalar(s);
    });

    // validators
    for (const p of this.validators) {
      const u = p.userData;
      u.flash = Math.max(0, u.flash - dt * 1.6);
      u.bad = Math.max(0, u.bad - dt * 0.8);
      p.material.emissiveIntensity = 0.2 + u.flash * 0.7;
      p.material.color.setRGB(0.02 + u.bad * 0.5, 0.008, 0.012);
    }

    // mempool swirl
    const m = this.mem;
    const pos = this.memPoints.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < m.n; i++) {
      m.a[i] += dt * m.s[i] * (1 + this.corePulse * 3);
      const r = m.r[i] * (1 - this.corePulse * 0.25);
      pos[i * 3] = Math.cos(m.a[i]) * r;
      pos[i * 3 + 1] = m.y[i] + Math.sin(m.a[i] * 2 + i) * 0.8;
      pos[i * 3 + 2] = Math.sin(m.a[i]) * r;
    }
    this.memPoints.geometry.attributes.position.needsUpdate = true;

    // block helix
    this.helixGroup.rotation.y += dt * 0.05;
    const line = this.chainLine.geometry.attributes.position.array as Float32Array;
    line.set([0, 0, 0], 0);
    this.blocks.forEach((mesh, i) => {
      mesh.position.lerp(this.helix(i), Math.min(1, dt * 3));
      mesh.rotation.y += dt * mesh.userData.spin;
      mesh.userData.glow = Math.max(0, mesh.userData.glow - dt * 0.45);
      mesh.material.emissiveIntensity = mesh.userData.base + mesh.userData.glow * 1.6;
      mesh.userData.label.visible = i < 8 || i % 4 === 0;
      line.set([mesh.position.x, mesh.position.y, mesh.position.z], (i + 1) * 3);
    });
    this.chainLine.geometry.setDrawRange(0, this.blocks.length + 1);
    this.chainLine.geometry.attributes.position.needsUpdate = true;

    // governance panels
    for (const g of this.govPanels) {
      g.group.position.y = g.baseY + Math.sin(t * 0.8 + g.phase) * 0.6;
      if (g.voting) g.frame.material.opacity = 0.65 + 0.35 * Math.sin(t * 3 + g.phase);
    }

    // port
    this.gates.forEach((g, i) => { g.rotation.z += dt * (0.4 + i * 0.15) * (i % 2 ? -1 : 1); });

    this.flyers.update(dt);
    this.ships = this.ships.filter((s) => s.update(dt));
  }
}

function drawProposal(p: Proposal): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 400;
  const g = c.getContext('2d')!;
  const st = statusStyle(p.status);
  g.fillStyle = 'rgba(14, 8, 24, 0.9)';
  g.fillRect(0, 0, 640, 400);
  // header
  g.font = '700 30px "Space Grotesk", system-ui, sans-serif';
  g.fillStyle = '#b9a6c9';
  g.fillText(`PROPOSAL #${p.id}`, 32, 56);
  g.font = '700 24px "Space Grotesk", system-ui, sans-serif';
  const w = g.measureText(st.label).width + 32;
  g.fillStyle = st.color;
  g.beginPath(); g.roundRect(608 - w, 26, w, 40, 20); g.fill();
  g.fillStyle = '#12081a';
  g.fillText(st.label, 608 - w + 16, 55);
  // title (wrapped, max 3 lines)
  g.fillStyle = '#ffffff';
  g.font = '600 38px "Space Grotesk", system-ui, sans-serif';
  const words = p.title.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const t = cur ? `${cur} ${word}` : word;
    if (g.measureText(t).width > 576 && cur) { lines.push(cur); cur = word; } else cur = t;
  }
  lines.push(cur);
  if (lines.length > 3) { lines.length = 3; lines[2] = lines[2].replace(/.{0,3}$/, '…'); }
  lines.forEach((l, i) => g.fillText(l, 32, 128 + i * 48));
  // tally
  const { yes, no, abstain, veto } = p.tally;
  const total = yes + no + abstain + veto;
  const parts: [number, string, string][] = [[yes, '#4ade80', 'Yes'], [no, '#f87171', 'No'], [veto, '#b91c1c', 'Veto'], [abstain, '#94a3b8', 'Abstain']];
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.beginPath(); g.roundRect(32, 296, 576, 26, 13); g.fill();
  if (total > 0) {
    g.save();
    g.beginPath(); g.roundRect(32, 296, 576, 26, 13); g.clip();
    let x = 32;
    for (const [v, col] of parts) {
      const pw = (v / total) * 576;
      g.fillStyle = col;
      g.fillRect(x, 296, pw, 26);
      x += pw;
    }
    g.restore();
  }
  g.font = '500 24px "Space Grotesk", system-ui, sans-serif';
  let x = 32;
  for (const [v, col, name] of parts) {
    const txt = `${name} ${total > 0 ? ((v / total) * 100).toFixed(v / total > 0.0995 ? 0 : 1) : 0}%`;
    g.fillStyle = col;
    g.fillRect(x, 348, 14, 14);
    g.fillStyle = '#d9cfe6';
    g.fillText(txt, x + 22, 363);
    x += g.measureText(txt).width + 50;
  }
  return c;
}
