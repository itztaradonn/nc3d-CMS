// Shared helpers for content.json (public site + admin)
export async function loadContent(url) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) throw new Error('content ' + res.status);
  const c = await res.json();
  c.site = c.site || {};
  c.colors = c.colors || [];
  c.models = c.models || [];
  return c;
}

export function tr(v, lang) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] || v.th || v.en || '';
}

export function applyTheme(theme) {
  if (!theme) return;
  const r = document.documentElement.style;
  const map = { primary: '--primary', background: '--bg', surface: '--surface', text: '--text', stage: '--stage' };
  for (const [k, v] of Object.entries(map)) {
    if (theme[k] && /^#[0-9a-f]{3,8}$/i.test(theme[k])) r.setProperty(v, theme[k]);
  }
}

export function colorById(content, id) {
  return content.colors.find((c) => c.id === id) || null;
}

export function zoneColors(content, zone) {
  if (zone.colors && zone.colors.length) {
    return zone.colors.map((id) => colorById(content, id)).filter(Boolean);
  }
  return content.colors.slice();
}

/**
 * Turn a model's saved mapping + the parts found in the 3MF into zones with mesh keys.
 * Mesh mapping is by key; if a key no longer exists (file re-exported) we fall back to the part name.
 * If the model has no zones yet, every part becomes its own zone so new uploads work instantly.
 */
export function resolveZones(model, parts) {
  const meshes = model.meshes || {};
  const byName = {};
  for (const [k, v] of Object.entries(meshes)) if (v && v.name) byName[v.name] = v;
  const zones = (model.zones || []).map((z) => ({ ...z, keys: [] }));
  const zoneMap = Object.fromEntries(zones.map((z) => [z.id, z]));
  const fixed = [];
  const auto = !zones.length;
  for (const p of parts) {
    const m = meshes[p.key] || byName[p.name];
    if (auto) {
      zones.push({ id: 'p' + zones.length, label: { th: p.name, en: p.name }, colors: [], default: null, keys: [p.key] });
      continue;
    }
    if (!m) continue;
    if (m.hidden) { fixed.push({ key: p.key, hidden: true }); continue; }
    if (m.zone && zoneMap[m.zone]) zoneMap[m.zone].keys.push(p.key);
    else if (m.color) fixed.push({ key: p.key, color: m.color });
  }
  return { zones: zones.filter((z) => z.keys.length), fixed };
}
