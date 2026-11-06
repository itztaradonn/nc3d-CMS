// NC3D admin panel
import { Viewer } from '../assets/js/viewer3d.js';
import { loadContent, tr, resolveZones, colorById, zoneColors } from '../assets/js/content.js';

const CSRF = document.querySelector('meta[name=csrf]').content;
const UPLOAD_LIMIT = +document.querySelector('meta[name=upload-limit]').content || 0;
const app = document.getElementById('app');
let content = null;
let tab = 'models';
let viewer = null;

// ---------- helpers ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const url = (p) => (p ? '../' + p : '');
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, err ? 5000 : 2200);
}
async function api(action, fields = {}, file) {
  const fd = new FormData();
  fd.append('action', action);
  for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  if (file) fd.append('file', file);
  let res;
  try {
    res = await fetch('api.php', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': CSRF }, credentials: 'same-origin' });
  } catch (e) { throw new Error('Network error'); }
  let j = null;
  try { j = await res.json(); } catch (e) { /* not json */ }
  if (res.status === 401) { location.reload(); throw new Error('Logged out'); }
  if (!j) throw new Error(res.status === 413 ? 'File too large for server' : 'Server error ' + res.status + ' (PHP may not run on this host)');
  if (!j.ok) throw new Error(j.error || 'Error');
  if (j.content) content = j.content;
  return j;
}
function fmtMB(b) { return (b / 1048576).toFixed(0) + ' MB'; }
function i18nField(label, obj, key, opts = {}) {
  obj[key] = obj[key] && typeof obj[key] === 'object' ? obj[key] : { th: obj[key] || '', en: obj[key] || '' };
  const mk = (lang) => {
    const attrs = { class: 'inp', value: obj[key][lang] || '', oninput: (e) => { obj[key][lang] = e.target.value; opts.onChange && opts.onChange(); } };
    const input = opts.multiline ? el('textarea', attrs) : el('input', { type: 'text', ...attrs });
    if (opts.multiline) input.value = obj[key][lang] || '';
    return el('label', { 'data-lang': lang.toUpperCase() }, input);
  };
  return el('div', { class: 'field' }, el('span', {}, label), el('div', { class: 'i18n' }, mk('th'), mk('en')));
}
function textField(label, obj, key, type = 'text', hint) {
  return el('label', { class: 'field' }, el('span', {}, label),
    el('input', { type, value: obj[key] || '', oninput: (e) => { obj[key] = e.target.value; } }),
    hint ? el('p', { class: 'hint' }, hint) : null);
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const i = el('input', { type: 'file', accept, style: 'display:none' });
    i.addEventListener('change', () => { resolve(i.files[0] || null); i.remove(); });
    document.body.append(i); i.click();
  });
}
async function uploadFile(file, kind) {
  if (UPLOAD_LIMIT && file.size > UPLOAD_LIMIT) {
    throw new Error('File ' + fmtMB(file.size) + ' > server limit ' + fmtMB(UPLOAD_LIMIT) + '. Raise upload_max_filesize & post_max_size in DirectAdmin → PHP settings.');
  }
  const j = await api('upload', { kind }, file);
  return j.path;
}
function nearestColor(hex) {
  if (!hex || !content.colors.length) return content.colors[0] ? content.colors[0].id : null;
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex);
  let best = null; let bd = Infinity;
  for (const c of content.colors) {
    const b = p(c.hex);
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < bd) { bd = d; best = c.id; }
  }
  return best;
}

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  render();
}));

function render() {
  if (viewer) { viewer.destroy(); viewer = null; }
  app.innerHTML = '';
  if (tab === 'models') renderModels();
  else if (tab === 'colors') renderColors();
  else if (tab === 'site') renderSite();
  else if (tab === 'texts') renderTexts();
  else if (tab === 'account') renderAccount();
}

// ---------- models ----------
function renderModels() {
  app.append(
    el('div', { class: 'row spread' },
      el('div', {}, el('h2', {}, 'Models / โมเดล'), el('p', { class: 'muted' }, 'Upload .3mf, set color zones, show on site. อัปโหลด .3mf แล้วกำหนดโซนสี')),
      el('button', { class: 'btn primary', onclick: () => openEditor(null) }, '+ Add model / เพิ่มโมเดล'))
  );
  const list = el('div', { class: 'mlist' });
  if (!content.models.length) list.append(el('p', { class: 'muted' }, 'No models yet. ยังไม่มีโมเดล'));
  content.models.forEach((m, i) => {
    const th = el('div', { class: 'th' }, m.thumbnail ? el('img', { src: url(m.thumbnail), alt: '' }) : (tr(m.name, 'en') || '?').slice(0, 2));
    const move = async (d) => {
      const ids = content.models.map((x) => x.id);
      const j = i + d; if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await api('reorder_models', { data: ids }); render(); } catch (e) { toast(e.message, true); }
    };
    list.append(el('div', { class: 'mitem' + (m.visible === false ? ' hiddenm' : '') },
      th,
      el('div', { class: 'info' }, el('b', {}, tr(m.name, 'th') || m.id), el('small', {}, tr(m.name, 'en') + ' · ' + (m.zones || []).length + ' zones · ' + m.id)),
      el('label', { class: 'row small' }, el('input', { type: 'checkbox', checked: m.visible !== false, onchange: async (e) => {
        try { await api('toggle_model', { id: m.id, visible: e.target.checked ? '1' : '' }); render(); } catch (er) { toast(er.message, true); }
      } }), 'Show'),
      el('button', { class: 'btn small', title: 'Up', onclick: () => move(-1) }, '↑'),
      el('button', { class: 'btn small', title: 'Down', onclick: () => move(1) }, '↓'),
      el('button', { class: 'btn small', onclick: () => openEditor(m) }, 'Edit / แก้ไข'),
      el('button', { class: 'btn small danger', onclick: async () => {
        if (!confirm('Delete "' + tr(m.name, 'th') + '"? ลบโมเดลนี้?')) return;
        try { await api('delete_model', { id: m.id }); toast('Deleted'); render(); } catch (e) { toast(e.message, true); }
      } }, 'Delete')));
  });
  app.append(list);
}

function openEditor(model) {
  const isNew = !model;
  const d = model ? clone(model) : {
    id: '', visible: true, name: { th: '', en: '' }, description: { th: '', en: '' }, price: { th: '', en: '' },
    file: '', thumbnail: '', zones: [], meshes: {},
  };
  d.zones = d.zones || [];
  d.meshes = d.meshes && !Array.isArray(d.meshes) ? d.meshes : {};
  const originalId = model ? model.id : '';
  const newUploads = [];
  let parts = [];

  app.innerHTML = '';
  const left = el('div');
  const prevBox = el('div', { class: 'preview' }, el('div', { class: 'msg' }, 'Upload a .3mf file to preview\nอัปโหลดไฟล์ .3mf เพื่อดูตัวอย่าง'));
  app.append(
    el('div', { class: 'row spread' },
      el('h2', {}, isNew ? 'New model / เพิ่มโมเดล' : 'Edit model / แก้ไขโมเดล'),
      el('button', { class: 'btn', onclick: cancel }, '← Back')),
    el('div', { class: 'editor' }, left, prevBox)
  );
  if (viewer) { viewer.destroy(); viewer = null; }
  viewer = new Viewer(prevBox, { autoRotate: false });

  async function cancel() {
    for (const p of newUploads) { try { await api('delete_upload', { path: p }); } catch (e) { /* ignore */ } }
    render();
  }

  function preview() {
    if (!parts.length) return;
    // reset all meshes to file color, then apply mapping
    for (const p of parts) { viewer.setVisible(p.key, true); viewer.setColor(p.key, p.color || '#c8ccd4'); }
    const r = resolveZones(d, parts);
    for (const f of r.fixed) {
      if (f.hidden) viewer.setVisible(f.key, false);
      else { const c = colorById(content, f.color); if (c) viewer.setColor(f.key, c.hex, c.finish); }
    }
    for (const z of r.zones) {
      const list = zoneColors(content, z);
      const c = colorById(content, z.default) || list[0];
      if (c) for (const k of z.keys) viewer.setColor(k, c.hex, c.finish);
    }
  }

  async function loadPreview() {
    if (!d.file) return;
    const msg = prevBox.querySelector('.msg');
    if (msg) msg.textContent = 'Loading…';
    try {
      parts = await viewer.loadUrl(url(d.file));
      if (msg) msg.remove();
      // keep mapping for existing parts; auto-create zones for brand-new models
      if (!d.zones.length && !Object.keys(d.meshes).length) {
        parts.forEach((p, i) => {
          const zid = 'z' + (i + 1);
          d.zones.push({ id: zid, label: { th: p.name, en: p.name }, colors: [], default: nearestColor(p.color) });
          d.meshes[p.key] = { name: p.name, zone: zid };
        });
      } else {
        for (const p of parts) {
          if (!d.meshes[p.key]) {
            const byName = Object.values(d.meshes).find((m) => m.name === p.name);
            d.meshes[p.key] = byName ? { ...byName } : { name: p.name };
          }
          d.meshes[p.key].name = p.name;
        }
      }
      preview();
      drawLeft();
    } catch (e) {
      if (msg) msg.textContent = 'Cannot read 3MF: ' + e.message;
      else toast('Cannot read 3MF: ' + e.message, true);
    }
  }

  function drawLeft() {
    left.innerHTML = '';
    // --- basic info
    const info = el('div', { class: 'section' }, el('h3', {}, 'Info / ข้อมูล'),
      i18nField('Name / ชื่อ', d, 'name'),
      i18nField('Price text / ราคา (optional)', d, 'price'),
      i18nField('Description / รายละเอียด', d, 'description', { multiline: true }),
      el('div', { class: 'grid2' },
        el('label', { class: 'field' }, el('span', {}, 'ID (link name, a-z 0-9 -)'),
          el('input', { type: 'text', value: d.id, placeholder: 'auto', oninput: (e) => { d.id = e.target.value; } })),
        el('label', { class: 'field' }, el('span', {}, 'Visible / แสดง'),
          el('select', { onchange: (e) => { d.visible = e.target.value === '1'; } },
            el('option', { value: '1', selected: d.visible !== false }, 'Show / แสดง'),
            el('option', { value: '0', selected: d.visible === false }, 'Hide / ซ่อน'))))
    );
    left.append(info);

    // --- 3MF file
    const dz = el('div', { class: 'dropzone' },
      d.file ? el('div', {}, '✓ ', el('code', {}, d.file.split('/').pop())) : 'Drop .3mf here or click / ลากไฟล์ .3mf มาวาง หรือกดเลือก',
      el('div', { class: 'row', style: 'justify-content:center;margin-top:10px' },
        el('button', { class: 'btn', onclick: async () => { const f = await pickFile('.3mf'); if (f) doUpload(f); } }, d.file ? 'Replace 3MF / เปลี่ยนไฟล์' : 'Choose 3MF / เลือกไฟล์')),
      UPLOAD_LIMIT ? el('p', { class: 'hint' }, 'Server upload limit: ' + fmtMB(UPLOAD_LIMIT)) : null);
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) doUpload(f); });
    left.append(el('div', { class: 'section' }, el('h3', {}, '3MF file / ไฟล์โมเดล'), dz,
      el('p', { class: 'hint' }, 'Tip: in Bambu Studio / Orca / PrusaSlicer keep each colorable piece as a separate part or object, then Export → 3MF. ทิป: แยกชิ้นที่ต้องการให้เปลี่ยนสีเป็น part แยกกันก่อน export')));

    async function doUpload(f) {
      if (!/\.3mf$/i.test(f.name)) { toast('Only .3mf', true); return; }
      try {
        toast('Uploading… กำลังอัปโหลด');
        const path = await uploadFile(f, 'model');
        newUploads.push(path);
        const hadFile = !!d.file;
        d.file = path;
        if (!hadFile && !tr(d.name, 'th')) d.name = { th: f.name.replace(/\.3mf$/i, ''), en: f.name.replace(/\.3mf$/i, '') };
        await loadPreview();
        drawLeft();
        toast('Uploaded ✓');
      } catch (e) { toast(e.message, true); }
    }

    if (!parts.length) { left.append(saveBar()); return; }

    // --- zones
    const zonesSec = el('div', { class: 'section' }, el('h3', {}, 'Color zones / โซนสีที่ลูกค้าเลือกได้'),
      el('p', { class: 'hint', style: 'margin-bottom:10px' }, 'A zone = one color choice for the customer. Several parts can share one zone. No colors ticked = all colors allowed. โซน = จุดที่ลูกค้าเลือกสีได้ 1 จุด หลายชิ้นใช้โซนเดียวกันได้ ไม่ติ๊กสี = ใช้ได้ทุกสี'));
    d.zones.forEach((z, zi) => {
      const allowed = new Set(z.colors || []);
      const sw = el('div', { class: 'swrow' });
      for (const c of content.colors) {
        sw.append(el('button', {
          type: 'button', class: 'sw' + (allowed.has(c.id) ? ' on' : (allowed.size ? ' off' : '')),
          style: 'background:' + c.hex, title: tr(c.name, 'th') + ' / ' + tr(c.name, 'en'),
          onclick: () => {
            if (allowed.has(c.id)) allowed.delete(c.id); else allowed.add(c.id);
            z.colors = content.colors.map((x) => x.id).filter((id) => allowed.has(id));
            drawLeft(); preview();
          },
        }));
      }
      const defSel = el('select', { class: 'inp', onchange: (e) => { z.default = e.target.value; preview(); } },
        zoneColors(content, z).map((c) => el('option', { value: c.id, selected: z.default === c.id }, tr(c.name, 'th') + ' / ' + tr(c.name, 'en'))));
      const keys = Object.entries(d.meshes).filter(([, m]) => m.zone === z.id).map(([k]) => k);
      zonesSec.append(el('div', { class: 'zone', onmouseenter: () => viewer.highlight(keys), onmouseleave: () => viewer.highlight([]) },
        el('div', { class: 'row spread' }, el('b', {}, 'Zone ' + (zi + 1) + ' · ' + keys.length + ' part(s)'),
          el('button', { class: 'btn small danger', onclick: () => {
            d.zones.splice(zi, 1);
            for (const m of Object.values(d.meshes)) if (m.zone === z.id) delete m.zone;
            drawLeft(); preview();
          } }, 'Remove')),
        i18nField('Label shown to customer / ชื่อที่ลูกค้าเห็น', z, 'label'),
        el('div', { class: 'field' }, el('span', {}, 'Allowed colors / สีที่เลือกได้'), sw),
        el('label', { class: 'field' }, el('span', {}, 'Default color / สีเริ่มต้น'), defSel)));
    });
    zonesSec.append(el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => {
        let n = d.zones.length + 1; while (d.zones.some((z) => z.id === 'z' + n)) n++;
        d.zones.push({ id: 'z' + n, label: { th: 'โซน ' + n, en: 'Zone ' + n }, colors: [], default: content.colors[0] && content.colors[0].id });
        drawLeft();
      } }, '+ Add zone / เพิ่มโซน'),
      el('button', { class: 'btn', onclick: () => {
        if (!confirm('Reset: one zone per part? รีเซ็ตเป็น 1 ชิ้น = 1 โซน?')) return;
        d.zones = []; d.meshes = {};
        parts.forEach((p, i) => {
          d.zones.push({ id: 'z' + (i + 1), label: { th: p.name, en: p.name }, colors: [], default: nearestColor(p.color) });
          d.meshes[p.key] = { name: p.name, zone: 'z' + (i + 1) };
        });
        drawLeft(); preview();
      } }, 'Auto: 1 zone per part')));
    left.append(zonesSec);

    // --- parts mapping
    const tbody = el('tbody');
    for (const p of parts) {
      const m = d.meshes[p.key] || (d.meshes[p.key] = { name: p.name });
      const mode = m.hidden ? 'hidden' : m.zone ? 'zone:' + m.zone : m.color ? 'fixed' : 'file';
      const sel = el('select', { class: 'inp', onchange: (e) => {
        const v = e.target.value;
        delete m.zone; delete m.color; delete m.hidden;
        if (v.startsWith('zone:')) m.zone = v.slice(5);
        else if (v === 'hidden') m.hidden = true;
        else if (v === 'fixed') m.color = nearestColor(p.color);
        drawLeft(); preview();
      } },
      d.zones.map((z) => el('option', { value: 'zone:' + z.id, selected: mode === 'zone:' + z.id }, '→ ' + (tr(z.label, 'th') || z.id))),
      el('option', { value: 'fixed', selected: mode === 'fixed' }, 'Fixed color / สีคงที่'),
      el('option', { value: 'file', selected: mode === 'file' }, 'Color from file / สีจากไฟล์'),
      el('option', { value: 'hidden', selected: mode === 'hidden' }, 'Hide / ซ่อน'));
      const fixedSel = mode === 'fixed' ? el('select', { class: 'inp', onchange: (e) => { m.color = e.target.value; preview(); } },
        content.colors.map((c) => el('option', { value: c.id, selected: m.color === c.id }, tr(c.name, 'th')))) : null;
      tbody.append(el('tr', { onmouseenter: () => viewer.highlight([p.key]), onmouseleave: () => viewer.highlight([]) },
        el('td', {}, el('span', { class: 'sw', style: 'display:inline-block;width:14px;height:14px;vertical-align:middle;margin-right:6px;background:' + (p.color || '#ccc') }), p.name),
        el('td', {}, sel, fixedSel)));
    }
    left.append(el('div', { class: 'section' }, el('h3', {}, 'Parts in file / ชิ้นส่วนในไฟล์ (' + parts.length + ')'),
      el('p', { class: 'hint', style: 'margin-bottom:8px' }, 'Hover a row to highlight the part in blue. ชี้ที่แถวเพื่อดูชิ้นส่วน (สีน้ำเงิน)'),
      el('table', { class: 'ptable' }, tbody)));

    // --- thumbnail
    const tprev = el('div', { class: 'imgprev', style: d.thumbnail ? 'background-image:url(' + url(d.thumbnail) + ')' : '' });
    left.append(el('div', { class: 'section' }, el('h3', {}, 'Thumbnail / รูปปก'),
      el('div', { class: 'row' }, tprev,
        el('button', { class: 'btn', onclick: async () => {
          try {
            const path = (await api('upload_thumb', { data: viewer.snapshot('image/png', 600) })).path;
            newUploads.push(path); d.thumbnail = path; drawLeft(); toast('Thumbnail captured ✓');
          } catch (e) { toast(e.message, true); }
        } }, '📷 Capture from preview / ถ่ายจากพรีวิว'),
        el('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('image/png,image/jpeg,image/webp');
          if (!f) return;
          try { const path = await uploadFile(f, 'image'); newUploads.push(path); d.thumbnail = path; drawLeft(); } catch (e) { toast(e.message, true); }
        } }, 'Upload image'),
        d.thumbnail ? el('button', { class: 'btn small danger', onclick: () => { d.thumbnail = ''; drawLeft(); } }, 'Remove') : null),
      el('p', { class: 'hint' }, 'Rotate the preview first to get a nice angle. หมุนพรีวิวให้สวยก่อนกดถ่าย')));
    left.append(saveBar());
  }

  function saveBar() {
    return el('div', { class: 'savebar' },
      el('button', { class: 'btn', onclick: cancel }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: async (e) => {
        e.target.disabled = true;
        try {
          if (!d.id) d.id = (tr(d.name, 'en') || tr(d.name, 'th') || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          // drop mapping entries for parts no longer in file
          if (parts.length) {
            const keys = new Set(parts.map((p) => p.key));
            for (const k of Object.keys(d.meshes)) if (!keys.has(k)) delete d.meshes[k];
          }
          await api('save_model', { data: d, originalId });
          newUploads.length = 0;
          toast('Saved ✓ บันทึกแล้ว');
          render();
        } catch (er) { toast(er.message, true); e.target.disabled = false; }
      } }, 'Save / บันทึก'));
  }

  drawLeft();
  loadPreview();
}

// ---------- colors ----------
function renderColors() {
  const list = clone(content.colors);
  app.append(el('h2', {}, 'Color library / คลังสี'),
    el('p', { class: 'muted' }, 'Filament colors customers can choose. Each model zone picks from this list. สีเส้นพลาสติกที่มีขาย'));
  const tbody = el('tbody');
  const finishes = ['standard', 'matte', 'silk', 'glossy', 'metal', 'translucent'];
  function draw() {
    tbody.innerHTML = '';
    list.forEach((c, i) => {
      c.name = c.name || { th: '', en: '' };
      tbody.append(el('tr', {},
        el('td', {}, el('input', { type: 'color', value: c.hex, oninput: (e) => { c.hex = e.target.value; } })),
        el('td', {}, el('input', { class: 'inp', value: c.name.th, placeholder: 'ชื่อไทย', oninput: (e) => { c.name.th = e.target.value; } })),
        el('td', {}, el('input', { class: 'inp', value: c.name.en, placeholder: 'English', oninput: (e) => { c.name.en = e.target.value; } })),
        el('td', {}, el('select', { class: 'inp', onchange: (e) => { c.finish = e.target.value; } }, finishes.map((f) => el('option', { value: f, selected: (c.finish || 'standard') === f }, f)))),
        el('td', {}, el('input', { class: 'inp', value: c.id, title: 'ID', style: 'max-width:120px', oninput: (e) => { c.id = e.target.value; } })),
        el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap' },
          el('button', { class: 'btn small', onclick: () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } } }, '↑'),
          el('button', { class: 'btn small danger', onclick: () => { list.splice(i, 1); draw(); } }, '✕')))));
    });
  }
  draw();
  app.append(el('div', { class: 'section' },
    el('table', { class: 'ctable' }, el('thead', {}, el('tr', {}, ['Color', 'ไทย', 'English', 'Finish', 'ID', ''].map((h) => el('th', {}, h)))), tbody),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn', onclick: () => { list.push({ id: 'c' + Date.now().toString(36), name: { th: 'สีใหม่', en: 'New color' }, hex: '#888888', finish: 'standard' }); draw(); } }, '+ Add color / เพิ่มสี'))),
  el('p', { class: 'hint' }, 'Changing an ID breaks zones that use it. อย่าเปลี่ยน ID ของสีที่ใช้อยู่'),
  el('div', { class: 'savebar' }, el('button', { class: 'btn primary', onclick: async () => {
    try { await api('save_colors', { data: list }); toast('Saved ✓'); render(); } catch (e) { toast(e.message, true); }
  } }, 'Save colors / บันทึก')));
}

// ---------- site ----------
function imagePicker(label, s, key, hint) {
  const prev = el('div', { class: 'imgprev', style: s[key] ? 'background-image:url(' + url(s[key]) + ')' : '' });
  const wrap = el('div', { class: 'field' }, el('span', {}, label),
    el('div', { class: 'row' }, prev,
      el('button', { class: 'btn', onclick: async () => {
        const f = await pickFile('image/png,image/jpeg,image/webp,image/gif');
        if (!f) return;
        try { s[key] = await uploadFile(f, 'image'); prev.style.backgroundImage = 'url(' + url(s[key]) + ')'; toast('Uploaded — press Save'); } catch (e) { toast(e.message, true); }
      } }, 'Upload'),
      el('button', { class: 'btn small danger', onclick: () => { s[key] = ''; prev.style.backgroundImage = ''; } }, 'Remove')),
    hint ? el('p', { class: 'hint' }, hint) : null);
  return wrap;
}
function renderSite() {
  const s = clone(content.site);
  s.theme = s.theme || {};
  const themeKeys = [['primary', 'Main color / สีหลัก (buttons)'], ['background', 'Page background / พื้นหลัง'], ['surface', 'Cards / การ์ด'], ['text', 'Text / ตัวอักษร'], ['stage', '3D stage / พื้นหลังโมเดล']];
  app.append(el('h2', {}, 'Site settings / ตั้งค่าหน้าเว็บ'),
    el('div', { class: 'section' }, el('h3', {}, 'Brand / แบรนด์'),
      el('div', { class: 'grid2' },
        textField('Site name / ชื่อเว็บ', s, 'name'),
        el('label', { class: 'field' }, el('span', {}, 'Default language / ภาษาเริ่มต้น'),
          el('select', { class: 'inp', onchange: (e) => { s.defaultLang = e.target.value; } },
            el('option', { value: 'th', selected: s.defaultLang !== 'en' }, 'ไทย'), el('option', { value: 'en', selected: s.defaultLang === 'en' }, 'English')))),
      el('div', { class: 'grid2', style: 'margin-top:12px' },
        imagePicker('Logo / โลโก้', s, 'logo', 'PNG/SVG-like PNG with transparent background, ~80px tall.'),
        imagePicker('Favicon (square PNG)', s, 'favicon')),
      el('label', { class: 'row', style: 'margin-top:10px' }, el('input', { type: 'checkbox', checked: !!s.logoHideName, onchange: (e) => { s.logoHideName = e.target.checked; } }), 'Hide site name text when logo is set / ซ่อนชื่อเมื่อมีโลโก้')),
    el('div', { class: 'section' }, el('h3', {}, 'Header text / ข้อความหัวเว็บ'),
      i18nField('Headline / หัวข้อ', s, 'tagline'),
      i18nField('Intro / คำอธิบาย', s, 'intro', { multiline: true }),
      i18nField('Footer / ท้ายเว็บ', s, 'footer')),
    el('div', { class: 'section' }, el('h3', {}, 'Order link / ลิงก์สั่งซื้อ'),
      el('div', { class: 'grid2' },
        textField('Facebook page URL', s, 'facebookUrl', 'url', 'https://www.facebook.com/yourpage'),
        textField('Messenger URL', s, 'messengerUrl', 'url', 'https://m.me/yourpage')),
      el('label', { class: 'field', style: 'margin-top:10px' }, el('span', {}, 'Order button opens / ปุ่มสั่งซื้อเปิด'),
        el('select', { class: 'inp', onchange: (e) => { s.orderTarget = e.target.value; } },
          el('option', { value: 'messenger', selected: s.orderTarget !== 'facebook' }, 'Messenger chat (recommended)'),
          el('option', { value: 'facebook', selected: s.orderTarget === 'facebook' }, 'Facebook page')))),
    el('div', { class: 'section' }, el('h3', {}, 'Theme colors / สีธีม'),
      el('div', { class: 'grid2' }, themeKeys.map(([k, label]) => el('label', { class: 'row' },
        el('input', { type: 'color', value: s.theme[k] || '#888888', oninput: (e) => { s.theme[k] = e.target.value; } }), label)))),
    el('div', { class: 'savebar' }, el('button', { class: 'btn primary', onclick: async () => {
      try { await api('save_site', { data: s }); toast('Saved ✓ บันทึกแล้ว'); } catch (e) { toast(e.message, true); }
    } }, 'Save / บันทึก')));
}

// ---------- texts ----------
const TEXT_LABELS = {
  models: 'Gallery title', customize: 'Panel label', reset: 'Reset button', random: 'Shuffle button', screenshot: 'Save image button',
  share: 'Copy link button', order: 'Order button', orderHint: 'Under order button', copied: 'After order click (toast)',
  linkCopied: 'After copy link', loading: 'Loading', rotate: 'Auto rotate', dragHint: 'Viewer hint', noModels: 'No models', summaryTitle: 'Copied message title',
};
function renderTexts() {
  const s = clone(content.site);
  s.texts = s.texts || {};
  const sec = el('div', { class: 'section' });
  for (const [k, label] of Object.entries(TEXT_LABELS)) {
    s.texts[k] = s.texts[k] || { th: '', en: '' };
    sec.append(i18nField(label, s.texts, k));
  }
  app.append(el('h2', {}, 'Button & label texts / ข้อความปุ่ม'), sec,
    el('div', { class: 'savebar' }, el('button', { class: 'btn primary', onclick: async () => {
      try { await api('save_site', { data: s }); toast('Saved ✓'); } catch (e) { toast(e.message, true); }
    } }, 'Save / บันทึก')));
}

// ---------- account ----------
function renderAccount() {
  const pw = { current: '', new: '' };
  app.append(el('h2', {}, 'Account / บัญชี'),
    el('div', { class: 'section' }, el('h3', {}, 'Change password / เปลี่ยนรหัสผ่าน'),
      el('div', { class: 'grid2' }, textField('Current / รหัสปัจจุบัน', pw, 'current', 'password'), textField('New (8+) / รหัสใหม่', pw, 'new', 'password')),
      el('div', { class: 'row', style: 'margin-top:10px' }, el('button', { class: 'btn primary', onclick: async () => {
        try { await api('change_password', pw); toast('Password changed ✓'); render(); } catch (e) { toast(e.message, true); }
      } }, 'Change'))),
    el('div', { class: 'section' }, el('h3', {}, 'Backup / สำรองข้อมูล'),
      el('p', { class: 'hint' }, 'Backup = settings, colors, model list (JSON). Also download the uploads/ folder via File Manager to keep 3MF files. สำรองไฟล์ uploads/ ด้วย File Manager'),
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('a', { class: 'btn', href: 'api.php?action=backup' }, '⬇ Download backup'),
        el('button', { class: 'btn', onclick: async () => {
          const f = await pickFile('.json,application/json');
          if (!f || !confirm('Replace all settings with this backup? แทนที่ข้อมูลทั้งหมด?')) return;
          try { await api('restore', {}, f); toast('Restored ✓'); } catch (e) { toast(e.message, true); }
        } }, '⬆ Restore backup'))),
    el('div', { class: 'section' }, el('h3', {}, 'Session'),
      el('button', { class: 'btn danger', onclick: async () => { try { await api('logout'); } catch (e) { /* */ } location.reload(); } }, 'Log out / ออกจากระบบ')));
}

// ---------- start ----------
loadContent('../data/content.json').then((c) => { content = c; render(); })
  .catch((e) => { app.textContent = 'Cannot load data/content.json: ' + e.message; });
