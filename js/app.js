/* Open Notes — app shell: notes list, folders, selection, lock, trash, settings, backup */
const FOLDER_COLORS = ['#f2711c', '#e53935', '#f9a825', '#43a047', '#00897b', '#1e88e5', '#5e35b1', '#d81b60', '#6d4c41', '#757575'];
const TRASH_DAYS = 30;
const DEFAULT_SETTINGS = {
  theme: 'system', view: 'grid', sort: { by: 'updatedAt', dir: -1 }, favTop: true,
  stylusOnly: false, pinSalt: null, pinCheck: null, ink: null
};

const App = {
  settings: { ...DEFAULT_SETTINGS },
  notes: [],
  folders: [],
  filter: { kind: 'all', folderId: null },
  query: '',
  selecting: false,
  selected: new Set(),
  key: null,

  async init() {
    const s = await DB.get('kv', 'settings');
    this.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
    this.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    hydrateIcons();
    Editor.init();
    this.bind();
    await this.purgeOldTrash();
    await this.refresh();
    if (!(await DB.get('kv', 'welcomed'))) await this.welcome();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  saveSettings() { return DB.put('kv', this.settings, 'settings'); },

  applyTheme() {
    const t = this.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : this.settings.theme;
    document.documentElement.dataset.theme = t;
    document.getElementById('themeColor').content = t === 'dark' ? '#000000' : '#f7f7f7';
    if (Editor.note) Editor.applyPage();
  },

  async refresh() {
    this.notes = await DB.all('notes');
    this.folders = (await DB.all('folders')).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    this.render();
  },

  /* ---------- events ---------- */
  bind() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b || b.disabled) return;
      this.action(b.dataset.action, b, e);
    });
    const sc = document.getElementById('homeScroll');
    sc.addEventListener('scroll', () => this.onHomeScroll(), { passive: true });
    document.getElementById('scrim').addEventListener('click', () => this.closeDrawer());
    const si = document.getElementById('searchInput');
    si.addEventListener('input', () => { this.query = si.value.trim().toLowerCase(); this.renderList(); });
    document.getElementById('selectAll').addEventListener('change', e => {
      const list = this.visibleNotes();
      this.selected = new Set(e.target.checked ? list.map(n => n.id) : []);
      this.renderList(); this.renderSelectBar();
    });
    this.bindList();
    document.getElementById('fileBackup').addEventListener('change', e => this.importBackup(e.target.files[0]));
    document.getElementById('fileText').addEventListener('change', e => this.importText(e.target.files));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !UI.overlays.length) {
        if (!document.getElementById('editor').hidden) this.closeEditor();
        else if (this.selecting) this.endSelect();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && document.getElementById('editor').hidden) { e.preventDefault(); this.newNote(); }
    });
    window.addEventListener('beforeunload', () => Editor.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) Editor.save(); });
  },

  action(a, el) {
    switch (a) {
      case 'drawer': return this.openDrawer();
      case 'settings': this.closeDrawer(); return this.openSettings();
      case 'settings-back': return this.closeSettings();
      case 'search': return this.openSearch();
      case 'search-close': return this.closeSearch();
      case 'home-more': return this.homeMenu(el);
      case 'new-note': return this.newNote();
      case 'select-cancel': return this.endSelect();
      case 'editor-back': return this.closeEditor();
      case 'editor-more': return Editor.moreMenu(el);
      case 'undo': return Editor.undo();
      case 'redo': return Editor.redo();
      case 'toggle-fav': {
        if (!Editor.note || Editor.note.deleted) return;
        Editor.note.favorite = !Editor.note.favorite;
        Editor.updateFav(); Editor.dirty = true; Editor.save();
        return UI.toast(Editor.note.favorite ? 'Adicionada aos favoritos' : 'Removida dos favoritos');
      }
    }
  },

  onHomeScroll() {
    const sc = document.getElementById('homeScroll');
    const hero = sc.querySelector('.hero');
    const h = hero.offsetHeight - 56;
    const p = Math.max(0, Math.min(1, sc.scrollTop / Math.max(1, h)));
    hero.style.opacity = String(1 - p * 1.4);
    document.getElementById('barTitle').style.opacity = String(Math.max(0, (p - 0.6) / 0.4));
  },

  /* ---------- filtering & sorting ---------- */
  inFilter(n) {
    const f = this.filter;
    if (f.kind === 'trash') return !!n.deleted;
    if (n.deleted) return false;
    if (f.kind === 'fav') return !!n.favorite;
    if (f.kind === 'locked') return !!n.locked;
    if (f.kind === 'folder') return n.folderId === f.folderId;
    return true;
  },

  visibleNotes() {
    const q = this.query;
    let list = this.notes.filter(n => this.inFilter(n));
    if (q) list = list.filter(n => (n.title || '').toLowerCase().includes(q) || (!n.locked && ((n.preview && n.preview.text) || '').toLowerCase().includes(q)));
    const { by, dir } = this.settings.sort;
    list.sort((a, b) => {
      if (this.settings.favTop && this.filter.kind !== 'trash' && !!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      if (by === 'title') return dir * (a.title || '').localeCompare(b.title || '', 'pt-BR', { sensitivity: 'base' });
      return dir * ((a[by] || 0) - (b[by] || 0));
    });
    return list;
  },

  filterName() {
    const f = this.filter;
    if (f.kind === 'fav') return 'Favoritos';
    if (f.kind === 'locked') return 'Notas bloqueadas';
    if (f.kind === 'trash') return 'Lixeira';
    if (f.kind === 'folder') { const x = this.folders.find(x => x.id === f.folderId); return x ? x.name : 'Pasta'; }
    return 'Todas as notas';
  },

  setFilter(kind, folderId = null) {
    this.filter = { kind, folderId };
    this.endSelect(true);
    document.getElementById('homeScroll').scrollTop = 0;
    this.render();
    this.closeDrawer();
  },

  /* ---------- rendering ---------- */
  render() {
    const name = this.filterName();
    document.getElementById('heroTitle').textContent = name;
    document.getElementById('barTitle').textContent = name;
    document.getElementById('fab').hidden = this.filter.kind === 'trash' || this.selecting;
    this.renderDrawer();
    this.renderChips();
    this.renderList();
    this.onHomeScroll();
  },

  renderDrawer() {
    const live = this.notes.filter(n => !n.deleted);
    const count = { all: live.length, fav: live.filter(n => n.favorite).length, locked: live.filter(n => n.locked).length, trash: this.notes.filter(n => n.deleted).length };
    const item = (kind, ic, label, c, id) => {
      const active = this.filter.kind === kind && (kind !== 'folder' || this.filter.folderId === id);
      return `<button class="nav-item ${active ? 'active' : ''}" data-nav="${kind}" ${id ? `data-id="${id}"` : ''}>${ic}<span class="grow">${esc(label)}</span><small>${c}</small></button>`;
    };
    const folders = this.folders.map(f => {
      const c = live.filter(n => n.folderId === f.id).length;
      return `<div class="nav-folder">${item('folder', `<span class="folder-ico" style="color:${f.color}">${icon('folder')}</span>`, f.name, c, f.id)}<button class="icon-btn sm" data-fmenu="${f.id}" title="Opções da pasta">${icon('more')}</button></div>`;
    }).join('');
    document.getElementById('drawerNav').innerHTML = `
      ${item('all', icon('allnotes'), 'Todas as notas', count.all)}
      ${item('fav', icon('star'), 'Favoritos', count.fav)}
      ${item('locked', icon('lock'), 'Notas bloqueadas', count.locked)}
      ${item('trash', icon('trash'), 'Lixeira', count.trash)}
      <div class="nav-section"><span>Pastas</span><button class="icon-btn sm" data-newfolder title="Nova pasta">${icon('folderplus')}</button></div>
      ${folders || '<p class="nav-empty">Nenhuma pasta. Toque em + para criar.</p>'}`;
    const nav = document.getElementById('drawerNav');
    nav.onclick = e => {
      const fm = e.target.closest('[data-fmenu]');
      if (fm) { e.stopPropagation(); return this.folderMenu(fm, fm.dataset.fmenu); }
      if (e.target.closest('[data-newfolder]')) return this.createFolder();
      const it = e.target.closest('[data-nav]');
      if (it) this.setFilter(it.dataset.nav, it.dataset.id || null);
    };
  },

  renderChips() {
    const el = document.getElementById('folderChips');
    if (this.filter.kind !== 'all' && this.filter.kind !== 'folder' || !this.folders.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<button class="chip ${this.filter.kind === 'all' ? 'active' : ''}" data-chip="">Todas</button>` +
      this.folders.map(f => `<button class="chip ${this.filter.folderId === f.id ? 'active' : ''}" data-chip="${f.id}"><i style="background:${f.color}"></i>${esc(f.name)}</button>`).join('');
    el.onclick = e => {
      const c = e.target.closest('[data-chip]');
      if (!c) return;
      if (c.dataset.chip) this.setFilter('folder', c.dataset.chip); else this.setFilter('all');
    };
  },

  renderList() {
    const list = this.visibleNotes();
    const el = document.getElementById('noteList');
    el.className = 'notes ' + this.settings.view + (this.selecting ? ' selecting' : '');
    const n = list.length;
    document.getElementById('heroCount').textContent = this.query ? `${n} resultado${n === 1 ? '' : 's'}` : `${n} nota${n === 1 ? '' : 's'}`;
    const empty = document.getElementById('emptyState');
    empty.hidden = n > 0;
    empty.querySelector('p').textContent = this.query ? 'Nenhum resultado' : this.filter.kind === 'trash' ? 'A lixeira está vazia' : 'Nenhuma nota';
    empty.querySelector('small').textContent = this.query ? 'Tente outra palavra.' : this.filter.kind === 'trash' ? `Notas excluídas ficam aqui por ${TRASH_DAYS} dias.` : 'Toque em + para criar uma nota.';
    el.innerHTML = list.map(x => this.cardHTML(x)).join('');
  },

  cardHTML(n) {
    const f = this.folders.find(x => x.id === n.folderId);
    const sel = this.selected.has(n.id);
    const thumb = !n.locked && n.preview && n.preview.thumb;
    const text = n.locked ? '' : esc((n.preview && n.preview.text) || '');
    const pc = n.pageColor && n.pageColor !== 'default' ? n.pageColor : '';
    const dark = pc && isDarkColor(pc);
    const days = n.deleted ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - n.deleted) / 864e5)) : null;
    const prev = n.locked
      ? `<div class="card-lock">${icon('lock')}</div>`
      : thumb ? `<img src="${thumb}" alt="" loading="lazy" class="${n.preview.ink && !pc ? 'ink' : ''}">${text ? `<p class="over">${text}</p>` : ''}`
        : `<p>${text || '<span class="muted">Sem conteúdo</span>'}</p>`;
    return `<article class="card ${sel ? 'sel' : ''}" data-id="${n.id}">
      <div class="card-prev ${dark ? 'dark' : ''}" ${pc ? `style="background:${pc}"` : ''}>${prev}
        <span class="card-check">${icon('check')}</span></div>
      <div class="card-info">
        <h4>${n.favorite ? `<span class="fav">${icon('starfill')}</span>` : ''}${esc(n.title || (n.locked ? 'Nota bloqueada' : text.slice(0, 40) || 'Sem título'))}</h4>
        <div class="card-sub">${f ? `<i class="fdot" style="background:${f.color}"></i>` : ''}<span>${days !== null ? `${days} dia${days === 1 ? '' : 's'} restantes` : fmtDate(n.updatedAt)}</span>${n.locked ? icon('lock', 'mini') : ''}</div>
      </div></article>`;
  },

  bindList() {
    const el = document.getElementById('noteList');
    let timer = null, start = null, fired = false;
    el.addEventListener('pointerdown', e => {
      const c = e.target.closest('.card');
      if (!c || (e.pointerType === 'mouse' && e.button !== 0)) return;
      fired = false; start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { fired = true; navigator.vibrate && navigator.vibrate(15); this.startSelect(c.dataset.id); }, 480);
    });
    const cancel = e => { if (timer && (!start || !e || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10)) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointermove', cancel);
    el.addEventListener('pointerup', () => { clearTimeout(timer); timer = null; });
    el.addEventListener('pointercancel', () => { clearTimeout(timer); timer = null; });
    el.addEventListener('contextmenu', e => {
      const c = e.target.closest('.card');
      if (!c) return;
      e.preventDefault();
      if (!fired) this.startSelect(c.dataset.id);
    });
    el.addEventListener('click', e => {
      const c = e.target.closest('.card');
      if (!c) return;
      if (fired) { fired = false; return; }
      if (this.selecting) this.toggleSel(c.dataset.id);
      else this.openNote(c.dataset.id);
    });
  },

  /* ---------- selection mode ---------- */
  startSelect(id) {
    if (!this.selecting) {
      this.selecting = true;
      document.getElementById('home').classList.add('select-mode');
      this.selected = new Set();
    }
    if (id) this.selected.add(id);
    this.render();
    this.renderSelectBar();
  },

  endSelect(silent) {
    if (!this.selecting) return;
    this.selecting = false;
    this.selected.clear();
    document.getElementById('home').classList.remove('select-mode');
    document.getElementById('selectBar').classList.remove('show');
    if (!silent) this.render();
  },

  toggleSel(id) {
    if (this.selected.has(id)) this.selected.delete(id); else this.selected.add(id);
    const c = document.querySelector(`.card[data-id="${id}"]`);
    if (c) c.classList.toggle('sel', this.selected.has(id));
    this.renderSelectBar();
  },

  renderSelectBar() {
    const n = this.selected.size;
    const total = this.visibleNotes().length;
    document.getElementById('selectCount').textContent = n ? `${n} selecionada${n === 1 ? '' : 's'}` : 'Selecionar notas';
    document.getElementById('selectAll').checked = n > 0 && n === total;
    const bar = document.getElementById('selectBar');
    const ids = [...this.selected];
    const notes = this.notes.filter(x => this.selected.has(x.id));
    const allFav = notes.length && notes.every(x => x.favorite);
    const allLocked = notes.length && notes.every(x => x.locked);
    const btn = (a, ic, label, cls = '') => `<button data-sa="${a}" class="${cls}" ${n ? '' : 'disabled'}>${icon(ic)}<span>${label}</span></button>`;
    bar.innerHTML = this.filter.kind === 'trash'
      ? btn('restore', 'restore', 'Restaurar') + btn('purge', 'trash', 'Excluir', 'danger')
      : btn('fav', allFav ? 'starfill' : 'star', allFav ? 'Desfavoritar' : 'Favoritar') + btn('move', 'move', 'Mover') +
      btn('lock', allLocked ? 'unlock' : 'lock', allLocked ? 'Desbloquear' : 'Bloquear') + btn('trash', 'trash', 'Excluir', 'danger');
    bar.classList.toggle('show', this.selecting);
    bar.onclick = async e => {
      const b = e.target.closest('[data-sa]');
      if (!b || b.disabled) return;
      const a = b.dataset.sa;
      if (a === 'restore') await this.restore(ids);
      if (a === 'purge') { if (!(await this.purge(ids))) return; }
      if (a === 'fav') { for (const x of notes) { x.favorite = !allFav; await DB.put('notes', x); } }
      if (a === 'move') { if (!(await this.moveNotes(ids))) return; }
      if (a === 'lock') { if (!(await this.setLocked(notes, !allLocked))) return; }
      if (a === 'trash') await this.trash(ids);
      this.endSelect(true);
      await this.refresh();
    };
  },

  /* ---------- note operations ---------- */
  newNote(draw) {
    const now = Date.now();
    const n = {
      id: uid(), _new: true, title: '', html: '', strokes: [], folderId: this.filter.kind === 'folder' ? this.filter.folderId : null,
      favorite: this.filter.kind === 'fav', locked: false, enc: null, deleted: null, createdAt: now, updatedAt: now,
      pageBg: 'plain', pageColor: 'default', preview: { text: '', thumb: null }
    };
    if (draw) n._startDraw = true;
    this.showEditor(n);
  },

  async openNote(id) {
    const n = this.notes.find(x => x.id === id);
    if (!n) return;
    if (n.locked) {
      if (!(await this.ensureKey(false))) return;
      try {
        const data = await Crypt.decrypt(this.key, n.enc);
        this.showEditor(n, data);
      } catch (_) { UI.toast('Não foi possível abrir a nota'); }
      return;
    }
    this.showEditor(n);
  },

  showEditor(n, data) {
    this.closeSearch(true);
    Editor.open(n, data);
    this._edBack = () => Editor.close();
    Nav.push(this._edBack);
  },

  closeEditor() {
    if (this._edBack) { Nav.close(this._edBack); this._edBack = null; }
    return Editor.close();
  },

  async trash(ids) {
    for (const id of ids) {
      const n = this.notes.find(x => x.id === id) || (Editor.note && Editor.note.id === id ? Editor.note : null);
      if (!n) continue;
      n.deleted = Date.now();
      delete n._new;
      await DB.put('notes', n);
    }
    UI.toast(ids.length === 1 ? 'Nota movida para a lixeira' : `${ids.length} notas movidas para a lixeira`);
  },

  async restore(ids) {
    for (const id of ids) {
      const n = this.notes.find(x => x.id === id);
      if (!n) continue;
      n.deleted = null;
      if (n.folderId && !this.folders.some(f => f.id === n.folderId)) n.folderId = null;
      await DB.put('notes', n);
    }
    UI.toast('Restaurada' + (ids.length > 1 ? 's' : ''));
  },

  async purge(ids) {
    const ok = await UI.confirm({ title: ids.length === 1 ? 'Excluir nota definitivamente?' : `Excluir ${ids.length} notas definitivamente?`, message: 'Esta ação não pode ser desfeita.', ok: 'Excluir', danger: true });
    if (!ok) return false;
    for (const id of ids) await DB.del('notes', id);
    await this.refresh();
    return true;
  },

  async purgeOldTrash() {
    const all = await DB.all('notes');
    const limit = Date.now() - TRASH_DAYS * 864e5;
    for (const n of all) if (n.deleted && n.deleted < limit) await DB.del('notes', n.id);
  },

  async moveNotes(ids) {
    const items = [{ label: 'Sem pasta', value: '__none', icon: 'allnotes' },
      ...this.folders.map(f => ({ label: f.name, value: f.id, color: f.color })),
      { label: 'Nova pasta', value: '__new', icon: 'folderplus' }];
    let v = await UI.sheet({ title: 'Mover para', items });
    if (!v) return false;
    if (v === '__new') { const f = await this.createFolder(); if (!f) return false; v = f.id; }
    const folderId = v === '__none' ? null : v;
    for (const id of ids) {
      const n = this.notes.find(x => x.id === id) || (Editor.note && Editor.note.id === id ? Editor.note : null);
      if (!n) continue;
      n.folderId = folderId;
      if (!n._new) await DB.put('notes', n);
    }
    const f = this.folders.find(x => x.id === folderId);
    UI.toast(f ? `Movida para "${f.name}"` : 'Removida da pasta');
    if (document.getElementById('editor').hidden) await this.refresh();
    return true;
  },

  async setLocked(notes, lock) {
    if (!(await this.ensureKey(lock))) return false;
    for (const n of notes) {
      if (lock && !n.locked) {
        n.enc = await Crypt.encrypt(this.key, { html: n.html || '', strokes: n.strokes || [] });
        n.locked = true; n.html = ''; n.strokes = []; n.preview = { text: '', thumb: null };
      } else if (!lock && n.locked) {
        const d = await Crypt.decrypt(this.key, n.enc);
        n.locked = false; n.enc = null; n.html = d.html; n.strokes = d.strokes;
        const tmp = document.createElement('div'); tmp.innerHTML = d.html;
        n.preview = { text: tmp.textContent.replace(/\s+/g, ' ').trim().slice(0, 300), thumb: Ink.thumb(d.strokes, 300, 400, 'rgba(0,0,0,0)'), ink: !!(d.strokes && d.strokes.length) };
      }
      await DB.put('notes', n);
    }
    UI.toast(lock ? 'Notas bloqueadas' : 'Notas desbloqueadas');
    return true;
  },

  /* ---------- PIN / encryption key ---------- */
  async ensureKey(createIfMissing) {
    if (this.key) return true;
    if (!Crypt.available()) { UI.toast('Bloqueio requer HTTPS ou localhost'); return false; }
    const s = this.settings;
    if (s.pinCheck) {
      for (let tries = 0; tries < 5; tries++) {
        const pin = await UI.pin({ title: 'Notas bloqueadas', subtitle: tries ? 'PIN incorreto. Tente novamente.' : 'Digite seu PIN para continuar.' });
        if (!pin) return false;
        const key = await Crypt.deriveKey(pin, s.pinSalt);
        try { await Crypt.decrypt(key, s.pinCheck); this.key = key; return true; } catch (_) {}
      }
      UI.toast('Muitas tentativas');
      return false;
    }
    if (!createIfMissing) return false;
    return this.setNewPin();
  },

  async setNewPin(oldKey) {
    const p1 = await UI.pin({ title: 'Criar PIN', subtitle: 'Use pelo menos 4 dígitos. Não há como recuperar notas se você esquecer o PIN.' });
    if (!p1) return false;
    const p2 = await UI.pin({ title: 'Confirmar PIN', subtitle: 'Digite o PIN novamente.' });
    if (!p2) return false;
    if (p1 !== p2) { UI.toast('Os PINs não coincidem'); return false; }
    const salt = Crypt.newSalt();
    const key = await Crypt.deriveKey(p1, salt);
    if (oldKey) {
      // re-encrypt every locked note with the new key
      for (const n of await DB.all('notes')) {
        if (!n.locked || !n.enc) continue;
        const d = await Crypt.decrypt(oldKey, n.enc);
        n.enc = await Crypt.encrypt(key, d);
        await DB.put('notes', n);
      }
    }
    this.settings.pinSalt = salt;
    this.settings.pinCheck = await Crypt.encrypt(key, 'open-notes');
    await this.saveSettings();
    this.key = key;
    UI.toast('PIN definido');
    return true;
  },

  async changePin() {
    if (!this.settings.pinCheck) return this.setNewPin();
    this.key = null;
    if (!(await this.ensureKey(false))) return;
    await this.setNewPin(this.key);
    await this.refresh();
  },

  /* ---------- folders ---------- */
  async createFolder() {
    const name = await UI.prompt({ title: 'Nova pasta', placeholder: 'Nome da pasta', ok: 'Criar' });
    if (!name) return null;
    const f = { id: uid(), name, color: FOLDER_COLORS[this.folders.length % FOLDER_COLORS.length], createdAt: Date.now(), order: this.folders.length };
    await DB.put('folders', f);
    await this.refresh();
    return f;
  },

  folderMenu(anchor, id) {
    const f = this.folders.find(x => x.id === id);
    if (!f) return;
    UI.menu(anchor, [
      { label: 'Renomear', icon: 'edit', onClick: async () => { const v = await UI.prompt({ title: 'Renomear pasta', value: f.name }); if (v) { f.name = v; await DB.put('folders', f); this.refresh(); } } },
      { label: 'Alterar cor', icon: 'palette', onClick: () => Editor.colorPopup(anchor, FOLDER_COLORS, f.color, async c => { f.color = c; await DB.put('folders', f); this.refresh(); }) },
      { label: 'Excluir pasta', icon: 'trash', danger: true, onClick: () => this.deleteFolder(f) }
    ]);
  },

  async deleteFolder(f) {
    const inside = this.notes.filter(n => n.folderId === f.id && !n.deleted);
    const ok = await UI.confirm({ title: `Excluir "${f.name}"?`, message: inside.length ? `${inside.length} nota(s) desta pasta serão movidas para a lixeira.` : 'A pasta está vazia.', ok: 'Excluir', danger: true });
    if (!ok) return;
    for (const n of inside) { n.deleted = Date.now(); n.folderId = null; await DB.put('notes', n); }
    await DB.del('folders', f.id);
    if (this.filter.folderId === f.id) this.filter = { kind: 'all', folderId: null };
    await this.refresh();
  },

  /* ---------- drawer / search / menus ---------- */
  isWide() { return window.matchMedia('(min-width: 960px)').matches; },

  openDrawer() {
    if (this.isWide()) { document.getElementById('app').classList.toggle('drawer-collapsed'); return; }
    document.getElementById('app').classList.add('drawer-open');
    this._drBack = () => document.getElementById('app').classList.remove('drawer-open');
    Nav.push(this._drBack);
  },
  closeDrawer() {
    const app = document.getElementById('app');
    if (!app.classList.contains('drawer-open')) return;
    app.classList.remove('drawer-open');
    if (this._drBack) { Nav.close(this._drBack); this._drBack = null; }
  },

  openSearch() {
    document.getElementById('homeBar').classList.add('searching');
    const si = document.getElementById('searchInput');
    si.value = ''; this.query = '';
    setTimeout(() => si.focus(), 30);
    const sc = document.getElementById('homeScroll');
    const hero = sc.querySelector('.hero');
    if (sc.scrollTop < hero.offsetHeight - 56) sc.scrollTop = hero.offsetHeight - 56;
  },
  closeSearch(silent) {
    const bar = document.getElementById('homeBar');
    if (!bar.classList.contains('searching')) return;
    bar.classList.remove('searching');
    this.query = '';
    document.getElementById('searchInput').value = '';
    if (!silent) this.renderList();
  },

  homeMenu(anchor) {
    const s = this.settings;
    const items = [];
    if (this.filter.kind === 'trash') {
      items.push({ label: 'Editar', icon: 'select', onClick: () => this.startSelect() });
      items.push({ label: 'Esvaziar lixeira', icon: 'trash', danger: true, onClick: async () => { const ids = this.notes.filter(n => n.deleted).map(n => n.id); if (ids.length) await this.purge(ids); } });
    } else {
      items.push({ label: 'Editar', icon: 'select', onClick: () => this.startSelect() });
      items.push({ label: 'Nova nota de desenho', icon: 'pen', onClick: () => this.newNote(true) });
      items.push({ label: 'Importar texto (.txt)', icon: 'upload', onClick: () => document.getElementById('fileText').click() });
    }
    items.push({ divider: true });
    items.push({ label: 'Visualização: ' + ({ grid: 'Grade', list: 'Lista', compact: 'Lista simples' })[s.view], icon: s.view === 'grid' ? 'grid' : 'list', onClick: () => this.chooseView() });
    items.push({ label: 'Ordenar', icon: 'sort', onClick: () => this.chooseSort() });
    items.push({ label: 'Configurações', icon: 'settings', onClick: () => this.openSettings() });
    UI.menu(anchor, items);
  },

  async chooseView() {
    const v = await UI.sheet({ title: 'Visualização', items: [
      { label: 'Grade', value: 'grid', icon: 'grid', active: this.settings.view === 'grid' },
      { label: 'Lista', value: 'list', icon: 'list', active: this.settings.view === 'list' },
      { label: 'Lista simples', value: 'compact', icon: 'alignleft', active: this.settings.view === 'compact' }] });
    if (!v) return;
    this.settings.view = v; await this.saveSettings(); this.renderList();
  },

  async chooseSort() {
    const s = this.settings.sort;
    const v = await UI.sheet({ title: 'Ordenar por', items: [
      { label: 'Data de modificação', value: 'updatedAt', active: s.by === 'updatedAt' },
      { label: 'Data de criação', value: 'createdAt', active: s.by === 'createdAt' },
      { label: 'Título', value: 'title', active: s.by === 'title' },
      { label: s.dir === -1 ? 'Ordem: decrescente' : 'Ordem: crescente', value: '__dir', icon: 'sort' },
      { label: (this.settings.favTop ? '✓ ' : '') + 'Favoritos no topo', value: '__fav', icon: 'star' }] });
    if (!v) return;
    if (v === '__dir') s.dir = -s.dir;
    else if (v === '__fav') this.settings.favTop = !this.settings.favTop;
    else { s.by = v; s.dir = v === 'title' ? 1 : -1; }
    await this.saveSettings(); this.renderList();
  },

  /* ---------- settings ---------- */
  openSettings() {
    this.renderSettings();
    document.getElementById('settings').hidden = false;
    this._stBack = () => { document.getElementById('settings').hidden = true; };
    Nav.push(this._stBack);
  },
  closeSettings() {
    document.getElementById('settings').hidden = true;
    if (this._stBack) { Nav.close(this._stBack); this._stBack = null; }
  },

  renderSettings() {
    const s = this.settings;
    const row = (id, ic, title, sub, right = '') => `<button class="set-row" data-set="${id}">${icon(ic)}<span class="grow"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${right}</button>`;
    const toggle = on => `<span class="switch ${on ? 'on' : ''}"><i></i></span>`;
    const body = document.getElementById('settingsBody');
    body.innerHTML = `
      <div class="set-group"><h5>Aparência</h5>
        ${row('theme', 'theme', 'Tema', ({ system: 'Padrão do sistema', light: 'Claro', dark: 'Escuro' })[s.theme])}
        ${row('view', 'grid', 'Visualização das notas', ({ grid: 'Grade', list: 'Lista', compact: 'Lista simples' })[s.view])}
      </div>
      <div class="set-group"><h5>Caneta</h5>
        ${row('stylus', 'stylus', 'Desenhar só com a caneta', 'Use o dedo para rolar a página e a caneta (stylus) para escrever', toggle(s.stylusOnly))}
      </div>
      <div class="set-group"><h5>Privacidade</h5>
        ${row('pin', 'key', s.pinCheck ? 'Alterar PIN das notas bloqueadas' : 'Definir PIN das notas bloqueadas', 'Notas bloqueadas são criptografadas (AES-256) com este PIN')}
        ${row('lockall', 'lock', 'Bloquear agora', 'Exige o PIN novamente para abrir notas bloqueadas')}
      </div>
      <div class="set-group"><h5>Dados</h5>
        ${row('export', 'download', 'Exportar backup', 'Salva todas as notas e pastas em um arquivo .json')}
        ${row('import', 'upload', 'Restaurar backup', 'Importa notas de um arquivo .json do Open Notes')}
        ${row('trashinfo', 'trash', 'Lixeira', `Notas excluídas são apagadas após ${TRASH_DAYS} dias`)}
      </div>
      <div class="set-group"><h5>Sobre</h5>
        ${row('about', 'info', 'Open Notes 1.0', 'Aplicativo de notas de código aberto (MIT). Seus dados ficam só no seu dispositivo.')}
      </div>`;
    body.onclick = async e => {
      const r = e.target.closest('[data-set]');
      if (!r) return;
      const k = r.dataset.set;
      if (k === 'theme') {
        const v = await UI.sheet({ title: 'Tema', items: [['system', 'Padrão do sistema'], ['light', 'Claro'], ['dark', 'Escuro']].map(([v, l]) => ({ label: l, value: v, active: s.theme === v })) });
        if (v) { s.theme = v; await this.saveSettings(); this.applyTheme(); }
      }
      if (k === 'view') await this.chooseView();
      if (k === 'stylus') { s.stylusOnly = !s.stylusOnly; Editor.ink.stylusOnly = s.stylusOnly; await this.saveSettings(); }
      if (k === 'pin') await this.changePin();
      if (k === 'lockall') { this.key = null; UI.toast('Notas bloqueadas protegidas'); }
      if (k === 'export') await this.exportBackup();
      if (k === 'import') document.getElementById('fileBackup').click();
      this.renderSettings();
    };
  },

  async exportBackup() {
    const data = {
      app: 'open-notes', version: 1, exportedAt: new Date().toISOString(),
      notes: await DB.all('notes'), folders: await DB.all('folders'),
      lock: { pinSalt: this.settings.pinSalt, pinCheck: this.settings.pinCheck }
    };
    const d = new Date().toISOString().slice(0, 10);
    UI.download(`open-notes-backup-${d}.json`, JSON.stringify(data), 'application/json');
    UI.toast('Backup exportado');
  },

  async importBackup(file) {
    document.getElementById('fileBackup').value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { UI.toast('Arquivo inválido'); return; }
    if (data.app !== 'open-notes' || !Array.isArray(data.notes)) { UI.toast('Este não é um backup do Open Notes'); return; }
    const locked = data.notes.filter(n => n.locked).length;
    const ok = await UI.confirm({ title: 'Restaurar backup?', message: `${data.notes.length} nota(s) e ${(data.folders || []).length} pasta(s) serão adicionadas. Notas com o mesmo ID serão substituídas.`, ok: 'Restaurar' });
    if (!ok) return;
    if (locked && data.lock && data.lock.pinCheck && (!this.settings.pinCheck || this.settings.pinSalt !== data.lock.pinSalt)) {
      if (this.settings.pinCheck && !(await UI.confirm({ title: 'PIN diferente', message: 'O backup usa outro PIN para as notas bloqueadas. O PIN do backup passará a ser usado neste aparelho. Notas bloqueadas atuais podem ficar inacessíveis.', ok: 'Continuar' }))) return;
      this.settings.pinSalt = data.lock.pinSalt;
      this.settings.pinCheck = data.lock.pinCheck;
      this.key = null;
      await this.saveSettings();
    }
    for (const f of data.folders || []) await DB.put('folders', f);
    for (const n of data.notes) await DB.put('notes', n);
    await this.refresh();
    UI.toast('Backup restaurado');
  },

  async importText(files) {
    for (const f of [...files]) {
      const text = await f.text();
      const now = Date.now();
      const html = text.split(/\r?\n/).map(l => `<div>${esc(l) || '<br>'}</div>`).join('');
      await DB.put('notes', {
        id: uid(), title: f.name.replace(/\.txt$/i, ''), html, strokes: [], folderId: this.filter.kind === 'folder' ? this.filter.folderId : null,
        favorite: false, locked: false, enc: null, deleted: null, createdAt: now, updatedAt: now, pageBg: 'plain', pageColor: 'default',
        preview: { text: text.replace(/\s+/g, ' ').trim().slice(0, 300), thumb: null }
      });
    }
    document.getElementById('fileText').value = '';
    await this.refresh();
    UI.toast('Texto importado');
  },

  async welcome() {
    await DB.put('kv', true, 'welcomed');
    if (this.notes.length) return;
    const now = Date.now();
    await DB.put('notes', {
      id: uid(), title: 'Bem-vindo ao Open Notes', folderId: null, favorite: true, locked: false, enc: null, deleted: null,
      createdAt: now, updatedAt: now, pageBg: 'lined', pageColor: 'default', strokes: [],
      html: '<div>Seu caderno digital, livre e de código aberto.</div><div><br></div><h2>O que você pode fazer</h2>' +
        '<ul class="checklist"><li class="done">Escrever com texto formatado</li><li>Desenhar e escrever à mão com caneta, lápis, caneta-tinteiro, pincel e marca-texto</li>' +
        '<li>Inserir imagens, fotos da câmera, gravações de voz e tabelas</li><li>Organizar em pastas coloridas e favoritos</li>' +
        '<li>Bloquear notas com PIN (criptografia AES-256)</li><li>Exportar como texto, HTML, imagem ou PDF</li></ul>' +
        '<div><br></div><div>Toque longo em uma nota para selecionar várias. Instale o app pelo menu do navegador ("Adicionar à tela inicial").</div>',
      preview: { text: 'Seu caderno digital, livre e de código aberto. O que você pode fazer...', thumb: null }
    });
    await this.refresh();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init().catch(err => { console.error(err); UI.toast('Erro ao iniciar: ' + err.message, 6000); }));
