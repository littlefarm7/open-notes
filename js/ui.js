/* Open Notes — UI primitives: toast, dialogs, menus, sheets, back-button navigation */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Back-button aware navigation for full views (editor, settings, drawer). */
const Nav = {
  stack: [],
  push(onBack) {
    this.stack.push(onBack);
    history.pushState({ on: this.stack.length }, '');
  },
  close(onBack) {
    const i = this.stack.lastIndexOf(onBack);
    if (i < 0) return;
    this.stack.splice(i, 1);
    this.ignore++;
    history.back();
  },
  ignore: 0
};
window.addEventListener('popstate', () => {
  if (Nav.ignore > 0) { Nav.ignore--; return; }
  if (UI.overlays.length) {           // back closes the top dialog first
    UI.overlays[UI.overlays.length - 1].dismiss();
    history.pushState({ on: Nav.stack.length }, '');
    return;
  }
  const f = Nav.stack.pop();
  if (f) f();
});

const UI = {
  overlays: [],

  toast(msg, ms = 2200) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), ms);
  },

  overlay(inner, { cls = 'dialog', onDismiss, transparent } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'overlay' + (transparent ? ' clear' : '');
    wrap.innerHTML = `<div class="${cls}">${inner}</div>`;
    document.getElementById('layer').appendChild(wrap);
    hydrateIcons(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const entry = {
      el: wrap,
      box: wrap.firstElementChild,
      close() {
        const i = UI.overlays.indexOf(entry);
        if (i >= 0) UI.overlays.splice(i, 1);
        wrap.classList.remove('in');
        setTimeout(() => wrap.remove(), 180);
      },
      dismiss() { entry.close(); onDismiss && onDismiss(); }
    };
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) wrap._down = true; });
    wrap.addEventListener('click', e => { if (e.target === wrap && wrap._down) entry.dismiss(); wrap._down = false; });
    UI.overlays.push(entry);
    return entry;
  },

  confirm({ title = '', message = '', ok = 'OK', cancel = 'Cancelar', danger = false } = {}) {
    return new Promise(res => {
      const o = this.overlay(`
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        ${message ? `<p class="dlg-msg">${esc(message)}</p>` : ''}
        <div class="dlg-actions">
          <button class="text-btn" data-r="0">${esc(cancel)}</button>
          <button class="text-btn ${danger ? 'danger' : 'accent'}" data-r="1">${esc(ok)}</button>
        </div>`, { onDismiss: () => res(false) });
      o.box.addEventListener('click', e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        o.close(); res(b.dataset.r === '1');
      });
    });
  },

  prompt({ title = '', value = '', placeholder = '', ok = 'Salvar', type = 'text', inputmode = '' } = {}) {
    return new Promise(res => {
      const o = this.overlay(`
        <h3>${esc(title)}</h3>
        <input class="dlg-input" type="${type}" ${inputmode ? `inputmode="${inputmode}"` : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120">
        <div class="dlg-actions">
          <button class="text-btn" data-r="0">Cancelar</button>
          <button class="text-btn accent" data-r="1">${esc(ok)}</button>
        </div>`, { onDismiss: () => res(null) });
      const inp = o.box.querySelector('input');
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      const done = v => { o.close(); res(v); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value.trim()); });
      o.box.addEventListener('click', e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        done(b.dataset.r === '1' ? inp.value.trim() : null);
      });
    });
  },

  pin({ title = 'Digite o PIN', subtitle = '' } = {}) {
    return new Promise(res => {
      const o = this.overlay(`
        <div class="pin-ico">${icon('lock')}</div>
        <h3 class="center">${esc(title)}</h3>
        ${subtitle ? `<p class="dlg-msg center">${esc(subtitle)}</p>` : ''}
        <input class="dlg-input pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="16" autocomplete="off" placeholder="••••">
        <p class="pin-err" hidden></p>
        <div class="dlg-actions">
          <button class="text-btn" data-r="0">Cancelar</button>
          <button class="text-btn accent" data-r="1">Continuar</button>
        </div>`, { onDismiss: () => res(null) });
      const inp = o.box.querySelector('input');
      const err = o.box.querySelector('.pin-err');
      setTimeout(() => inp.focus(), 60);
      const submit = () => {
        const v = inp.value.replace(/\D/g, '');
        if (v.length < 4) { err.hidden = false; err.textContent = 'O PIN deve ter pelo menos 4 dígitos.'; return; }
        o.close(); res(v);
      };
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, ''); err.hidden = true; });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      o.box.addEventListener('click', e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        if (b.dataset.r === '1') submit(); else { o.close(); res(null); }
      });
    });
  },

  /* Popup menu anchored to an element. items: {label, icon, onClick, checked, danger, divider} */
  menu(anchor, items) {
    const html = items.map((it, i) => it.divider ? '<div class="menu-div"></div>' :
      `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
        ${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.checked ? icon('check', 'tick') : ''}
      </button>`).join('');
    const o = this.overlay(html, { cls: 'menu', transparent: true });
    const r = anchor.getBoundingClientRect();
    const m = o.box;
    const vw = window.innerWidth, vh = window.innerHeight;
    m.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      const mw = m.offsetWidth, mh = m.offsetHeight;
      let left = Math.min(Math.max(8, r.right - mw), vw - mw - 8);
      let top = r.bottom + 4;
      if (top + mh > vh - 8) top = Math.max(8, r.top - mh - 4);
      m.style.left = left + 'px';
      m.style.top = top + 'px';
      m.style.visibility = '';
    });
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      o.close();
      const it = items[+b.dataset.i];
      it.onClick && it.onClick();
    });
    return o;
  },

  /* Bottom sheet with a list of choices. Resolves with the chosen item's value or null. */
  sheet({ title = '', items = [], footer = '' }) {
    return new Promise(res => {
      const html = `<div class="sheet-grip"></div>${title ? `<h3>${esc(title)}</h3>` : ''}
        <div class="sheet-list">${items.map((it, i) => `
          <button class="sheet-item ${it.active ? 'active' : ''}" data-i="${i}">
            ${it.color ? `<span class="swatch" style="background:${it.color}"></span>` : it.icon ? icon(it.icon) : ''}
            <span class="grow">${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}
            ${it.active ? icon('check', 'tick') : ''}
          </button>`).join('')}</div>${footer}`;
      const o = this.overlay(html, { cls: 'sheet', onDismiss: () => res(null) });
      o.box.addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (!b) return;
        o.close(); res(items[+b.dataset.i].value);
      });
    });
  },

  download(filename, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
};

function fmtDate(ts, withTime) {
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts = sameDay ? { hour: '2-digit', minute: '2-digit' }
    : d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime && !sameDay) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('pt-BR', opts).replace('.', '');
}
