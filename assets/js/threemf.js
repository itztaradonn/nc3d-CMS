// NC3D 3MF parser.
// Supports core 3MF, components, build transforms, base materials / color groups,
// and the Production extension (multi-file models from Bambu Studio / OrcaSlicer / PrusaSlicer).
// Returns one entry per printable mesh instance so each part can be colored separately.
import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

function byLocal(root, name) {
  return Array.from(root.getElementsByTagNameNS('*', name));
}
function childrenByLocal(el, name) {
  return Array.from(el.children).filter((c) => c.localName === name);
}
function attrAny(el, name) {
  // attribute may be namespaced (p:path) — match by local name
  if (el.hasAttribute(name)) return el.getAttribute(name);
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name) return a.value;
  }
  return null;
}
function normPath(p) {
  if (!p) return null;
  return p.replace(/^\/+/, '');
}
function parseTransform(str) {
  const m = new THREE.Matrix4();
  if (!str) return m;
  const v = str.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((n) => Number.isNaN(n))) return m;
  // 3MF uses row vectors: p' = p * M
  m.set(
    v[0], v[3], v[6], v[9],
    v[1], v[4], v[7], v[10],
    v[2], v[5], v[8], v[11],
    0, 0, 0, 1
  );
  return m;
}
function normColor(c) {
  if (!c) return null;
  const s = c.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return s.slice(0, 7).toLowerCase();
  return null;
}

function parseConfigXml(files) {
  // Bambu/Orca: Metadata/model_settings.config holds part names + extruder index
  const out = { objects: {} };
  const key = Object.keys(files).find((k) => /metadata\/model_settings\.config$/i.test(k));
  if (!key) return out;
  try {
    const doc = new DOMParser().parseFromString(strFromU8(files[key]), 'application/xml');
    for (const obj of byLocal(doc, 'object')) {
      const id = obj.getAttribute('id');
      const info = { name: null, extruder: null, parts: {} };
      for (const md of childrenByLocal(obj, 'metadata')) {
        if (md.getAttribute('key') === 'name') info.name = md.getAttribute('value');
        if (md.getAttribute('key') === 'extruder') info.extruder = parseInt(md.getAttribute('value'), 10);
      }
      for (const part of childrenByLocal(obj, 'part')) {
        const p = { name: null, subtype: part.getAttribute('subtype') || 'normal_part', extruder: null, text: null };
        const ti = childrenByLocal(part, 'text_info')[0];
        if (ti) p.text = ti.getAttribute('text');
        for (const md of childrenByLocal(part, 'metadata')) {
          if (md.getAttribute('key') === 'name') p.name = md.getAttribute('value');
          if (md.getAttribute('key') === 'extruder') p.extruder = parseInt(md.getAttribute('value'), 10);
        }
        info.parts[part.getAttribute('id')] = p;
      }
      out.objects[id] = info;
    }
  } catch (e) { /* ignore */ }
  return out;
}

function parseFilamentColors(files) {
  const key = Object.keys(files).find((k) => /metadata\/project_settings\.config$/i.test(k));
  if (!key) return [];
  try {
    const j = JSON.parse(strFromU8(files[key]));
    const arr = j.filament_colour || j.filament_color || [];
    return Array.isArray(arr) ? arr.map(normColor) : [];
  } catch (e) { return []; }
}

function parseModelDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid 3MF XML');
  const materials = {}; // id -> [hex]
  for (const bm of byLocal(doc, 'basematerials')) {
    materials[bm.getAttribute('id')] = childrenByLocal(bm, 'base').map((b) => normColor(b.getAttribute('displaycolor')));
  }
  for (const cg of byLocal(doc, 'colorgroup')) {
    materials[cg.getAttribute('id')] = childrenByLocal(cg, 'color').map((c) => normColor(c.getAttribute('color')));
  }
  const objects = {};
  const resources = byLocal(doc, 'resources')[0];
  const objEls = resources ? childrenByLocal(resources, 'object') : byLocal(doc, 'object');
  for (const o of objEls) {
    const id = o.getAttribute('id');
    const obj = {
      id,
      name: o.getAttribute('name') || null,
      type: o.getAttribute('type') || 'model',
      pid: o.getAttribute('pid'),
      pindex: o.getAttribute('pindex'),
      mesh: null,
      components: [],
    };
    const meshEl = childrenByLocal(o, 'mesh')[0];
    if (meshEl) {
      const vertsEl = childrenByLocal(meshEl, 'vertices')[0];
      const trisEl = childrenByLocal(meshEl, 'triangles')[0];
      const vEls = vertsEl ? vertsEl.children : [];
      const tEls = trisEl ? trisEl.children : [];
      const pos = new Float32Array(vEls.length * 3);
      for (let i = 0; i < vEls.length; i++) {
        const v = vEls[i];
        pos[i * 3] = parseFloat(v.getAttribute('x'));
        pos[i * 3 + 1] = parseFloat(v.getAttribute('y'));
        pos[i * 3 + 2] = parseFloat(v.getAttribute('z'));
      }
      const idx = new Uint32Array(tEls.length * 3);
      let firstTriColor = null;
      for (let i = 0; i < tEls.length; i++) {
        const t = tEls[i];
        idx[i * 3] = +t.getAttribute('v1');
        idx[i * 3 + 1] = +t.getAttribute('v2');
        idx[i * 3 + 2] = +t.getAttribute('v3');
        if (i === 0 && t.hasAttribute('pid')) {
          firstTriColor = { pid: t.getAttribute('pid'), p: t.getAttribute('p1') || '0' };
        }
      }
      obj.mesh = { pos, idx, firstTriColor };
    }
    const compsEl = childrenByLocal(o, 'components')[0];
    if (compsEl) {
      for (const c of childrenByLocal(compsEl, 'component')) {
        obj.components.push({
          objectid: c.getAttribute('objectid'),
          path: normPath(attrAny(c, 'path')),
          transform: parseTransform(c.getAttribute('transform')),
        });
      }
    }
    objects[id] = obj;
  }
  const items = [];
  const buildEl = byLocal(doc, 'build')[0];
  if (buildEl) {
    for (const it of childrenByLocal(buildEl, 'item')) {
      items.push({
        objectid: it.getAttribute('objectid'),
        path: normPath(attrAny(it, 'path')),
        transform: parseTransform(it.getAttribute('transform')),
      });
    }
  }
  return { materials, objects, items };
}

function findRootModel(files) {
  const rels = Object.keys(files).find((k) => /^_rels\/\.rels$/i.test(k));
  if (rels) {
    const m = strFromU8(files[rels]).match(/Target="([^"]+\.model)"/i);
    if (m) {
      const p = normPath(m[1]);
      const hit = Object.keys(files).find((k) => k.toLowerCase() === p.toLowerCase());
      if (hit) return hit;
    }
  }
  return Object.keys(files).find((k) => /^3d\/[^/]+\.model$/i.test(k))
    || Object.keys(files).find((k) => /\.model$/i.test(k));
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {{ parts: Array<{key:string,name:string,geometry:THREE.BufferGeometry,matrix:THREE.Matrix4,color:string|null}> }}
 */
export function parse3MF(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const rootPath = findRootModel(files);
  if (!rootPath) throw new Error('No 3D model found in 3MF');
  const lookup = (p) => Object.keys(files).find((k) => k.toLowerCase() === p.toLowerCase());

  const docs = {};
  const getDoc = (p) => {
    const real = lookup(p);
    if (!real) return null;
    if (!docs[real]) docs[real] = parseModelDoc(strFromU8(files[real]));
    return docs[real];
  };
  const config = parseConfigXml(files);
  const filament = parseFilamentColors(files);
  const geoCache = new Map();
  const parts = [];
  const nameCount = {};

  function objColor(doc, obj) {
    let pid = obj.pid; let p = obj.pindex;
    if ((pid == null) && obj.mesh && obj.mesh.firstTriColor) { pid = obj.mesh.firstTriColor.pid; p = obj.mesh.firstTriColor.p; }
    if (pid != null && doc.materials[pid]) return doc.materials[pid][+(p || 0)] || null;
    return null;
  }
  function geometryFor(path, obj) {
    const k = path + '#' + obj.id;
    if (geoCache.has(k)) return geoCache.get(k);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(obj.mesh.pos, 3));
    g.setIndex(new THREE.BufferAttribute(obj.mesh.idx, 1));
    // keep sharp print edges crisp, curved surfaces smooth
    const out = toCreasedNormals(g, Math.PI / 6);
    g.dispose();
    geoCache.set(k, out);
    return out;
  }

  function walk(path, objectId, matrix, keyChain, ctx, depth) {
    if (depth > 16) return;
    const doc = getDoc(path);
    if (!doc) return;
    const obj = doc.objects[objectId];
    if (!obj) return;
    if (obj.type === 'support' || obj.type === 'solidsupport') return;
    const key = keyChain + '>' + objectId;
    if (obj.mesh && obj.mesh.idx.length) {
      let name = ctx.partName || obj.name || ctx.objName || null;
      let color = objColor(doc, obj);
      if (!color && ctx.extruder && filament[ctx.extruder - 1]) color = filament[ctx.extruder - 1];
      if (!name) name = 'Part';
      nameCount[name] = (nameCount[name] || 0) + 1;
      parts.push({ key, name, geometry: geometryFor(path, obj), matrix: matrix.clone(), color, text: ctx.text || null, objectName: ctx.objName || null, item: ctx.item });
    }
    for (const c of obj.components) {
      const childPath = c.path || path;
      const m = matrix.clone().multiply(c.transform);
      let next = { ...ctx };
      if (ctx.topId && config.objects[ctx.topId] && depth === 0) {
        const info = config.objects[ctx.topId].parts[c.objectid];
        if (info) {
          if (info.subtype && info.subtype !== 'normal_part') continue; // modifiers / negative parts
          next.partName = info.name || null;
          next.text = info.text || null;
          if (info.extruder) next.extruder = info.extruder;
        }
      }
      walk(childPath, c.objectid, m, key, next, depth + 1);
    }
  }

  const root = getDoc(rootPath);
  root.items.forEach((it, i) => {
    const info = config.objects[it.objectid];
    const ctx = {
      topId: it.objectid,
      objName: (info && info.name) || null,
      extruder: (info && info.extruder) || null,
      partName: null,
      text: null,
      item: i,
    };
    walk(it.path || rootPath, it.objectid, it.transform, 'i' + i, ctx, 0);
  });

  // make duplicate names unique for display
  const seen = {};
  for (const p of parts) {
    if (nameCount[p.name] > 1) {
      seen[p.name] = (seen[p.name] || 0) + 1;
      p.name = p.name + ' ' + seen[p.name];
    }
  }
  if (!parts.length) throw new Error('3MF contains no printable meshes');
  return { parts };
}
