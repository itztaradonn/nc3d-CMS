// NC3D public customizer
import { Viewer } from './viewer3d.js';
import { loadContent, tr, applyTheme, resolveZones, colorById, zoneColors } from './content.js';

const $ = (s) => document.querySelector(s);
const state = { content: null, lang: 'th', model: null, selection: {}, zones: [], parts: [], viewer: null };

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

function t(key) {
  const texts = (state.content.site && state.content.site.texts) || {};
  return tr(texts[key], state.lang) || key;
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
      btn.addEventListener('click', () => { state.selection[z.id] = c.id; applyZone(z); renderZones(); updateHash(); });
      btn.addEventListener('mouseenter', () => state.viewer.highlight(z.keys));
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
  for (const k of z.keys) state.viewer.setColor(k, c.hex, c.finish);
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
  const out = { model: h.get('m'), colors: {} };
  (h.get('c') || '').split(',').filter(Boolean).forEach((pair) => {
    const i = pair.lastIndexOf(':');
    if (i > 0) out.colors[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}
function updateHash() {
  if (!state.model) return;
  const c = Object.entries(state.selection).map(([z, col]) => encodeURIComponent(z) + ':' + encodeURIComponent(col)).join(',');
  history.replaceState(null, '', '#m=' + encodeURIComponent(state.model.id) + '&c=' + c);
}

let loadToken = 0;
async function selectModel(id, presetColors) {
  const m = visibleModels().find((x) => x.id === id) || visibleModels()[0];
  if (!m) return;
  state.model = m;
  const token = ++loadToken;
  $('#modelName').textContent = tr(m.name, state.lang);
  $('#modelPrice').textContent = tr(m.price, state.lang);
  $('#modelDesc').textContent = tr(m.description, state.lang);
  $('#zones').innerHTML = '';
  $('#stageError').hidden = true;
  $('#loader').hidden = false;
  $('#loaderBar').style.width = '0';
  renderGallery();
  try {
    const parts = await state.viewer.loadUrl(m.file, (p) => { $('#loaderBar').style.width = Math.round(p * 100) + '%'; });
    if (token !== loadToken) return;
    state.parts = parts;
    const r = resolveZones(m, parts);
    state.zones = r.zones;
    state.fixed = r.fixed;
    state.selection = defaultSelection();
    if (presetColors) {
      for (const z of state.zones) {
        const want = presetColors[z.id];
        if (want && zoneColors(state.content, z).some((c) => c.id === want)) state.selection[z.id] = want;
      }
    }
    applyAll();
    renderZones();
    updateHash();
  } catch (e) {
    if (token !== loadToken) return;
    $('#stageError').textContent = e.message || String(e);
    $('#stageError').hidden = false;
  } finally {
    if (token === loadToken) $('#loader').hidden = true;
  }
}

function summaryText() {
  const m = state.model;
  const lines = [t('summaryTitle') + ' — ' + (state.content.site.name || 'NC3D'), tr(m.name, state.lang)];
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
    renderStatic(); renderGallery(); renderZones();
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
  $('#btnReset').addEventListener('click', () => { state.selection = defaultSelection(); applyAll(); renderZones(); updateHash(); });
  $('#btnRandom').addEventListener('click', () => {
    for (const z of state.zones) {
      const list = zoneColors(state.content, z);
      if (list.length) state.selection[z.id] = list[Math.floor(Math.random() * list.length)].id;
    }
    applyAll(); renderZones(); updateHash();
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
  selectModel(h.model, h.colors);
}

main().catch((e) => {
  document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px;color:#b42318">Cannot load site data</p>');
  console.error(e);
});
