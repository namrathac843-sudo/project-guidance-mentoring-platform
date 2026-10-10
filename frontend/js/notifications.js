/* =====================================================================
   notifications.js — Full notifications page + shared rendering helpers
   =====================================================================
   The topbar bell dropdown is handled by app.js. This module renders the
   dedicated notifications page and provides a small public API that the
   rest of the app can call to keep the count in sync.
   ===================================================================== */

window.PGMPNotifications = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }

  // ---------- Rendering ----------
  function iconFor(type) {
    return ({ project: '📁', mentoring: '🎓', session: '📅', message: '💬', account: '⚙' })[type] || '🔔';
  }

  function renderItem(n) {
    return `
      <li class="notification-item ${n.read ? '' : 'is-unread'}"
          data-notif-id="${esc(n.id)}"
          ${n.link ? `data-notif-link="${esc(n.link)}"` : ''}>
        <span class="notification-icon is-${esc(n.type)}" aria-hidden="true">${iconFor(n.type)}</span>
        <div class="notification-body">
          <strong>${esc(n.title)}</strong>
          <p>${esc(n.message)}</p>
          <span class="notification-meta">${esc(new Date(n.createdAt).toLocaleString())}</span>
        </div>
        <div class="notification-actions">
          ${n.read ? '' : `<button type="button" data-action="read" data-id="${esc(n.id)}" title="Mark as read">●</button>`}
          <button type="button" data-action="delete" data-id="${esc(n.id)}" title="Delete">✕</button>
        </div>
      </li>`;
  }

  function applyFilters(list) {
    const q = (el('notif-search').value || '').trim().toLowerCase();
    const type = el('notif-type').value;
    const readFilter = el('notif-read').value;

    let rows = list.slice();
    if (q) rows = rows.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.message || '').toLowerCase().includes(q));
    if (type) rows = rows.filter(n => n.type === type);
    if (readFilter === 'unread') rows = rows.filter(n => !n.read);
    if (readFilter === 'read') rows = rows.filter(n => n.read);
    return rows;
  }

  function renderPage() {
    const user = S().getCurrentUser();
    if (!user) return;
    const all = S().notifications.forUser(user.id);
    const list = applyFilters(all);

    const wrap = el('notification-list');
    const empty = el('notif-empty');
    el('notif-count').textContent = `${list.length} notification${list.length === 1 ? '' : 's'}`;

    if (!list.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    wrap.innerHTML = list.map(renderItem).join('');

    wrap.querySelectorAll('.notification-item').forEach(li => {
      li.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return; // buttons handle their own click
        const id = li.dataset.notifId;
        const n = S().notifications.byId(id);
        if (!n) return;
        if (!n.read) S().notifications.update(id, { read: true });
        const link = li.dataset.notifLink;
        if (link) window.location.href = link;
        else { P().refreshBell(user.id); renderPage(); }
      });
    });

    wrap.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (btn.dataset.action === 'read') {
          S().notifications.update(id, { read: true });
        } else if (btn.dataset.action === 'delete') {
          S().notifications.remove(id);
        }
        P().refreshBell(user.id);
        renderPage();
      });
    });
  }

  function wirePageEvents() {
    ['notif-search', 'notif-type', 'notif-read'].forEach(id => {
      el(id)?.addEventListener('input', renderPage);
      el(id)?.addEventListener('change', renderPage);
    });

    el('notif-clear-filters')?.addEventListener('click', () => {
      el('notif-search').value = '';
      el('notif-type').value = '';
      el('notif-read').value = '';
      renderPage();
    });

    el('btn-mark-all-read')?.addEventListener('click', () => {
      const user = S().getCurrentUser();
      S().notifications.forUser(user.id).forEach(n => {
        if (!n.read) S().notifications.update(n.id, { read: true });
      });
      P().refreshBell(user.id);
      renderPage();
      P().toast({ type: 'success', title: 'All notifications marked as read' });
    });

    el('btn-clear-all')?.addEventListener('click', async () => {
      const ok = await P().confirm({
        title: 'Clear all notifications?',
        message: 'This removes every notification from this browser. It cannot be undone.',
        confirmLabel: 'Clear all',
      });
      if (!ok) return;
      const user = S().getCurrentUser();
      S().notifications.removeWhere(n => n.userId === user.id);
      P().refreshBell(user.id);
      renderPage();
      P().toast({ type: 'info', title: 'Notifications cleared' });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'notifications') return;
    if (!S() || !S().isLoggedIn()) return;
    wirePageEvents();
    renderPage();
  });

  return { renderPage };
})();