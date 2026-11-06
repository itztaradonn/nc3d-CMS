// NC3D shared 3D viewer (used by public site and admin panel)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { parse3MF } from './threemf.js';

export const FINISHES = {
  matte: { roughness: 0.85, metalness: 0.0 },
  standard: { roughness: 0.55, metalness: 0.0 },
  silk: { roughness: 0.3, metalness: 0.25 },
  glossy: { roughness: 0.15, metalness: 0.0 },
  metal: { roughness: 0.3, metalness: 0.85 },
  translucent: { roughness: 0.2, metalness: 0.0, opacity: 0.55 },
};

/** Download a 3MF (with progress). Falls back to model.php if the host blocks the file. */
export async function fetchModel(url, onProgress) {
    let res = await fetch(url).catch(() => null);
    if (!res || !res.ok) {
      // host blocked the direct file → try PHP streamer (DirectAdmin)
      const m = url.match(/(?:^|\/)(uploads\/models\/[^?#]+)$/);
      if (m) {
        const base = url.slice(0, url.length - m[1].length);
        const alt = await fetch(base + 'model.php?f=' + encodeURIComponent(m[1])).catch(() => null);
        if (alt && alt.ok) res = alt;
      }
    }
    if (!res || !res.ok) throw new Error('Cannot load model (' + (res ? res.status : 'network') + '): ' + url);
    let buf;
    const total = +res.headers.get('content-length') || 0;
    if (onProgress && res.body && total) {
      const reader = res.body.getReader();
      const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(got / total);
      }
      const all = new Uint8Array(got); let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      buf = all.buffer;
    } else {
      buf = await res.arrayBuffer();
    }
    return buf;
}

export class Viewer {
  constructor(container, opts = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.camera.position.set(120, 90, 160);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = !!opts.autoRotate;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 0.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.18 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.meshes = new Map(); // key -> mesh
    this.tickers = [];
    this.raycaster = new THREE.Raycaster();
    this.highlightKey = null;

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    if (window.ResizeObserver) new ResizeObserver(this._resize).observe(container);
    this.resize();
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      for (const f of this.tickers) f();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    for (const m of this.meshes.values()) {
      m.material.dispose();
    }
    this.root.clear();
    this.meshes.clear();
  }

  async loadUrl(url, onProgress) {
    return this.loadBuffer(await fetchModel(url, onProgress));
  }

  loadBuffer(buffer) {
    const { parts } = parse3MF(buffer);
    this.clear();
    const inner = new THREE.Group();
    for (const p of parts) {
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.color || '#c8ccd4'),
        roughness: 0.55, metalness: 0, flatShading: false,
      });
      const mesh = new THREE.Mesh(p.geometry, mat);
      mesh.applyMatrix4(p.matrix);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { key: p.key, name: p.name, fileColor: p.color };
      inner.add(mesh);
      this.meshes.set(p.key, mesh);
    }
    // 3MF is Z-up, three.js is Y-up
    inner.rotation.x = -Math.PI / 2;
    this.root.add(inner);
    this.root.updateMatrixWorld(true);
    // center on ground
    const box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.x -= center.x;
    inner.position.z -= center.z;
    inner.position.y -= box.min.y;
    this.root.updateMatrixWorld(true);
    this.fit();
    return parts.map((p) => ({ key: p.key, name: p.name, color: p.color }));
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const dist = radius / Math.sin(Math.min(vHalf, hHalf)) * 1.05;
    const dir = new THREE.Vector3(0.75, 0.6, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.6;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
    this.ground.scale.set(radius * 12, radius * 12, 1);
    this.sun.position.set(center.x + radius * 2, center.y + radius * 4, center.z + radius * 3);
    this.sun.target.position.copy(center);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -radius * 2; s.right = s.top = radius * 2;
    s.near = 0.1; s.far = radius * 12;
    s.updateProjectionMatrix();
  }

  /** Show a ready-made object (Y-up, mm). registry: Map(key -> mesh) for setColor. */
  setObject(obj, registry, refit = true) {
    for (const m of this.meshes.values()) m.material.dispose();
    this.root.clear();
    this.meshes = registry || new Map();
    this.root.add(obj);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      obj.position.x -= c.x;
      obj.position.z -= c.z;
      obj.position.y -= box.min.y;
    }
    this.root.updateMatrixWorld(true);
    if (refit) this.fit();
  }

  /** First mesh under a screen point (clientX/Y), or null. */
  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hit = this.raycaster.intersectObject(this.root, true)[0];
    return hit ? hit.object : null;
  }

  setColor(key, hex, finish = 'standard') {
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    const f = FINISHES[finish] || FINISHES.standard;
    mesh.material.color.set(hex);
    mesh.material.roughness = f.roughness;
    mesh.material.metalness = f.metalness;
    const op = f.opacity == null ? 1 : f.opacity;
    mesh.material.transparent = op < 1;
    mesh.material.opacity = op;
    mesh.material.needsUpdate = true;
  }

  setVisible(key, visible) {
    const mesh = this.meshes.get(key);
    if (mesh) mesh.visible = visible;
  }

  highlight(keys) {
    const set = new Set(keys || []);
    for (const [k, m] of this.meshes) {
      m.material.emissive.set(set.has(k) ? 0x3355ff : 0x000000);
      m.material.emissiveIntensity = set.has(k) ? 0.6 : 0;
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  snapshot(type = 'image/png', size = 0) {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    if (!size) return src.toDataURL(type);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL(type, 0.9);
  }
}
