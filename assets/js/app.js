// NC3D public customizer
import { Viewer } from './viewer3d.js';
import { ClickerUI } from './clicker-ui.js';
import { loadContent, tr, applyTheme, resolveZones, colorById, zoneColors, paletteSelection } from './content.js';

const $ = (s) => document.querySelector(s);
const state = { content: null, lang: 'th', model: null, selection: {}, zones: [], fixed: [], parts: [], viewer: null, mode: 'palette', palette: null, clicker: null };

// fallback texts for keys an older content.json may not have yet
const DEFAULT_TEXTS = {
  paletteTab: { th: 'ชุดสีสำเร็จ', en: 'Palettes' },
  partsTab: { th: 'เลือกแต่ละชิ้น', en: 'Per part' },
  loadError: { th: 'โหลดโมเดลไม่สำเร็จ แต่ยังเลือกสีได้', en: 'Model failed to load, colors still selectable' },
};

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

function t(key) {
  const texts = (state.content.site && state.content.site.texts) || {};
  return tr(texts[key], state.lang) || tr(DEFAULT_TEXTS[key], state.lang) || key;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function copyText(text) {
  // synchronous copy first (keeps working when a new tab steals focus)
  let ok = false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    ok = document.execCommand('copy');
    ta.remove();
  } catch (e) { ok = false; }
  if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  return true;
}

function renderStatic() {
  const s = state.content.site;
  document.documentElement.lang = state.lang;
  document.title = s.name || 'NC3D';
  $('#brandName').textContent = s.name || 'NC3D';
  const logo = $('#brandLogo');
  if (s.logo) { logo.src = s.logo; logo.alt = s.name || ''; logo.hidden = false; $('#brandName').hidden = !!s.logoHideName; }
  else { logo.hidden = true; $('#brandName').hidden = false; }
  if (s.favicon) $('#favicon').href = s.favicon;
  $('#tagline').textContent = tr(s.tagline, state.lang);
  $('#intro').textContent = tr(s.intro, state.lang);
  $('#footer').textContent = tr(s.footer, state.lang);
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === state.lang));
}

function visibleModels() {
  return (state.content.models || []).filter((m) => m.visible !== false);
}

function renderGallery() {
  const g = $('#gallery');
  g.innerHTML = '';
  const list = visibleModels();
  if (!list.length) { g.innerHTML = '<p class="empty"></p>'; g.firstChild.textContent = t('noModels'); return; }
  for (const m of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card' + (state.model && state.model.id === m.id ? ' on' : '');
    const th = document.createElement('div');
    th.className = 'thumb';
    if (m.thumbnail) { const img = new Image(); img.src = m.thumbnail; img.alt = ''; img.loading = 'lazy'; th.appendChild(img); }
    else th.textContent = (tr(m.name, state.lang) || '?').slice(0, 2).toUpperCase();
    const name = document.createElement('b'); name.textContent = tr(m.name, state.lang);
    const price = document.createElement('small'); price.textContent = tr(m.price, state.lang);
    b.append(th, name, price);
    b.addEventListener('click', () => {
      selectModel(m.id);
      $('#stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    g.appendChild(b);
  }
}

function renderPanel() {
  const pals = state.content.palettes;
  const hasPal = pals.length > 0 && state.zones.length > 0;
  const mode = hasPal ? state.mode : 'parts';
  $('#modeTabs').hidden = !hasPal;
  document.querySelectorAll('#modeTabs button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('#palettes').hidden = mode !== 'palette';
  $('#zones').hidden = mode !== 'parts';
  renderPalettes();
  renderZones();
}

function renderPalettes() {
  const wrap = $('#palettes');
  wrap.innerHTML = '';
  for (const p of state.content.palettes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pal' + (state.palette === p.id ? ' on' : '');
    const dots = document.createElement('div'); dots.className = 'dots';
    for (const id of p.colors) {
      const c = colorById(state.content, id);
      if (!c) continue;
      const i = document.createElement('i'); i.style.background = c.hex; i.title = tr(c.name, state.lang);
      dots.appendChild(i);
    }
    const name = document.createElement('b'); name.textContent = tr(p.name, state.lang);
    b.append(dots, name);
    b.addEventListener('click', () => {
      state.palette = p.id;
      state.selection = paletteSelection(state.content, p, state.zones, state.selection);
      applyAll(); renderPanel(); updateHash();
    });
    wrap.appendChild(b);
  }
}

function renderZones() {
  const wrap = $('#zones');
  wrap.innerHTML = '';
  for (const z of state.zones) {
    const sec = document.createElement('div');
    sec.className = 'zone';
    const head = document.createElement('div'); head.className = 'zone-head';
    const lb = document.createElement('b'); lb.textContent = tr(z.label, state.lang);
    const cur = document.createElement('span');
    const sel = colorById(state.content, state.selection[z.id]);
    cur.textContent = sel ? tr(sel.name, state.lang) : '';
    head.append(lb, cur);
    const sw = document.createElement('div'); sw.className = 'swatches';
    for (const c of zoneColors(state.content, z)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch f-' + (c.finish || 'standard') + (state.selection[z.id] === c.id ? ' on' : '');
      btn.style.backgroundColor = c.hex;
      btn.title = tr(c.name, state.lang);
      btn.setAttribute('aria-label', tr(z.label, state.lang) + ': ' + tr(c.name, state.lang));
      btn.addEventListener('click', () => { state.selection[z.id] = c.id; state.palette = null; applyZone(z); renderZones(); updateHash(); });
      btn.addEventListener('mouseenter', () => state.viewer.highlight(z.keys || []));
      btn.addEventListener('mouseleave', () => state.viewer.highlight([]));
      sw.appendChild(btn);
    }
    sec.append(head, sw);
    wrap.appendChild(sec);
  }
}

function applyZone(z) {
  const c = colorById(state.content, state.selection[z.id]);
  if (!c) return;
  for (const k of (z.keys || [])) state.viewer.setColor(k, c.hex, c.finish);
}

function applyAll() {
  // fixed / hidden meshes
  for (const f of state.fixed) {
    if (f.hidden) state.viewer.setVisible(f.key, false);
    else if (f.color) {
      const c = colorById(state.content, f.color);
      if (c) state.viewer.setColor(f.key, c.hex, c.finish);
    }
  }
  state.zones.forEach(applyZone);
}

function defaultSelection() {
  const sel = {};
  for (const z of state.zones) {
    const list = zoneColors(state.content, z);
    sel[z.id] = (z.default && list.some((c) => c.id === z.default)) ? z.default : (list[0] && list[0].id);
  }
  return sel;
}

function parseHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const out = { model: h.get('m'), colors: {}, clicker: ClickerUI.parsePreset(h) };
  (h.get('c') || '').split(',').filter(Boolean).forEach((pair) => {
    const i = pair.lastIndexOf(':');
    if (i > 0) out.colors[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}
function updateHash() {
  if (!state.model) return;
  if (state.clicker && state.clicker.model === state.model) {
    history.replaceState(null, '', '#m=' + encodeURIComponent(state.model.id) + '&' + state.clicker.hashParams());
    return;
  }
  const c = Object.entries(state.selection).map(([z, col]) => encodeURIComponent(z) + ':' + encodeURIComponent(col)).join(',');
  history.replaceState(null, '', '#m=' + encodeURIComponent(state.model.id) + '&c=' + c);
}

let loadToken = 0;
function showStandardPanel(on) {
  $('#clickerPanel').hidden = on;
  if (on) { $('#modeTabs').hidden = true; }
  else { $('#modeTabs').hidden = true; $('#palettes').hidden = true; $('#zones').hidden = true; }
}

async function selectClicker(m, preset, token) {
  showStandardPanel(false);
  $('#panelNote').hidden = true;
  $('#stageError').hidden = true;
  $('#loader').hidden = false;
  $('#loaderBar').style.width = '0';
  renderGallery();
  if (!state.clicker) {
    state.clicker = new ClickerUI({
      viewer: state.viewer, content: state.content, root: $('#clickerPanel'),
      getLang: () => state.lang, t, onChange: () => updateHash(),
    });
  }
  try {
    await state.clicker.load(m, preset, (p) => { $('#loaderBar').style.width = Math.round(p * 100) + '%'; });
    if (token !== loadToken) return;
    updateHash();
  } catch (e) {
    if (token !== loadToken) return;
    $('#stageError').textContent = e.message || String(e);
    $('#stageError').hidden = false;
  } finally {
    if (token === loadToken) $('#loader').hidden = true;
  }
}

async function selectModel(id, presetColors, clickerPreset) {
  const m = visibleModels().find((x) => x.id === id) || visibleModels()[0];
  if (!m) return;
  state.model = m;
  const token = ++loadToken;
  $('#modelName').textContent = tr(m.name, state.lang);
  $('#modelPrice').textContent = tr(m.price, state.lang);
  $('#modelDesc').textContent = tr(m.description, state.lang);
  if (m.type === 'nameclicker') { selectClicker(m, clickerPreset, token); return; }
  if (state.clicker) { state.clicker.destroy(); state.clicker = null; }
  showStandardPanel(true);
  // show color choices right away (from saved zones), even before / if the 3D file fails
  state.zones = (m.zones || []).map((z) => ({ ...z, keys: [] }));
  state.fixed = [];
  state.palette = null;
  state.selection = defaultSelection();
  applyPreset(presetColors);
  $('#panelNote').hidden = true;
  renderPanel();
  $('#stageError').hidden = true;
  $('#loader').hidden = false;
  $('#loaderBar').style.width = '0';
  renderGallery();
  try {
    const parts = await state.viewer.loadUrl(m.file, (p) => { $('#loaderBar').style.width = Math.round(p * 100) + '%'; });
    if (token !== loadToken) return;
    state.parts = parts;
    let r = resolveZones(m, parts);
    // saved mapping doesn't match this file (e.g. 3MF replaced) → one zone per part
    if (!r.zones.length && parts.length) r = resolveZones({ zones: [], meshes: {} }, parts);
    const prev = state.selection;
    state.zones = r.zones;
    state.fixed = r.fixed;
    state.selection = defaultSelection();
    for (const z of state.zones) if (prev[z.id]) state.selection[z.id] = prev[z.id];
    applyAll();
    renderPanel();
    updateHash();
  } catch (e) {
    if (token !== loadToken) return;
    $('#stageError').textContent = e.message || String(e);
    $('#stageError').hidden = false;
    $('#panelNote').textContent = t('loadError');
    $('#panelNote').hidden = !state.zones.length;
    if (!state.zones.length) { $('#panelNote').textContent = e.message || String(e); $('#panelNote').hidden = false; }
  } finally {
    if (token === loadToken) $('#loader').hidden = true;
  }
}

function applyPreset(presetColors) {
  if (!presetColors) return;
  for (const z of state.zones) {
    const want = presetColors[z.id];
    if (want && zoneColors(state.content, z).some((c) => c.id === want)) state.selection[z.id] = want;
  }
}

function isClicker() { return state.clicker && state.clicker.model === state.model && state.clicker.kit; }

function summaryText() {
  const m = state.model;
  const lines = [t('summaryTitle') + ' — ' + (state.content.site.name || 'NC3D'), tr(m.name, state.lang)];
  if (isClicker()) { lines.push(...state.clicker.summaryLines(), location.href); return lines.join('\n'); }
  const pal = state.content.palettes.find((p) => p.id === state.palette);
  if (pal) lines.push(t('paletteTab') + ': ' + tr(pal.name, state.lang));
  for (const z of state.zones) {
    const c = colorById(state.content, state.selection[z.id]);
    lines.push('• ' + tr(z.label, state.lang) + ': ' + (c ? tr(c.name, state.lang) : '-'));
  }
  lines.push(location.href);
  return lines.join('\n');
}

function bind() {
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
    state.lang = b.dataset.lang; lsSet('nc3d-lang', state.lang);
    renderStatic(); renderGallery();
    if (isClicker()) state.clicker.render(); else renderPanel();
    if (state.model) {
      $('#modelName').textContent = tr(state.model.name, state.lang);
      $('#modelPrice').textContent = tr(state.model.price, state.lang);
      $('#modelDesc').textContent = tr(state.model.description, state.lang);
    }
  }));
  const rot = $('#btnRotate');
  rot.addEventListener('click', () => {
    const on = rot.getAttribute('aria-pressed') !== 'true';
    rot.setAttribute('aria-pressed', String(on));
    state.viewer.setAutoRotate(on);
  });
  state.viewer.controls.addEventListener('start', () => rot.setAttribute('aria-pressed', 'false'));
  $('#btnFit').addEventListener('click', () => state.viewer.fit());
  $('#btnReset').addEventListener('click', () => { if (isClicker()) { state.clicker.reset(); return; } state.selection = defaultSelection(); state.palette = null; applyAll(); renderPanel(); updateHash(); });
  document.querySelectorAll('#modeTabs button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; renderPanel(); }));
  $('#btnRandom').addEventListener('click', () => {
    if (isClicker()) { state.clicker.randomize(); return; }
    for (const z of state.zones) {
      const list = zoneColors(state.content, z);
      if (list.length) state.selection[z.id] = list[Math.floor(Math.random() * list.length)].id;
    }
    state.palette = null;
    applyAll(); renderPanel(); updateHash();
  });
  $('#btnShot').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = state.viewer.snapshot();
    a.download = (state.model ? state.model.id : 'nc3d') + '.png';
    a.click();
  });
  $('#btnShare').addEventListener('click', () => { copyText(location.href); toast(t('linkCopied')); });
  $('#btnOrder').addEventListener('click', () => {
    if (!state.model) return;
    copyText(summaryText());
    toast(t('copied'));
    const s = state.content.site;
    const url = (s.orderTarget === 'facebook' ? s.facebookUrl : s.messengerUrl) || s.facebookUrl || s.messengerUrl;
    if (url) window.open(url, '_blank', 'noopener');
  });
}

async function main() {
  state.content = await loadContent('data/content.json');
  const saved = lsGet('nc3d-lang');
  state.lang = (saved === 'th' || saved === 'en') ? saved : (state.content.site.defaultLang || 'th');
  applyTheme(state.content.site.theme);
  state.viewer = new Viewer($('#stage'), { autoRotate: true });
  renderStatic();
  bind();
  const h = parseHash();
  renderGallery();
  selectModel(h.model, h.colors, h.clicker);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px;color:#b42318">Cannot load site data</p>');
  console.error(e);
});
