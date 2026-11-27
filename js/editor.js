/* Open Notes — note editor: rich text, handwriting, insertions, page style */
const PEN_COLORS = ['#1a1a1a', '#5f6368', '#ffffff', '#d32f2f', '#f2711c', '#f9c623', '#2e9e48', '#1e88e5', '#3949ab', '#8e24aa', '#e91e63', '#795548'];
const HL_COLORS = ['#ffe14d', '#b7f34a', '#6fe3ff', '#ff9ad5', '#ffb74d', '#c5a3ff'];
const TEXT_COLORS = ['#1a1a1a', '#d32f2f', '#f2711c', '#f9a825', '#2e9e48', '#1e88e5', '#3949ab', '#8e24aa', '#757575'];
const PAGE_COLORS = [
  { v: 'default', label: 'Padrão' }, { v: '#fffdf4', label: 'Creme' }, { v: '#fff4e0', label: 'Pêssego' },
  { v: '#eef6ff', label: 'Azul' }, { v: '#eefaf0', label: 'Verde' }, { v: '#fdeff5', label: 'Rosa' },
  { v: '#f3effd', label: 'Lavanda' }, { v: '#26282b', label: 'Escuro' }
];
const PAGE_BGS = [
  { v: 'plain', label: 'Liso' }, { v: 'lined', label: 'Pautado' },
  { v: 'grid', label: 'Quadriculado' }, { v: 'dots', label: 'Pontilhado' }, { v: 'cornell', label: 'Cornell' }
];

const Editor = {
  note: null,
  dirty: false,
  mode: 'text',
  plain: null, // decrypted payload for locked notes

  init() {
    this.el = document.getElementById('editor');
    this.page = document.getElementById('page');
    this.title = document.getElementById('noteTitle');
    this.content = document.getElementById('noteContent');
    this.meta = document.getElementById('noteMeta');
    this.scroller = document.getElementById('pageScroll');
    this.sub = document.getElementById('subpanel');
    this.ink = new Ink({
      page: this.page,
      canvas: document.getElementById('ink'),
      live: document.getElementById('inkLive'),
      lassoBox: document.getElementById('lassoBox'),
      scroller: this.scroller
    });
    this.ink.onChange = () => this.touch();
    this.ink.onHistory = () => this.updateUndo();
    this.ink.onPickColor = (anchor, cb) => this.colorPopup(anchor, PEN_COLORS, null, cb);

    const savedCfg = App.settings.ink;
    if (savedCfg) Object.assign(this.ink.cfg, savedCfg.cfg || {}), this.ink.penType = savedCfg.penType || 'pen', this.ink.eraserMode = savedCfg.eraserMode || 'stroke', this.ink.eraserSize = savedCfg.eraserSize || 20;

    this.title.addEventListener('input', () => this.touch());
    this.content.addEventListener('input', () => { this.touch(); this.ink.resize(); this.updateEmpty(); });
    this.content.addEventListener('keydown', e => this.onKey(e));
    this.content.addEventListener('click', e => this.onContentClick(e));
    this.content.addEventListener('paste', e => this.onPaste(e));
    this.content.addEventListener('focus', () => { if (this.mode !== 'text') this.setMode('text'); });
    document.addEventListener('selectionchange', () => { if (this.sub.dataset.kind === 'format') this.syncFormatState(); });
    this.title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.content.focus(); } });

    document.getElementById('toolbar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) {
        const t = b.dataset.tool;
        if (this.mode === t && t !== 'text') this.toggleToolPanel(t);
        else this.setMode(t);
      } else if (b.dataset.action === 'format') this.toggleFormat();
      else if (b.dataset.action === 'insert') this.insertMenu(b);
    });

    window.addEventListener('resize', () => { if (!this.el.hidden) this.ink.resize(true); });
    if (window.ResizeObserver) new ResizeObserver(() => { if (!this.el.hidden) this.ink.resize(); }).observe(this.content);
    document.getElementById('fileImage').addEventListener('change', e => this.insertImages(e.target.files));
    document.getElementById('fileCamera').addEventListener('change', e => this.insertImages(e.target.files));
  },

  /* ---------- open / close / save ---------- */
  async open(note, data) {
    this.note = note;
    this.plain = data || null;
    const html = data ? data.html : note.html;
    const strokes = data ? data.strokes : note.strokes;
    this.title.value = note.title || '';
    this.content.innerHTML = html || '';
    this.applyPage();
    this.el.hidden = false;
    document.getElementById('home').classList.add('behind');
    this.scroller.scrollTop = 0;
    this.closeSub();
    this.dirty = false;
    this.ink.stylusOnly = !!App.settings.stylusOnly;
    requestAnimationFrame(() => {
      this.ink.load(JSON.parse(JSON.stringify(strokes || [])));
      this.updateEmpty();
    });
    this.renderMeta();
    this.updateFav();
    const startDraw = note._startDraw;
    delete note._startDraw;
    this.setMode(startDraw ? 'pen' : 'text', true);
    if (!note.title && !html && !startDraw && !(strokes || []).length) setTimeout(() => this.content.focus(), 250);
    this.readOnly(!!note.deleted);
  },

  readOnly(on) {
    this.content.contentEditable = on ? 'false' : 'true';
    this.title.readOnly = on;
    this.el.classList.toggle('readonly', on);
    if (on) this.ink.setActive(false);
  },

  async close() {
    this.closeSub();
    await this.save();
    this.el.hidden = true;
    document.getElementById('home').classList.remove('behind');
    this.ink.setActive(false);
    const n = this.note;
    this.note = null; this.plain = null;
    this.content.innerHTML = '';
    // discard brand-new empty notes
    if (n && n._new && !n.title && !this._hasContent(n)) await DB.del('notes', n.id);
    App.refresh();
  },

  _hasContent(n) {
    const html = n.locked ? '' : (n.html || '');
    return n.locked || (n.strokes && n.strokes.length) || html.replace(/<br\s*\/?>/g, '').replace(/<[^>]+>/g, s => /<(img|audio|hr|table)/i.test(s) ? 'x' : '').trim().length;
  },

  touch() {
    this.dirty = true;
    clearTimeout(this._st);
    this._st = setTimeout(() => this.save(), 700);
    this.updateUndo();
  },

  async save() {
    clearTimeout(this._st);
    if (!this.note || !this.dirty || this.note.deleted) return;
    this.dirty = false;
    const n = this.note;
    n.title = this.title.value.trim();
    const html = this.content.innerHTML;
    const strokes = this.ink.strokes;
    const text = this.content.innerText.replace(/\s+/g, ' ').trim();
    n.updatedAt = Date.now();
    if (n.locked) {
      n.enc = await Crypt.encrypt(App.key, { html, strokes });
      n.html = ''; n.strokes = [];
      n.preview = { text: '', thumb: null };
    } else {
      n.html = html; n.strokes = strokes;
      const t = this.makeThumb();
      n.preview = { text: text.slice(0, 300), thumb: t && t.url, ink: !!(t && t.ink) };
    }
    if (n._new && (n.title || this._hasContent(n))) delete n._new;
    const copy = { ...n };
    delete copy._new;
    if (!n._new) await DB.put('notes', copy);
    this.renderMeta();
  },

  makeThumb() {
    const pc = this.note.pageColor;
    const t = Ink.thumb(this.ink.strokes, 300, 400, pc && pc !== 'default' ? pc : 'rgba(0,0,0,0)');
    if (t) return { url: t, ink: true };
    const img = this.content.querySelector('img');
    if (!img || !img.naturalWidth) return null;
    const c = document.createElement('canvas');
    const k = Math.min(1, 300 / img.naturalWidth);
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    try { return { url: c.toDataURL('image/webp', 0.7), ink: false }; } catch (_) { return null; }
  },

  renderMeta() {
    const n = this.note;
    if (!n) return;
    const f = App.folders.find(x => x.id === n.folderId);
    this.meta.innerHTML = `<span>${fmtDate(n.updatedAt, true)}</span>` +
      (f ? `<span class="meta-folder"><i style="background:${f.color}"></i>${esc(f.name)}</span>` : '') +
      (n.locked ? `<span class="meta-lock">${icon('lock')}</span>` : '');
  },

  updateEmpty() {
    const empty = !this.content.textContent.trim() && !this.content.querySelector('img,audio,ul,ol,hr,table');
    this.content.classList.toggle('is-empty', empty);
  },

  updateFav() {
    const b = document.getElementById('favBtn');
    const on = !!(this.note && this.note.favorite);
    b.dataset.icon = on ? 'starfill' : 'star';
    b.classList.toggle('on', on);
    hydrateIcons(b.parentNode);
  },

  updateUndo() {
    const drawing = this.mode !== 'text';
    document.querySelector('[data-action="undo"]').disabled = drawing && !this.ink.canUndo();
    document.querySelector('[data-action="redo"]').disabled = drawing && !this.ink.canRedo();
  },

  undo() { if (this.mode === 'text') document.execCommand('undo'); else this.ink.undo(); },
  redo() { if (this.mode === 'text') document.execCommand('redo'); else this.ink.redo(); },

  /* ---------- page style ---------- */
  pageColorValue() {
    const c = this.note && this.note.pageColor;
    if (!c || c === 'default') return getComputedStyle(document.documentElement).getPropertyValue('--page').trim() || '#fff';
    return c;
  },
  applyPage() {
    const n = this.note;
    const bg = n.pageBg || 'plain';
    this.page.className = 'page bg-' + bg;
    const c = n.pageColor && n.pageColor !== 'default' ? n.pageColor : '';
    this.page.style.backgroundColor = c;
    const dark = c ? isDarkColor(c) : document.documentElement.dataset.theme === 'dark';
    this.page.classList.toggle('dark-page', dark);
    this.page.classList.toggle('drawing', this.mode !== 'text');
  },
  async pageMenu() {
    const n = this.note;
    const html = `<h3>Estilo da página</h3>
      <div class="opt-label">Modelo</div>
      <div class="bg-options">${PAGE_BGS.map(b => `<button class="bg-opt ${(n.pageBg || 'plain') === b.v ? 'active' : ''}" data-bg="${b.v}"><span class="bg-prev bg-${b.v}"></span><small>${b.label}</small></button>`).join('')}</div>
      <div class="opt-label">Cor da página</div>
      <div class="color-row">${PAGE_COLORS.map(c => `<button class="color-dot page-dot ${(n.pageColor || 'default') === c.v ? 'active' : ''}" data-pc="${c.v}" title="${c.label}" style="background:${c.v === 'default' ? 'var(--page)' : c.v}"></button>`).join('')}</div>
      <div class="dlg-actions"><button class="text-btn accent" data-r="1">Concluído</button></div>`;
    const o = UI.overlay(html, { cls: 'sheet' });
    o.box.addEventListener('click', e => {
      const bg = e.target.closest('[data-bg]'), pc = e.target.closest('[data-pc]');
      if (bg) { n.pageBg = bg.dataset.bg; o.box.querySelectorAll('[data-bg]').forEach(x => x.classList.toggle('active', x === bg)); }
      if (pc) { n.pageColor = pc.dataset.pc; o.box.querySelectorAll('[data-pc]').forEach(x => x.classList.toggle('active', x === pc)); }
      if (bg || pc) { this.applyPage(); this.touch(); }
      if (e.target.closest('[data-r]')) o.close();
    });
  },

  /* ---------- modes & tool panels ---------- */
  setMode(mode, silent) {
    this.mode = mode;
    const drawing = mode !== 'text';
    if (drawing) {
      this.content.blur();
      this.ink.tool = mode;
      this.ink.setActive(true);
    } else this.ink.setActive(false);
    document.querySelectorAll('#toolbar [data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === mode));
    this.updatePenIcon();
    if (!silent && drawing && this.sub.dataset.kind && this.sub.dataset.kind !== mode) this.closeSub();
    if (mode === 'text' && this.sub.dataset.kind && this.sub.dataset.kind !== 'format') this.closeSub();
    this.updateUndo();
  },

  updatePenIcon() {
    const b = document.querySelector('#toolbar [data-tool="pen"]');
    const t = this.ink.penType;
    b.dataset.icon = t === 'pen' ? 'pen' : t;
    hydrateIcons(b.parentNode);
    b.style.setProperty('--tool-color', this.ink.cfg[t].c);
    document.querySelector('#toolbar [data-tool="highlighter"]').style.setProperty('--tool-color', this.ink.cfg.highlighter.c);
  },

  closeSub() {
    this.sub.hidden = true;
    this.sub.dataset.kind = '';
    this.sub.innerHTML = '';
    document.querySelector('#toolbar [data-action="format"]').classList.remove('active');
  },

  toggleToolPanel(tool) {
    if (this.sub.dataset.kind === tool) { this.closeSub(); return; }
    this.sub.dataset.kind = tool;
    this.sub.hidden = false;
    if (tool === 'pen') this.penPanel();
    else if (tool === 'highlighter') this.hlPanel();
    else if (tool === 'eraser') this.eraserPanel();
    else if (tool === 'lasso') { this.sub.innerHTML = `<p class="hint">Circule traços para selecioná-los. Arraste para mover, use a alça para redimensionar.</p>`; }
    hydrateIcons(this.sub);
  },

  persistInk() {
    App.settings.ink = { cfg: this.ink.cfg, penType: this.ink.penType, eraserMode: this.ink.eraserMode, eraserSize: this.ink.eraserSize };
    App.saveSettings();
  },

  penPanel() {
    const ink = this.ink, t = ink.penType, c = ink.cfg[t];
    const types = [['pen', 'Caneta'], ['pencil', 'Lápis'], ['fountain', 'Caneta-tinteiro'], ['brush', 'Pincel']];
    this.sub.innerHTML = `
      <div class="pen-types">${types.map(([v, l]) => `<button class="pen-type ${t === v ? 'active' : ''}" data-pt="${v}" title="${l}">${icon(v === 'pen' ? 'pen' : v)}<small>${l}</small></button>`).join('')}</div>
      <div class="size-row"><span>Espessura</span><input type="range" min="1" max="24" step="0.5" value="${c.w}" data-size><b>${c.w}</b></div>
      <div class="color-row">${PEN_COLORS.map(col => `<button class="color-dot ${col === c.c ? 'active' : ''}" data-col="${col}" style="background:${col}"></button>`).join('')}
        <label class="color-dot custom" title="Personalizar">${icon('palette')}<input type="color" value="${c.c}" data-custom></label></div>`;
    this.sub.onclick = e => {
      const pt = e.target.closest('[data-pt]'), col = e.target.closest('[data-col]');
      if (pt) { ink.penType = pt.dataset.pt; this.penPanel(); this.updatePenIcon(); this.persistInk(); }
      if (col) { ink.cfg[ink.penType].c = col.dataset.col; this.penPanel(); this.updatePenIcon(); this.persistInk(); }
    };
    this.bindSize(v => { ink.cfg[ink.penType].w = v; });
    this.sub.querySelector('[data-custom]').addEventListener('change', e => { ink.cfg[ink.penType].c = e.target.value; this.penPanel(); this.updatePenIcon(); this.persistInk(); });
  },

  hlPanel() {
    const ink = this.ink, c = ink.cfg.highlighter;
    this.sub.innerHTML = `
      <div class="size-row"><span>Espessura</span><input type="range" min="6" max="48" step="1" value="${c.w}" data-size><b>${c.w}</b></div>
      <div class="color-row">${HL_COLORS.map(col => `<button class="color-dot ${col === c.c ? 'active' : ''}" data-col="${col}" style="background:${col}"></button>`).join('')}</div>`;
    this.sub.onclick = e => {
      const col = e.target.closest('[data-col]');
      if (col) { c.c = col.dataset.col; this.hlPanel(); this.updatePenIcon(); this.persistInk(); }
    };
    this.bindSize(v => { c.w = v; });
  },

  eraserPanel() {
    const ink = this.ink;
    this.sub.innerHTML = `
      <div class="seg">
        <button class="${ink.eraserMode === 'stroke' ? 'active' : ''}" data-em="stroke">Apagar traço inteiro</button>
        <button class="${ink.eraserMode === 'area' ? 'active' : ''}" data-em="area">Apagar área</button>
      </div>
      <div class="size-row"><span>Tamanho</span><input type="range" min="6" max="80" step="1" value="${ink.eraserSize}" data-size><b>${ink.eraserSize}</b></div>
      <button class="text-btn danger wide" data-clear>Apagar todos os desenhos</button>`;
    this.sub.onclick = async e => {
      const em = e.target.closest('[data-em]');
      if (em) { ink.eraserMode = em.dataset.em; this.eraserPanel(); this.persistInk(); }
      if (e.target.closest('[data-clear]')) {
        if (await UI.confirm({ title: 'Apagar todos os desenhos?', message: 'O texto da nota será mantido.', ok: 'Apagar', danger: true })) ink.clearAll();
      }
    };
    this.bindSize(v => { ink.eraserSize = v; });
  },

  bindSize(set) {
    const r = this.sub.querySelector('[data-size]'), b = r.nextElementSibling;
    r.addEventListener('input', () => { set(+r.value); b.textContent = r.value; });
    r.addEventListener('change', () => this.persistInk());
  },

  colorPopup(anchor, colors, current, cb) {
    const html = `<div class="color-row pop">${colors.map(c => `<button class="color-dot ${c === current ? 'active' : ''}" data-col="${c}" style="background:${c}"></button>`).join('')}</div>`;
    const o = UI.overlay(html, { cls: 'menu color-menu', transparent: true });
    const r = anchor.getBoundingClientRect();
    requestAnimationFrame(() => {
      const w = o.box.offsetWidth, h = o.box.offsetHeight;
      o.box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = r.top - h - 6;
      o.box.style.top = top + 'px';
    });
    o.box.addEventListener('click', e => {
      const b = e.target.closest('[data-col]');
      if (!b) return;
      o.close(); cb(b.dataset.col);
    });
  },

  /* ---------- rich text ---------- */
  toggleFormat() {
    if (this.sub.dataset.kind === 'format') { this.closeSub(); return; }
    if (this.mode !== 'text') this.setMode('text');
    this.saveRange();
    this.sub.dataset.kind = 'format';
    this.sub.hidden = false;
    document.querySelector('#toolbar [data-action="format"]').classList.add('active');
    const B = (cmd, ic, title, val) => `<button class="fmt" data-cmd="${cmd}" ${val ? `data-val="${val}"` : ''} title="${title}">${icon(ic)}</button>`;
    this.sub.innerHTML = `
      <div class="fmt-row">
        <select class="fmt-size" data-fsize title="Tamanho da fonte">
          <option value="2">Pequeno</option><option value="3" selected>Normal</option><option value="4">Médio</option>
          <option value="5">Grande</option><option value="6">Muito grande</option><option value="7">Enorme</option>
        </select>
        ${B('bold', 'bold', 'Negrito')}${B('italic', 'italic', 'Itálico')}${B('underline', 'underline', 'Sublinhado')}${B('strikeThrough', 'strike', 'Tachado')}
        <button class="fmt" data-pick="fore" title="Cor do texto">${icon('textcolor')}</button>
        <button class="fmt" data-pick="hilite" title="Realce do texto">${icon('hilite')}</button>
      </div>
      <div class="fmt-row">
        ${B('formatBlock', 'heading', 'Título', 'H2')}
        ${B('insertUnorderedList', 'bullets', 'Marcadores')}${B('insertOrderedList', 'numbers', 'Numeração')}
        <button class="fmt" data-check title="Lista de tarefas">${icon('checklist')}</button>
        ${B('justifyLeft', 'alignleft', 'Alinhar à esquerda')}${B('justifyCenter', 'aligncenter', 'Centralizar')}${B('justifyRight', 'alignright', 'Alinhar à direita')}
        ${B('indent', 'indent', 'Aumentar recuo')}${B('outdent', 'outdent', 'Diminuir recuo')}
        ${B('removeFormat', 'clear', 'Limpar formatação')}
      </div>`;
    this.sub.onmousedown = e => { if (!e.target.closest('select')) e.preventDefault(); };   // keep caret in the text
    this.sub.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      this.restoreRange();
      if (b.dataset.cmd) {
        let val = b.dataset.val || null;
        if (b.dataset.cmd === 'formatBlock') {
          const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
          val = cur === 'h2' ? 'DIV' : 'H2';
        }
        document.execCommand(b.dataset.cmd, false, val);
      } else if (b.hasAttribute('data-check')) this.toggleChecklist();
      else if (b.dataset.pick) {
        this.saveRange();
        const fore = b.dataset.pick === 'fore';
        this.colorPopup(b, fore ? TEXT_COLORS : ['transparent', ...HL_COLORS], null, col => {
          this.restoreRange();
          document.execCommand('styleWithCSS', false, true);
          document.execCommand(fore ? 'foreColor' : 'hiliteColor', false, col);
          document.execCommand('styleWithCSS', false, false);
          this.touch();
        });
        return;
      }
      this.touch();
      this.syncFormatState();
    };
    this.sub.querySelector('[data-fsize]').addEventListener('change', e => {
      this.restoreRange();
      document.execCommand('fontSize', false, e.target.value);
      this.touch();
    });
    this.syncFormatState();
  },

  saveRange() {
    const s = getSelection();
    if (s.rangeCount && this.content.contains(s.anchorNode)) this._range = s.getRangeAt(0).cloneRange();
  },
  restoreRange() {
    if (document.activeElement !== this.content) this.content.focus();
    if (this._range) {
      const s = getSelection();
      s.removeAllRanges(); s.addRange(this._range);
    }
  },

  syncFormatState() {
    const s = getSelection();
    if (!s.rangeCount || !this.content.contains(s.anchorNode)) return;
    this.saveRange();
    this.sub.querySelectorAll('[data-cmd]').forEach(b => {
      let on = false;
      try {
        if (b.dataset.cmd === 'formatBlock') on = (document.queryCommandValue('formatBlock') || '').toLowerCase() === 'h2';
        else if (!/indent|outdent|removeFormat/.test(b.dataset.cmd)) on = document.queryCommandState(b.dataset.cmd);
      } catch (_) {}
      b.classList.toggle('on', on);
    });
    const sz = this.sub.querySelector('[data-fsize]');
    if (sz) { const v = document.queryCommandValue('fontSize'); if (v) sz.value = v; }
    const li = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('ul.checklist');
    const cb = this.sub.querySelector('[data-check]');
    if (cb) cb.classList.toggle('on', !!li);
  },

  toggleChecklist() {
    const s = getSelection();
    const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    const ul = node && node.closest('ul');
    if (ul && ul.classList.contains('checklist')) { document.execCommand('insertUnorderedList'); return; }
    if (ul) { ul.classList.add('checklist'); return; }
    document.execCommand('insertUnorderedList');
    const n2 = getSelection().anchorNode;
    const el = n2 && (n2.nodeType === 1 ? n2 : n2.parentElement);
    const nu = el && el.closest('ul');
    if (nu) nu.classList.add('checklist');
  },

  onKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); this.save(); UI.toast('Nota salva'); }
    }
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); }
  },

  onContentClick(e) {
    const li = e.target.closest('ul.checklist > li');
    if (li && e.target === li) {
      const r = li.getBoundingClientRect();
      if (e.clientX - r.left < 30) {
        li.classList.toggle('done');
        this.touch();
        e.preventDefault();
      }
    }
    const img = e.target.closest('img');
    if (img && !this.el.classList.contains('readonly')) this.imageMenu(img);
  },

  imageMenu(img) {
    UI.menu(img, [
      { label: 'Pequena', icon: 'image', onClick: () => { img.style.width = '33%'; this.touch(); } },
      { label: 'Média', icon: 'image', onClick: () => { img.style.width = '60%'; this.touch(); } },
      { label: 'Largura total', icon: 'image', onClick: () => { img.style.width = '100%'; this.touch(); } },
      { divider: true },
      { label: 'Excluir imagem', icon: 'trash', danger: true, onClick: () => { img.remove(); this.touch(); this.ink.resize(true); } }
    ]);
  },

  onPaste(e) {
    const items = e.clipboardData && e.clipboardData.files;
    if (items && items.length) {
      const imgs = [...items].filter(f => f.type.startsWith('image/'));
      if (imgs.length) { e.preventDefault(); this.insertImages(imgs); return; }
    }
    // paste as clean text to avoid importing foreign styles
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    }
  },

  /* ---------- insert ---------- */
  insertMenu(anchor) {
    if (this.mode !== 'text') this.setMode('text');
    this.saveRange();
    UI.menu(anchor, [
      { label: 'Imagem', icon: 'image', onClick: () => document.getElementById('fileImage').click() },
      { label: 'Câmera', icon: 'camera', onClick: () => document.getElementById('fileCamera').click() },
      { label: 'Gravação de voz', icon: 'mic', onClick: () => this.recordVoice() },
      { label: 'Lista de tarefas', icon: 'checklist', onClick: () => { this.restoreRange(); this.toggleChecklist(); this.touch(); } },
      { label: 'Tabela', icon: 'table', onClick: () => this.insertTable() },
      { label: 'Linha divisória', icon: 'divider', onClick: () => { this.restoreRange(); document.execCommand('insertHTML', false, '<hr><div><br></div>'); this.touch(); } },
      { label: 'Data e hora', icon: 'clock', onClick: () => { this.restoreRange(); document.execCommand('insertText', false, new Date().toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' }) + ' '); this.touch(); } },
      { label: 'Link', icon: 'link', onClick: () => this.insertLink() }
    ]);
  },

  async insertImages(files) {
    for (const f of [...files]) {
      if (!f.type.startsWith('image/')) continue;
      const url = await downscale(f, 1600);
      this.restoreRange();
      document.execCommand('insertHTML', false, `<img src="${url}" style="width:100%" alt=""><div><br></div>`);
    }
    document.getElementById('fileImage').value = '';
    document.getElementById('fileCamera').value = '';
    this.touch();
    setTimeout(() => this.ink.resize(), 100);
  },

  async insertTable() {
    const v = await UI.prompt({ title: 'Inserir tabela', value: '3 x 3', placeholder: 'colunas x linhas', ok: 'Inserir' });
    if (!v) return;
    const m = v.match(/(\d+)\D+(\d+)/);
    const cols = Math.min(10, Math.max(1, m ? +m[1] : 3)), rows = Math.min(30, Math.max(1, m ? +m[2] : 3));
    const cells = '<td><br></td>'.repeat(cols);
    this.restoreRange();
    document.execCommand('insertHTML', false, `<table class="note-table"><tbody>${('<tr>' + cells + '</tr>').repeat(rows)}</tbody></table><div><br></div>`);
    this.touch();
  },

  async insertLink() {
    const sel = this._range ? this._range.toString() : '';
    const url = await UI.prompt({ title: 'Inserir link', placeholder: 'https://', ok: 'Inserir', type: 'url' });
    if (!url) return;
    const href = /^[a-z]+:/i.test(url) ? url : 'https://' + url;
    if (!/^(https?|mailto|tel):/i.test(href)) return;
    this.restoreRange();
    if (sel) document.execCommand('createLink', false, href);
    else document.execCommand('insertHTML', false, `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(url)}</a>&nbsp;`);
    this.touch();
  },

  async recordVoice() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { UI.toast('Gravação não suportada neste navegador'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { UI.toast('Permissão de microfone negada'); return; }
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const o = UI.overlay(`<div class="rec"><div class="rec-dot"></div><h3 class="center">Gravando...</h3><div class="rec-time">00:00</div>
      <div class="dlg-actions center"><button class="text-btn" data-r="0">Cancelar</button><button class="rec-stop" data-r="1">${icon('stop')}</button></div></div>`,
      { onDismiss: () => finish(false) });
    const t0 = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      o.box.querySelector('.rec-time').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 250);
    let keep = false;
    const finish = k => { keep = k; clearInterval(timer); if (rec.state !== 'inactive') rec.stop(); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (!keep || !chunks.length) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const url = await blobToDataURL(blob);
      const secs = Math.round((Date.now() - t0) / 1000);
      this.restoreRange();
      document.execCommand('insertHTML', false, `<div class="voice" contenteditable="false"><span class="voice-ico">🎙</span><audio controls src="${url}"></audio><small>${secs}s</small></div><div><br></div>`);
      this.touch();
    };
    rec.start();
    o.box.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      o.close(); finish(b.dataset.r === '1');
    });
  },

  /* ---------- more menu ---------- */
  moreMenu(anchor) {
    const n = this.note;
    if (n.deleted) {
      UI.menu(anchor, [
        { label: 'Restaurar', icon: 'restore', onClick: async () => { await App.restore([n.id]); n.deleted = null; this.readOnly(false); UI.toast('Nota restaurada'); } },
        { label: 'Excluir definitivamente', icon: 'trash', danger: true, onClick: async () => { if (await App.purge([n.id])) { this.note = null; App.closeEditor(); } } }
      ]);
      return;
    }
    UI.menu(anchor, [
      { label: 'Estilo da página', icon: 'page', onClick: () => this.pageMenu() },
      { label: 'Mover para pasta', icon: 'move', onClick: async () => { await this.save(); await App.moveNotes([n.id]); this.renderMeta(); } },
      { label: n.locked ? 'Desbloquear nota' : 'Bloquear nota', icon: n.locked ? 'unlock' : 'lock', onClick: () => this.toggleLock() },
      { label: 'Compartilhar', icon: 'share', onClick: () => this.share() },
      { label: 'Salvar como arquivo', icon: 'download', onClick: () => this.exportMenu(anchor) },
      { label: 'Imprimir / PDF', icon: 'print', onClick: () => this.print() },
      { label: 'Duplicar nota', icon: 'duplicate', onClick: () => this.duplicate() },
      { divider: true },
      { label: App.settings.stylusOnly ? 'Desenhar com o dedo' : 'Desenhar só com a caneta', icon: 'stylus', onClick: () => { App.settings.stylusOnly = !App.settings.stylusOnly; this.ink.stylusOnly = App.settings.stylusOnly; App.saveSettings(); UI.toast(App.settings.stylusOnly ? 'Dedo rola a página, caneta desenha' : 'Dedo e caneta desenham'); } },
      { label: 'Excluir', icon: 'trash', danger: true, onClick: async () => { await this.save(); await App.trash([n.id]); this.note = null; App.closeEditor(); } }
    ]);
  },

  async toggleLock() {
    const n = this.note;
    await this.save();
    if (n.locked) {
      n.locked = false;
      n.enc = null;
      this.dirty = true;
      await this.save();
      UI.toast('Nota desbloqueada');
    } else {
      if (!(await App.ensureKey(true))) return;
      n.locked = true;
      this.dirty = true;
      await this.save();
      UI.toast('Nota bloqueada');
    }
    this.renderMeta();
  },

  plainText() {
    return (this.title.value ? this.title.value + '\n\n' : '') + this.content.innerText.trim();
  },

  async share() {
    await this.save();
    const text = this.plainText();
    if (navigator.share) {
      try { await navigator.share({ title: this.title.value || 'Nota', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); UI.toast('Texto copiado para a área de transferência'); }
    catch (_) { UI.toast('Não foi possível compartilhar'); }
  },

  exportMenu(anchor) {
    const name = (this.title.value || 'nota').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    UI.menu(anchor, [
      { label: 'Texto (.txt)', icon: 'file', onClick: () => UI.download(name + '.txt', this.plainText(), 'text/plain;charset=utf-8') },
      { label: 'Página web (.html)', icon: 'file', onClick: () => UI.download(name + '.html', this.exportHTML(), 'text/html;charset=utf-8') },
      { label: 'Imagem (.png)', icon: 'image', onClick: () => this.exportPNG(name) },
      { label: 'PDF (imprimir)', icon: 'pdf', onClick: () => this.print() }
    ]);
  },

  exportHTML() {
    const img = this.ink.strokes.length ? `<img src="${Ink.thumb(this.ink.strokes, 1000, Math.ceil(this.ink.maxY() + 40), 'rgba(0,0,0,0)')}" style="width:100%">` : '';
    return `<!DOCTYPE html><meta charset="utf-8"><title>${esc(this.title.value)}</title><body style="font-family:sans-serif;max-width:800px;margin:auto;padding:24px"><h1>${esc(this.title.value)}</h1>${this.content.innerHTML}${img}</body>`;
  },

  exportPNG(name) {
    const bg = this.pageColorValue();
    const h = Math.ceil(Math.max(this.ink.maxY() + 60, 400));
    const url = Ink.thumb(this.ink.strokes.length ? this.ink.strokes : [], 1000, h, bg);
    if (!url) { UI.toast('A nota não tem desenhos para exportar'); return; }
    fetch(url).then(r => r.blob()).then(b => UI.download(name + '.png', b));
  },

  async print() {
    await this.save();
    document.body.classList.add('printing');
    const src = this.ink.canvas.toDataURL('image/png');
    const img = document.createElement('img');
    img.className = 'print-ink'; img.src = src;
    this.page.appendChild(img);
    setTimeout(() => {
      window.print();
      setTimeout(() => { img.remove(); document.body.classList.remove('printing'); }, 500);
    }, 100);
  },

  async duplicate() {
    await this.save();
    const n = this.note;
    const copy = { ...JSON.parse(JSON.stringify(n)), id: uid(), title: (n.title || 'Nota') + ' (cópia)', createdAt: Date.now(), updatedAt: Date.now(), favorite: false };
    delete copy._new;
    if (n.locked) { copy.enc = await Crypt.encrypt(App.key, { html: this.content.innerHTML, strokes: this.ink.strokes }); }
    await DB.put('notes', copy);
    UI.toast('Nota duplicada');
  }
};

function isDarkColor(hex) {
  const m = hex.replace('#', '');
  if (m.length < 6) return false;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 110;
}

function blobToDataURL(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

function downscale(file, max) {
  return new Promise(res => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); blobToDataURL(file).then(res); };
    img.src = url;
  });
}
