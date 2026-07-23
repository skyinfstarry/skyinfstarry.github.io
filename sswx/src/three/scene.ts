import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gstime } from 'satellite.js';
import type { SimEngine, GroupRuntime } from '../state/engine';
import { sunDirection } from '../lib/sun';

const SAT_VERT = /* glsl */ `
uniform float uSize;
uniform float uPixelRatio;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * uPixelRatio * (2.4 / -mv.z);
  gl_PointSize = clamp(s, 1.2, 14.0);
}`;

const SAT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d);
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

const NIGHT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWN;
void main() {
  vUv = uv;
  vWN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NIGHT_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vWN;
void main() {
  vec3 night = texture2D(uMap, vUv).rgb;
  float ndl = dot(normalize(vWN), normalize(uSunDir));
  float m = 1.0 - smoothstep(-0.12, 0.3, ndl);
  gl_FragColor = vec4(night * m * uIntensity, 1.0);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMO_FRAG = /* glsl */ `
varying vec3 vN;
void main() {
  float i = pow(0.66 - dot(vN, vec3(0.0, 0.0, 1.0)), 2.4);
  gl_FragColor = vec4(0.32, 0.62, 1.0, 1.0) * i * 1.05;
}`;

const ORBIT_SAMPLES = 220;
const COV_SEGS = 96;

export class GlobeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sunLight = new THREE.DirectionalLight(0xfff6e8, 2.6);
  private nightMat!: THREE.ShaderMaterial;
  private clouds!: THREE.Mesh;
  private satPoints: THREE.Points[] = [];
  private orbitLine!: THREE.LineLoop;
  private covLoop!: THREE.LineLoop;
  private covFan!: THREE.Mesh;
  private selSprite!: THREE.Sprite;
  private raf = 0;
  private lastUiTick = 0;
  private lastOrbitCalc = 0;
  private orbitDirty = true;
  private lastInteract = 0;
  private issLabel: HTMLDivElement;
  private selLabel: HTMLDivElement;
  private issSat: ReturnType<SimEngine['findByNorad']> = null;
  private tmpV = new THREE.Vector3();

  private canvas: HTMLCanvasElement;
  private engine: SimEngine;
  private labelHost: HTMLElement;

  constructor(canvas: HTMLCanvasElement, engine: SimEngine, labelHost: HTMLElement) {
    this.canvas = canvas;
    this.engine = engine;
    this.labelHost = labelHost;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 3000);
    this.camera.position.set(0.35, 0.75, 2.7);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.55;
    this.controls.minDistance = 1.14;
    this.controls.maxDistance = 40;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = -0.28;
    this.controls.enablePan = false;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      this.lastInteract = performance.now();
    });
    this.controls.addEventListener('end', () => {
      this.lastInteract = performance.now();
    });

    this.issLabel = document.createElement('div');
    this.issLabel.className = 'sat-label';
    this.selLabel = document.createElement('div');
    this.selLabel.className = 'sat-label sat-label--sel';
    this.labelHost.append(this.issLabel, this.selLabel);

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  async init(onProgress?: (p: number, label: string) => void) {
    onProgress?.(0.1, '加载地球纹理…');
    const loader = new THREE.TextureLoader();
    const [day, night, clouds, normal, spec] = await Promise.all([
      loader.loadAsync('./textures/earth_atmos_2048.jpg'),
      loader.loadAsync('./textures/earth_lights_2048.png'),
      loader.loadAsync('./textures/earth_clouds_1024.png'),
      loader.loadAsync('./textures/earth_normal_2048.jpg'),
      loader.loadAsync('./textures/earth_specular_2048.jpg'),
    ]);
    day.colorSpace = THREE.SRGBColorSpace;
    night.colorSpace = THREE.SRGBColorSpace;
    day.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.scene.background = new THREE.Color(0x010208);
    this.scene.add(new THREE.AmbientLight(0x223048, 0.85));
    const hemi = new THREE.HemisphereLight(0x2a3c5f, 0x05070d, 0.5);
    this.scene.add(hemi);
    this.sunLight.position.set(10, 3, 5);
    this.scene.add(this.sunLight);

    // 地球本体
    const earthGeo = new THREE.SphereGeometry(1, 96, 72);
    const earthMat = new THREE.MeshPhongMaterial({
      map: day,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      specularMap: spec,
      specular: new THREE.Color(0x1d2f42),
      shininess: 24,
    });
    this.scene.add(new THREE.Mesh(earthGeo, earthMat));

    // 城市夜光层（自定义 shader，随太阳方向显隐）
    this.nightMat = new THREE.ShaderMaterial({
      vertexShader: NIGHT_VERT,
      fragmentShader: NIGHT_FRAG,
      uniforms: {
        uMap: { value: night },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uIntensity: { value: 1.35 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.0012, 96, 72), this.nightMat));

    // 云层
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.014, 64, 48),
      new THREE.MeshLambertMaterial({
        map: clouds,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    this.scene.add(this.clouds);

    // 大气辉光（背面球 + fresnel）
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(1.028, 64, 48),
      new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(atmo);

    this.buildStars();
    this.buildSatPoints();
    this.buildSelectionVisuals();
    this.issSat = this.engine.findByNorad(25544);
    this.engine.events.onRebuilt = () => {
      this.rebuildSatPoints();
      this.issSat = this.engine.findByNorad(25544);
      this.orbitDirty = true;
    };

    // 开场构图：相机置于昼半球一侧，晨昏线入画
    const now = new Date();
    const [sx, sy, sz] = sunDirection(now, gstime(now));
    this.camera.position.set(sx * 2.15 - sz * 0.8, sy * 1.7 + 0.5, sz * 2.15 + sx * 0.8);
    this.controls.update();

    onProgress?.(0.98, '启动渲染…');
    this.animate();
  }

  private buildStars() {
    const make = (count: number, size: number, opacity: number) => {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(280 + Math.random() * 320);
        pos.set([v.x, v.y, v.z], i * 3);
        const b = 0.35 + Math.random() * 0.65;
        const warm = Math.random();
        col.set(
          [b * (warm > 0.8 ? 1 : 0.92), b * 0.95, b * (warm > 0.8 ? 0.85 : 1)],
          i * 3,
        );
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const p = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          size,
          sizeAttenuation: false,
          vertexColors: true,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      p.frustumCulled = false;
      this.scene.add(p);
    };
    make(3200, 1.5, 0.85);
    make(160, 2.7, 0.95);
  }

  private makeSatMaterial(def: { color: string; size: number }) {
    return new THREE.ShaderMaterial({
      vertexShader: SAT_VERT,
      fragmentShader: SAT_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(def.color).multiplyScalar(1.25) },
        uSize: { value: def.size },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uOpacity: { value: 0.95 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  private buildSatPoints() {
    for (const grp of this.engine.groups) {
      if (grp.sats.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(grp.positions, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      const pts = new THREE.Points(geo, this.makeSatMaterial(grp.def));
      pts.frustumCulled = false;
      pts.visible = grp.visible;
      pts.userData.group = grp;
      this.scene.add(pts);
      this.satPoints.push(pts);
    }
  }

  rebuildSatPoints() {
    for (const p of this.satPoints) {
      this.scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.satPoints = [];
    this.buildSatPoints();
  }

  private ringTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(64, 64, 8, 0, Math.PI * 2);
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  private buildSelectionVisuals() {
    // 轨道线
    const og = new THREE.BufferGeometry();
    og.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(ORBIT_SAMPLES * 3), 3),
    );
    this.orbitLine = new THREE.LineLoop(
      og,
      new THREE.LineBasicMaterial({ color: 0x8be9ff, transparent: true, opacity: 0.9 }),
    );
    this.orbitLine.frustumCulled = false;
    this.orbitLine.visible = false;
    this.scene.add(this.orbitLine);

    // 覆盖圈
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COV_SEGS * 3), 3));
    this.covLoop = new THREE.LineLoop(
      cg,
      new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.85 }),
    );
    this.covLoop.frustumCulled = false;
    this.covLoop.visible = false;
    this.scene.add(this.covLoop);

    // 覆盖扇面
    const fg = new THREE.BufferGeometry();
    fg.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((COV_SEGS + 1) * 3), 3),
    );
    const idx: number[] = [];
    for (let i = 0; i < COV_SEGS; i++) idx.push(0, 1 + i, 1 + ((i + 1) % COV_SEGS));
    fg.setIndex(idx);
    this.covFan = new THREE.Mesh(
      fg,
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.covFan.frustumCulled = false;
    this.covFan.visible = false;
    this.scene.add(this.covFan);

    // 选中脉冲标记
    this.selSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.ringTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.95,
      }),
    );
    this.selSprite.visible = false;
    this.scene.add(this.selSprite);
  }

  private updateOrbitTrack() {
    const s = this.engine.selected;
    if (!s) {
      this.orbitLine.visible = this.covLoop.visible = this.covFan.visible = this.selSprite.visible = false;
      this.selLabel.style.display = 'none';
      return;
    }
    const now = this.engine.time.now();
    const tPerf = performance.now();
    if (this.orbitDirty || tPerf - this.lastOrbitCalc > 1100) {
      this.lastOrbitCalc = tPerf;
      this.orbitDirty = false;
      const periodMs = ((2 * Math.PI) / s.rec.no) * 60000;
      const t0 = now.getTime();
      const attr = this.orbitLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      let lx = 0, ly = 0, lz = 0;
      for (let i = 0; i < ORBIT_SAMPLES; i++) {
        const t = new Date(t0 + (periodMs * i) / ORBIT_SAMPLES);
        const p = this.engine.propagateOne(s, t);
        if (p) {
          lx = p.x; ly = p.y; lz = p.z;
        }
        attr.setXYZ(i, lx, ly, lz);
      }
      attr.needsUpdate = true;
      this.orbitLine.visible = true;
    }

    // 覆盖圈 + 扇面 + 标记（每帧跟随）
    const p = this.engine.propagateOne(s, now);
    if (!p) return;
    const c = this.tmpV.set(p.x, p.y, p.z);
    const r = c.length();
    const h = r - 1;
    if (h <= 0.0005) return;
    const rho = Math.acos(1 / (1 + h)); // 地平线覆盖中心角
    const cn = c.clone().normalize();
    const up = Math.abs(cn.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(up, cn).normalize();
    const v = new THREE.Vector3().crossVectors(cn, u);
    const loopAttr = this.covLoop.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fanAttr = this.covFan.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cosR = Math.cos(rho), sinR = Math.sin(rho);
    const lift = 1.0016;
    fanAttr.setXYZ(0, cn.x * lift, cn.y * lift, cn.z * lift);
    for (let i = 0; i < COV_SEGS; i++) {
      const t = (i / COV_SEGS) * Math.PI * 2;
      const dx = cosR * cn.x + sinR * (Math.cos(t) * u.x + Math.sin(t) * v.x);
      const dy = cosR * cn.y + sinR * (Math.cos(t) * u.y + Math.sin(t) * v.y);
      const dz = cosR * cn.z + sinR * (Math.cos(t) * u.z + Math.sin(t) * v.z);
      loopAttr.setXYZ(i, dx * lift, dy * lift, dz * lift);
      fanAttr.setXYZ(i + 1, dx * lift, dy * lift, dz * lift);
    }
    loopAttr.needsUpdate = true;
    fanAttr.needsUpdate = true;
    this.covLoop.visible = this.covFan.visible = true;

    this.selSprite.position.set(p.x, p.y, p.z);
    const pulse = 0.034 + 0.007 * Math.sin(tPerf * 0.005);
    this.selSprite.scale.setScalar(pulse);
    this.selSprite.visible = true;
    this.selLabel.textContent = s.name;
  }

  private updateLabel(el: HTMLDivElement, pos: { x: number; y: number; z: number } | null) {
    if (!pos) {
      el.style.display = 'none';
      return;
    }
    const v = this.tmpV.set(pos.x, pos.y, pos.z);
    const facing = v.clone().normalize().dot(this.camera.position.clone().normalize());
    if (facing < 0.12) {
      el.style.display = 'none';
      return;
    }
    v.project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    el.style.display = 'block';
    el.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const date = this.engine.time.now();
    const g = this.engine.propagateSlice(date);
    const gmst = g ?? gstime(date);

    for (const pts of this.satPoints) {
      (pts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      const grp = pts.userData.group as GroupRuntime;
      pts.visible = grp.visible;
    }

    // 太阳方向
    const [sx, sy, sz] = sunDirection(date, gmst);
    this.sunLight.position.set(sx * 10, sy * 10, sz * 10);
    (this.nightMat.uniforms.uSunDir.value as THREE.Vector3).set(sx, sy, sz);
    this.clouds.rotation.y += 0.00016;

    // 闲置 12s 恢复自动旋转
    if (!this.controls.autoRotate && performance.now() - this.lastInteract > 12000) {
      this.controls.autoRotate = true;
    }

    this.updateOrbitTrack();

    // 标签
    if (this.issSat && this.engine.selected?.norad !== 25544) {
      const p = this.engine.propagateOne(this.issSat, date);
      this.issLabel.textContent = '国际空间站 ISS';
      this.updateLabel(this.issLabel, p);
    } else {
      this.issLabel.style.display = 'none';
    }
    this.updateLabel(
      this.selLabel,
      this.engine.selected ? this.engine.propagateOne(this.engine.selected, date) : null,
    );

    const now = performance.now();
    if (now - this.lastUiTick > 450) {
      this.lastUiTick = now;
      this.engine.emitUi();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  /** 点击拾取卫星 */
  pick(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.022 };
    raycaster.setFromCamera(ndc, this.camera);
    const targets = this.satPoints.filter((p) => p.visible);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const grp = hit.object.userData.group as GroupRuntime;
      const sat = grp.sats[hit.index ?? -1];
      if (sat) {
        this.engine.select(sat.norad);
        this.orbitDirty = true;
        return sat;
      }
    }
    return null;
  }

  markOrbitDirty() {
    this.orbitDirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.issLabel.remove();
    this.selLabel.remove();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
