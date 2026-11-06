// NC3D Name Clicker: turns a modular "name clicker" 3MF (frames + keycap + letter glyphs)
// into a kit, then assembles a vertical keychain for any name the customer types.
import * as THREE from 'three';

export const DEFAULT_ROLES = {
  baseEnd: 'individual base(?!\\s*2)', // end frame (connector slot on one side)
  baseMid: 'individual base\\s*2',      // middle frame (slots on both sides)
  cap: 'key\\s*cap',
};

export const DEFAULT_CLICKER = {
  maxChars: 10,
  sampleText: 'NC3D',
  capOffset: 1.9,      // mm the keycap face sticks out of the frame
  gap: 0.6,            // mm between frames
  letterRotation: 90,  // extra rotation of the cap+letter (degrees, 0/90/180/270)
  flipEnds: false,     // swap which way the end frames face
  roles: { ...DEFAULT_ROLES },
  colors: { frame: [], letter: [], cap: [], cord: [] },
  defaults: { frame: '', letter: '', cap: '', cord: '' },
  cord: true,
  pricing: { base: 0, perChar: 0, cord: 0, currency: '฿' },
};

export function clickerConfig(model) {
  const c = model.clicker || {};
  return {
    ...DEFAULT_CLICKER,
    ...c,
    roles: { ...DEFAULT_ROLES, ...(c.roles || {}) },
    colors: { ...DEFAULT_CLICKER.colors, ...(c.colors || {}) },
    defaults: { ...DEFAULT_CLICKER.defaults, ...(c.defaults || {}) },
    pricing: { ...DEFAULT_CLICKER.pricing, ...(c.pricing || {}) },
  };
}

// strip emoji variation selectors so "♥︎" / "♥️" / "♥" all match
export function normChar(ch) {
  return String(ch || '').replace(/[︎️]/g, '').toUpperCase();
}

function safeRe(src, fallback) {
  try { return new RegExp(src || fallback, 'i'); } catch (e) { return new RegExp(fallback, 'i'); }
}

function centered(geometry) {
  const g = geometry.clone();
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingBox();
  return { geometry: g, center: c };
}

/**
 * @param parts output of parse3MF().parts
 * @returns kit or throws with a readable message
 */
export function extractKit(parts, roles = {}) {
  const r = { ...DEFAULT_ROLES, ...roles };
  const reEnd = safeRe(r.baseEnd, DEFAULT_ROLES.baseEnd);
  const reMid = safeRe(r.baseMid, DEFAULT_ROLES.baseMid);
  const reCap = safeRe(r.cap, DEFAULT_ROLES.cap);
  const plain = parts.filter((p) => !p.text);
  const endP = plain.find((p) => reEnd.test(p.name));
  const midP = plain.find((p) => reMid.test(p.name));
  const caps = plain.filter((p) => reCap.test(p.name));
  if (!endP && !midP) throw new Error('No frame/base part found (name like "individual base")');
  if (!caps.length) throw new Error('No keycap part found (name like "key cap")');

  const baseEnd = centered((endP || midP).geometry);
  const baseMid = centered((midP || endP).geometry);
  const cap = centered(caps[0].geometry);

  // letters: text parts that belong to the same build item as a keycap
  const capByItem = new Map(caps.map((c) => [c.item, c]));
  const letters = new Map();
  for (const t of parts.filter((p) => p.text)) {
    const c = capByItem.get(t.item);
    if (!c) continue;
    const ch = normChar(t.text);
    if (!ch || ch.includes('\uFFFD') || letters.has(ch)) continue;
    // letter placement relative to its own (centered) keycap
    const rel = new THREE.Matrix4().makeTranslation(-cap.center.x, -cap.center.y, -cap.center.z)
      .multiply(c.matrix.clone().invert())
      .multiply(t.matrix);
    letters.set(ch, { geometry: t.geometry, rel, label: t.text });
  }
  if (!letters.size) throw new Error('No letter/text parts found on the keycaps');

  // which side of the keycap the letter is on (Y axis in this design family)
  const probe = letters.values().next().value;
  const lp = new THREE.Vector3().setFromMatrixPosition(probe.rel);
  probe.geometry.computeBoundingBox();
  const lc = probe.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(probe.rel);
  const faceSign = Math.sign(lc.y || lp.y) || 1;

  const bb = baseEnd.geometry.boundingBox;
  const cb = cap.geometry.boundingBox;
  const chars = [...letters.keys()];
  return {
    baseEnd: baseEnd.geometry,
    baseMid: baseMid.geometry,
    hasMid: !!midP,
    cap: cap.geometry,
    letters,
    chars,
    faceSign,
    frame: { w: bb.max.x - bb.min.x, h: bb.max.z - bb.min.z, top: bb.max.y },
    capHalf: (cb.max.y - cb.min.y) / 2,
  };
}

/** Split text into characters the kit can print (keeps emoji/symbol clusters together). */
export function tokenize(kit, text, max) {
  const out = [];
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? [...new Intl.Segmenter().segment(text)].map((s) => s.segment) : Array.from(text);
  for (const g of seg) {
    const ch = normChar(g);
    if (!ch.trim()) continue;
    if (kit.letters.has(ch)) out.push(ch);
    if (out.length >= max) break;
  }
  return out;
}

const tmpM = new THREE.Matrix4();

/**
 * Build the assembled keychain.
 * slots: [{ char, frame: hex, letter: hex, frameFinish, letterFinish }]
 * opts: { cap: {hex, finish}, cord: {hex, finish} | null, cfg }
 * returns { group, registry: Map(key -> mesh), caps: [group per slot] }
 */
export function buildClicker(kit, slots, opts) {
  const cfg = opts.cfg || DEFAULT_CLICKER;
  const registry = new Map();
  const mat = (hex) => new THREE.MeshStandardMaterial({ color: new THREE.Color(hex || '#cccccc'), roughness: 0.55, metalness: 0 });

  // module space: X = along the chain, Y = out of the face, Z = across the face
  const chain = new THREE.Group();
  const pitch = kit.frame.w + (Number(cfg.gap) || 0);
  const n = slots.length;
  const capGroups = [];
  slots.forEach((s, i) => {
    const mod = new THREE.Group();
    mod.position.x = i * pitch;
    const isEnd = i === 0 || i === n - 1;
    const geo = isEnd || !kit.hasMid ? kit.baseEnd : kit.baseMid;
    const base = new THREE.Mesh(geo, mat(s.frame));
    base.castShadow = base.receiveShadow = true;
    let flip = i === n - 1 && n > 1;
    if (cfg.flipEnds) flip = !flip;
    if (isEnd && flip) base.rotation.y = Math.PI;
    base.userData = { slot: i, part: 'frame' };
    registry.set('s' + i + ':frame', base);
    mod.add(base);

    const capG = new THREE.Group();
    // face the letter outwards (+Y)
    if (kit.faceSign < 0) capG.rotation.x = Math.PI;
    const turn = new THREE.Group();
    turn.rotation.y = ((Number(cfg.letterRotation) || 0) * Math.PI) / 180;
    turn.add(capG);
    turn.position.y = kit.frame.top + (Number(cfg.capOffset) || 0) - kit.capHalf;
    const capMesh = new THREE.Mesh(kit.cap, mat(opts.cap && opts.cap.hex));
    capMesh.castShadow = capMesh.receiveShadow = true;
    capMesh.userData = { slot: i, part: 'cap' };
    registry.set('s' + i + ':cap', capMesh);
    capG.add(capMesh);
    const L = kit.letters.get(s.char);
    if (L) {
      const lm = new THREE.Mesh(L.geometry, mat(s.letter));
      lm.applyMatrix4(tmpM.copy(L.rel));
      lm.castShadow = true;
      lm.userData = { slot: i, part: 'letter' };
      registry.set('s' + i + ':letter', lm);
      capG.add(lm);
    }
    turn.userData.rest = turn.position.y;
    capGroups.push(turn);
    mod.add(turn);
    chain.add(mod);
  });

  // key ring tab on the top frame
  if (n) {
    const ringR = kit.frame.h * 0.17;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, ringR * 0.42, 16, 40), mat(slots[0].frame));
    ring.rotation.x = Math.PI / 2; // hole axis = face normal
    ring.position.set(-kit.frame.w / 2 - ringR * 0.55, kit.frame.top * 0.1, 0);
    ring.castShadow = true;
    ring.userData = { slot: 0, part: 'frame' };
    registry.set('ring', ring);
    chain.add(ring);
  }

  // map module space to world: chain runs top → bottom, faces toward the camera
  const world = new THREE.Group();
  chain.applyMatrix4(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0)
  ));
  world.add(chain);

  if (opts.cord && n) {
    const cord = buildCord(kit, n, pitch, opts.cord.hex);
    cord.traverse((m) => { if (m.isMesh) { m.userData = { part: 'cord' }; registry.set('cord:' + registry.size, m); } });
    world.add(cord);
  }
  return { group: world, registry, caps: capGroups };
}

function buildCord(kit, n, pitch, hex) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex || '#eeeeee'), roughness: 0.9 });
  const W = kit.frame.w;
  const ringTop = W / 2 + kit.frame.h * 0.17 * 1.3; // world y of the ring (chain starts at y=0 going down)
  const H = Math.max((n - 1) * pitch + W, W * 2.2);
  const x0 = kit.frame.h * 0.55 + 6;
  const r = 2.1;
  const yTop = ringTop + 4;
  const yKnot = yTop - H * 0.55;
  const pts = [
    [0, ringTop, 0], [x0 * 0.35, yTop + 6, 0], [x0 * 0.85, yTop + 3, 1], [x0 + 2, yTop - H * 0.2, 1.5],
    [x0 + 3, yKnot, 1], [x0 + 3.5, yKnot - H * 0.22, 0], [x0 + 1, yKnot - H * 0.3, -1.5],
    [x0 - 2, yKnot - H * 0.22, -1], [x0 - 1, yKnot, -1], [x0 - 2, yTop - H * 0.2, -1.5],
    [x0 * 0.6, yTop - 2, -1], [x0 * 0.15, ringTop - 1, -0.5],
  ].map((p) => new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 220, r, 10, true), m);
  tube.castShadow = true;
  g.add(tube);
  // knot wraps
  for (let k = 0; k < 5; k++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(4.2, r * 0.95, 10, 28), m);
    t.rotation.x = Math.PI / 2;
    t.position.set(x0 + 0.8, yKnot + 8 - k * 3.1, 0);
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

/** Sound for pressing a key (WebAudio, no files). */
let actx = null;
export function clickSound() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const buf = actx.createBuffer(1, actx.sampleRate * 0.03, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const gn = actx.createGain(); gn.gain.value = 0.6;
    src.connect(f).connect(gn).connect(actx.destination);
    src.start(t);
  } catch (e) { /* no audio */ }
}
