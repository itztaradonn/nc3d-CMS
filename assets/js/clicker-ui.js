// NC3D Name Clicker — customer panel (type a name, color each button, palettes, cord, price)
import { parse3MF } from './threemf.js';
import { fetchModel } from './viewer3d.js';
import { tr, colorById } from './content.js';
import { extractKit, buildClicker, tokenize, clickerConfig, clickSound } from './nameclicker.js';

export const CLICKER_TEXTS = {
  nameLabel: { th: 'ชื่อบนพวงกุญแจ', en: 'Name on keychain' },
  maxButtons: { th: 'สูงสุด {n} ปุ่ม', en: 'Up to {n} buttons' },
  symbols: { th: 'สัญลักษณ์', en: 'Symbols' },
  perButton: { th: 'แต่ละปุ่ม', en: 'Per button' },
  buttonN: { th: 'ปุ่มที่ {n}', en: 'Button {n}' },
  frameColor: { th: 'สีกรอบ', en: 'Frame color' },
  letterColor: { th: 'สีตัวอักษร', en: 'Letter color' },
  capColor: { th: 'สีปุ่มกด (ทุกปุ่ม)', en: 'Keycap color (all)' },
  applyAll: { th: 'ใช้กับทุกปุ่ม', en: 'Apply to all' },
  cord: { th: 'เชือก', en: 'Cord' },
  cordOn: { th: 'ใส่เชือก', en: 'With cord' },
  cordOff: { th: 'ไม่รับเชือก', en: 'No cord' },
  price: { th: 'ราคา', en: 'Price' },
  buttons: { th: 'ปุ่ม', en: 'buttons' },
  typeHint: { th: 'พิมพ์ชื่อ A–Z, 0–9 หรือเลือกสัญลักษณ์', en: 'Type A–Z, 0–9 or pick a symbol' },
  tapHint: { th: 'แตะปุ่มบนโมเดลเพื่อกดเล่น / เลือกปุ่ม', en: 'Tap a button on the model to click it' },
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export class ClickerUI {
  constructor({ viewer, content, root, getLang, t, onChange }) {
    this.viewer = viewer;
    this.content = content;
    this.root = root;
    this.getLang = getLang;
    this.tSite = t;
    this.onChange = onChange || (() => {});
    this.kit = null;
    this.mode = 'palette';
    this.sel = 0;
    this.caps = [];
    this.press = [];
    this.lastCount = -1;
    this._tick = () => this.tick();
    viewer.tickers.push(this._tick);
    const dom = viewer.renderer.domElement;
    this._down = (e) => { this.downAt = [e.clientX, e.clientY]; };
    this._up = (e) => {
      if (!this.downAt || Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 6) return;
      const hit = viewer.pick(e.clientX, e.clientY);
      const slot = hit && hit.userData ? hit.userData.slot : undefined;
      if (slot == null) return;
      this.pressSlot(slot);
      this.sel = slot;
      this.render();
    };
    dom.addEventListener('pointerdown', this._down);
    dom.addEventListener('pointerup', this._up);
  }

  destroy() {
    const i = this.viewer.tickers.indexOf(this._tick);
    if (i >= 0) this.viewer.tickers.splice(i, 1);
    const dom = this.viewer.renderer.domElement;
    dom.removeEventListener('pointerdown', this._down);
    dom.removeEventListener('pointerup', this._up);
    this.root.innerHTML = '';
  }

  t(key, vars) {
    let s = this.tSite(key);
    if (!s || s === key) s = tr(CLICKER_TEXTS[key], this.getLang()) || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
    return s;
  }

  // ---------- data ----------
  roleColors(role) {
    const ids = this.cfg.colors[role] || [];
    const all = this.content.colors;
    return ids.length ? ids.map((id) => colorById(this.content, id)).filter(Boolean) : all.slice();
  }
  defaultColor(role) {
    const list = this.roleColors(role);
    const want = this.cfg.defaults[role];
    if (want && list.some((c) => c.id === want)) return want;
    const fallback = { frame: 0, letter: 1, cap: 1, cord: 1 }[role] || 0;
    const byName = { letter: 'black', cap: 'white', cord: 'white' }[role];
    if (byName && list.some((c) => c.id === byName)) return byName;
    return (list[fallback] || list[0] || {}).id;
  }

  /** Load the model's 3MF and set up state. preset = parsed hash values. */
  async load(model, preset, onProgress) {
    this.model = model;
    this.cfg = clickerConfig(model);
    const buf = await fetchModel(model.file, onProgress);
    const { parts } = parse3MF(buf);
    this.kit = extractKit(parts, this.cfg.roles);
    const p = preset || {};
    const text = p.n != null ? p.n : (this.cfg.sampleText || 'NC3D');
    this.chars = tokenize(this.kit, text, this.cfg.maxChars);
    this.text = this.chars.join('');
    const okFrame = new Set(this.roleColors('frame').map((c) => c.id));
    const okLetter = new Set(this.roleColors('letter').map((c) => c.id));
    const pal = this.content.palettes[0];
    this.frames = this.chars.map((_, i) => {
      const want = p.f && p.f[i];
      if (want && okFrame.has(want)) return want;
      if (!p.f && pal) { const id = pal.colors[i % pal.colors.length]; if (okFrame.has(id)) return id; }
      return this.defaultColor('frame');
    });
    this.letters = this.chars.map((_, i) => (p.l && okLetter.has(p.l[i]) ? p.l[i] : this.defaultColor('letter')));
    this.palette = !p.f && pal ? pal.id : (p.p || null);
    this.cap = p.c && this.roleColors('cap').some((c) => c.id === p.c) ? p.c : this.defaultColor('cap');
    this.cordOn = this.cfg.cord && (p.k == null ? true : p.k !== '0');
    this.cordColor = p.k && p.k !== '0' && this.roleColors('cord').some((c) => c.id === p.k) ? p.k : this.defaultColor('cord');
    this.sel = 0;
    this.rebuild(true);
    this.render();
  }

  setText(raw) {
    const chars = tokenize(this.kit, raw, this.cfg.maxChars);
    const old = this.chars;
    const pal = this.content.palettes.find((p) => p.id === this.palette);
    this.frames = chars.map((ch, i) => {
      if (i < old.length) return this.frames[i];
      if (pal) return pal.colors[i % pal.colors.length];
      return this.frames[i - 1] || this.defaultColor('frame');
    });
    this.letters = chars.map((ch, i) => this.letters[i] || this.letters[i - 1] || this.defaultColor('letter'));
    this.chars = chars;
    this.text = chars.join('');
    if (this.sel >= chars.length) this.sel = Math.max(0, chars.length - 1);
    this.rebuild(chars.length !== old.length);
  }

  hex(id) { const c = colorById(this.content, id); return c ? c : { hex: '#cccccc', finish: 'standard' }; }

  rebuild(refit) {
    if (!this.kit) return;
    const slots = this.chars.map((ch, i) => ({ char: ch, frame: this.hex(this.frames[i]).hex, letter: this.hex(this.letters[i]).hex }));
    const { group, registry, caps } = buildClicker(this.kit, slots, {
      cap: { hex: this.hex(this.cap).hex },
      cord: this.cordOn ? { hex: this.hex(this.cordColor).hex } : null,
      cfg: this.cfg,
    });
    this.caps = caps;
    this.press = caps.map(() => 0);
    this.viewer.setObject(group, registry, refit || this.lastCount !== slots.length);
    this.lastCount = slots.length;
    this.applyColors();
    this.onChange();
  }

  applyColors() {
    const v = this.viewer;
    this.chars.forEach((_, i) => {
      const f = this.hex(this.frames[i]); const l = this.hex(this.letters[i]); const c = this.hex(this.cap);
      v.setColor('s' + i + ':frame', f.hex, f.finish);
      v.setColor('s' + i + ':letter', l.hex, l.finish);
      v.setColor('s' + i + ':cap', c.hex, c.finish);
    });
    if (this.chars.length) { const f = this.hex(this.frames[0]); v.setColor('ring', f.hex, f.finish); }
    const cc = this.hex(this.cordColor);
    for (const k of v.meshes.keys()) if (k.startsWith('cord:')) v.setColor(k, cc.hex, 'matte');
  }

  pressSlot(i) {
    if (!this.caps[i]) return;
    this.press[i] = 1;
    clickSound();
  }

  tick() {
    for (let i = 0; i < this.caps.length; i++) {
      const g = this.caps[i];
      if (!g) continue;
      if (this.press[i] > 0) this.press[i] = Math.max(0, this.press[i] - 0.08);
      const depth = Math.sin(this.press[i] * Math.PI) * 2.2;
      g.position.y = g.userData.rest - depth;
    }
  }

  changed() { this.applyColors(); this.render(); this.onChange(); }

  // ---------- price / summary / hash ----------
  price() {
    const p = this.cfg.pricing;
    if (!(Number(p.perChar) || Number(p.base))) return null;
    const n = this.chars.length;
    return (Number(p.base) || 0) + (Number(p.perChar) || 0) * n + (this.cordOn ? (Number(p.cord) || 0) : 0);
  }

  hashParams() {
    const q = new URLSearchParams();
    q.set('n', this.text);
    q.set('f', this.frames.join(','));
    q.set('l', this.letters.join(','));
    q.set('c', this.cap);
    q.set('k', this.cordOn ? this.cordColor : '0');
    if (this.palette) q.set('p', this.palette);
    return q.toString();
  }

  static parsePreset(h) {
    if (!h.get('n') && !h.get('f')) return null;
    const list = (k) => (h.get(k) ? h.get(k).split(',') : null);
    return { n: h.get('n') || '', f: list('f'), l: list('l'), c: h.get('c'), k: h.get('k'), p: h.get('p') };
  }

  summaryLines() {
    const L = this.getLang();
    const name = (id) => tr((colorById(this.content, id) || {}).name, L) || id;
    const lines = [this.t('nameLabel') + ': ' + this.chars.join(' ') + ' (' + this.chars.length + ' ' + this.t('buttons') + ')'];
    const pal = this.content.palettes.find((p) => p.id === this.palette);
    if (pal) lines.push(this.t('paletteTab') + ': ' + tr(pal.name, L));
    this.chars.forEach((ch, i) => lines.push((i + 1) + '. ' + ch + ' — ' + this.t('frameColor') + ' ' + name(this.frames[i]) + ' / ' + this.t('letterColor') + ' ' + name(this.letters[i])));
    lines.push(this.t('capColor') + ': ' + name(this.cap));
    if (this.cfg.cord) lines.push(this.t('cord') + ': ' + (this.cordOn ? name(this.cordColor) : this.t('cordOff')));
    const pr = this.price();
    if (pr != null) lines.push(this.t('price') + ': ' + this.cfg.pricing.currency + pr.toLocaleString());
    return lines;
  }

  reset() {
    const pal = this.content.palettes[0];
    this.frames = this.chars.map((_, i) => (pal ? pal.colors[i % pal.colors.length] : this.defaultColor('frame')));
    this.letters = this.chars.map(() => this.defaultColor('letter'));
    this.cap = this.defaultColor('cap');
    this.palette = pal ? pal.id : null;
    this.changed();
  }

  randomize() {
    const fr = this.roleColors('frame'); const le = this.roleColors('letter');
    const pick = (l) => l[Math.floor(Math.random() * l.length)].id;
    this.frames = this.chars.map(() => pick(fr));
    this.letters = this.chars.map((_, i) => {
      // keep letters readable: avoid same color as the frame
      const opts = le.filter((c) => c.id !== this.frames[i]);
      return pick(opts.length ? opts : le);
    });
    this.palette = null;
    this.changed();
  }

  // ---------- UI ----------
  swatches(role, current, onPick) {
    const L = this.getLang();
    return el('div', { class: 'swatches' }, this.roleColors(role).map((c) => el('button', {
      type: 'button',
      class: 'swatch f-' + (c.finish || 'standard') + (current === c.id ? ' on' : ''),
      style: 'background-color:' + c.hex,
      title: tr(c.name, L),
      'aria-label': tr(c.name, L),
      onclick: () => onPick(c.id),
    })));
  }

  render() {
    const L = this.getLang();
    const root = this.root;
    root.innerHTML = '';
    if (!this.kit) return;
    const name = (id) => tr((colorById(this.content, id) || {}).name, L);
    const symbols = this.kit.chars.filter((c) => !/^[A-Z0-9]$/.test(c));

    // name input
    const input = el('input', {
      class: 'name-input', type: 'text', value: this.text, maxlength: String(this.cfg.maxChars * 4),
      autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: this.t('typeHint'),
      'aria-label': this.t('nameLabel'),
    });
    input.addEventListener('input', () => {
      const pos = input.selectionStart;
      this.setText(input.value);
      this.renderStrip(strip);
      this.renderBody(body);
      if (input.value.toUpperCase() !== this.text) { input.value = this.text; }
      try { input.setSelectionRange(pos, pos); } catch (e) { /* */ }
    });
    const drawer = el('div', { class: 'sym-drawer', hidden: true }, symbols.map((ch) => el('button', {
      type: 'button', class: 'sym', onclick: () => {
        if (this.chars.length >= this.cfg.maxChars) return;
        this.setText(this.text + ch); input.value = this.text; this.render();
      },
    }, ch)));
    const nameBox = el('div', { class: 'cl-card' },
      el('div', { class: 'cl-head' }, el('b', {}, this.t('nameLabel')), el('span', {}, this.t('maxButtons', { n: this.cfg.maxChars }))),
      el('div', { class: 'name-row' }, input,
        symbols.length ? el('button', { type: 'button', class: 'sym-toggle', title: this.t('symbols'), onclick: () => { drawer.hidden = !drawer.hidden; } }, '☺') : null),
      drawer);
    const strip = el('div', { class: 'slot-strip' });
    this.renderStrip(strip);
    nameBox.append(strip);
    root.append(nameBox);

    const body = el('div');
    root.append(body);
    this.renderBody(body);

    // cord
    if (this.cfg.cord) {
      const cordBox = el('div', { class: 'cl-card' },
        el('div', { class: 'cl-head' }, el('b', {}, this.t('cord')), el('span', {}, this.cordOn ? name(this.cordColor) : '')),
        el('div', { class: 'mode-tabs' },
          el('button', { type: 'button', class: this.cordOn ? 'on' : '', onclick: () => { this.cordOn = true; this.rebuild(false); this.render(); } }, this.t('cordOn')),
          el('button', { type: 'button', class: this.cordOn ? '' : 'on', onclick: () => { this.cordOn = false; this.rebuild(false); this.render(); } },
            this.t('cordOff') + (Number(this.cfg.pricing.cord) ? ' −' + this.cfg.pricing.currency + Number(this.cfg.pricing.cord) : ''))),
        this.cordOn ? this.swatches('cord', this.cordColor, (id) => { this.cordColor = id; this.changed(); }) : null);
      root.append(cordBox);
    }

    const pr = this.price();
    if (pr != null) {
      root.append(el('div', { class: 'cl-card cl-price' },
        el('span', {}, this.t('price') + ' · ' + this.chars.length + ' ' + this.t('buttons')),
        el('b', {}, this.cfg.pricing.currency + pr.toLocaleString())));
    }
    root.append(el('p', { class: 'tap-hint' }, this.t('tapHint')));
  }

  renderStrip(strip) {
    strip.innerHTML = '';
    this.chars.forEach((ch, i) => {
      const f = this.hex(this.frames[i]); const l = this.hex(this.letters[i]);
      strip.append(el('button', {
        type: 'button', class: 'slot' + (i === this.sel ? ' on' : ''),
        style: '--f:' + f.hex + ';--l:' + l.hex,
        onclick: () => { this.sel = i; this.mode = 'buttons'; this.pressSlot(i); this.render(); },
      }, ch));
    });
  }

  renderBody(body) {
    const L = this.getLang();
    body.innerHTML = '';
    const name = (id) => tr((colorById(this.content, id) || {}).name, L);
    const pals = this.content.palettes;
    const card = el('div', { class: 'cl-card' });
    if (pals.length) {
      card.append(el('div', { class: 'mode-tabs' },
        el('button', { type: 'button', class: this.mode === 'palette' ? 'on' : '', onclick: () => { this.mode = 'palette'; this.renderBody(body); } }, this.t('paletteTab')),
        el('button', { type: 'button', class: this.mode === 'buttons' ? 'on' : '', onclick: () => { this.mode = 'buttons'; this.renderBody(body); } }, this.t('perButton'))));
    }
    if (this.mode === 'palette' && pals.length) {
      const okFrame = new Set(this.roleColors('frame').map((c) => c.id));
      card.append(el('div', { class: 'palettes' }, pals.map((p) => el('button', {
        type: 'button', class: 'pal' + (this.palette === p.id ? ' on' : ''),
        onclick: () => {
          this.palette = p.id;
          this.frames = this.chars.map((_, i) => {
            const id = p.colors[i % p.colors.length];
            return okFrame.has(id) ? id : this.frames[i];
          });
          this.changed();
        },
      }, el('div', { class: 'dots' }, p.colors.map((id) => el('i', { style: 'background:' + this.hex(id).hex }))), el('b', {}, tr(p.name, L))))));
    } else {
      const i = Math.min(this.sel, this.chars.length - 1);
      if (i >= 0) {
        const nav = el('div', { class: 'cl-head' },
          el('div', { class: 'row-nav' },
            el('button', { type: 'button', class: 'nav', onclick: () => { this.sel = (i - 1 + this.chars.length) % this.chars.length; this.render(); } }, '‹'),
            el('b', {}, this.t('buttonN', { n: i + 1 }) + ' · ' + this.chars[i]),
            el('button', { type: 'button', class: 'nav', onclick: () => { this.sel = (i + 1) % this.chars.length; this.render(); } }, '›')));
        card.append(nav,
          el('div', { class: 'cl-sub' }, el('span', {}, this.t('frameColor') + ' · ' + name(this.frames[i])),
            el('button', { type: 'button', class: 'link', onclick: () => { this.frames = this.frames.map(() => this.frames[i]); this.palette = null; this.changed(); } }, this.t('applyAll'))),
          this.swatches('frame', this.frames[i], (id) => { this.frames[i] = id; this.palette = null; this.changed(); }),
          el('div', { class: 'cl-sub' }, el('span', {}, this.t('letterColor') + ' · ' + name(this.letters[i])),
            el('button', { type: 'button', class: 'link', onclick: () => { this.letters = this.letters.map(() => this.letters[i]); this.changed(); } }, this.t('applyAll'))),
          this.swatches('letter', this.letters[i], (id) => { this.letters[i] = id; this.changed(); }));
      }
    }
    body.append(card);
    body.append(el('div', { class: 'cl-card' },
      el('div', { class: 'cl-head' }, el('b', {}, this.t('capColor')), el('span', {}, name(this.cap))),
      this.swatches('cap', this.cap, (id) => { this.cap = id; this.changed(); })));
  }
}
