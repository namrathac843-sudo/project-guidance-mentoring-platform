/* =====================================================================
   messages.js — Simple message store UI (Local Storage demo)
   ===================================================================== */

window.PGMPMessages = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  let activePartnerId = null;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }
  function initials(name) { return P().initials(name); }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString();
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  // ---------- Access rules ----------
  function mayConverse(user, other) {
    if (!other || other.id === user.id) return false;
    const a = user.role, b = other.role;
    if (a === 'admin' || b === 'admin') return true;
    if (a === 'student' && (b === 'lecturer' || b === 'alumni')) return true;
    if (b === 'student' && (a === 'lecturer' || a === 'alumni')) return true;
    if (a === 'lecturer' && (b === 'lecturer' || b === 'alumni')) return true;
    if (a === 'alumni' && (b === 'lecturer' || b === 'alumni')) return true;
    return false;
  }

  // ---------- Conversations list ----------
  function buildConversations(user) {
    const all = S().messages.all();
    const buckets = {};
    all.forEach(m => {
      if (m.senderId !== user.id && m.receiverId !== user.id) return;
      const other = m.senderId === user.id ? m.receiverId : m.senderId;
      const bucket = buckets[other] = buckets[other] || {
        otherId: other,
        lastAt: '',
        lastBody: '',
        unread: 0,
      };
      if (m.createdAt >= bucket.lastAt) {
        bucket.lastAt = m.createdAt;
        bucket.lastBody = m.body;
      }
      if (m.receiverId === user.id && !m.read) bucket.unread++;
    });

    const list = Object.values(buckets);
    list.forEach(c => {
      const u = S().users.byId(c.otherId);
      c.name = u ? u.fullName : 'Unknown';
      c.role = u ? u.role : '';
      c.avatar = u ? u.avatar : '';
    });
    list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return list;
  }

  function renderConversations() {
    const user = S().getCurrentUser();
    const search = (el('chat-search').value || '').trim().toLowerCase();
    let list = buildConversations(user);
    if (search) list = list.filter(c => (c.name || '').toLowerCase().includes(search));

    const wrap = el('conversation-list');
    const empty = el('conversations-empty');

    if (!list.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    wrap.innerHTML = list.map(c => {
      const avatar = c.avatar ? `<img src="${esc(c.avatar)}" alt="" />` : initials(c.name);
      const active = c.otherId === activePartnerId ? 'is-active' : '';
      return `
        <li class="conversation-item ${active}" data-partner-id="${esc(c.otherId)}">
          <span class="avatar">${avatar}</span>
          <div class="conv-body">
            <div class="conv-top">
              <strong>${esc(c.name)}</strong>
              <small>${esc(timeAgo(c.lastAt))}</small>
            </div>
            <div class="conv-preview">${esc(c.lastBody).slice(0, 80)}</div>
          </div>
          ${c.unread ? `<span class="conv-unread">${c.unread}</span>` : ''}
        </li>`;
    }).join('');

    wrap.querySelectorAll('.conversation-item').forEach(li => {
      li.addEventListener('click', () => openThread(li.dataset.partnerId));
    });
  }

  // ---------- Thread ----------
  function openThread(partnerId) {
    const user = S().getCurrentUser();
    const other = S().users.byId(partnerId);
    if (!other) return;
    activePartnerId = partnerId;

    // Mark messages as read.
    S().messages.filter(m => m.senderId === partnerId && m.receiverId === user.id && !m.read)
      .forEach(m => S().messages.update(m.id, { read: true }));

    el('chat-empty').hidden = true;
    el('chat-active').hidden = false;
    el('chat-layout').classList.add('is-thread-open');

    const avatar = other.avatar ? `<img src="${esc(other.avatar)}" alt="" />` : initials(other.fullName);
    el('chat-avatar').innerHTML = avatar;
    el('chat-user-name').textContent = other.fullName;
    el('chat-user-meta').textContent = `${other.role}${other.department ? ' · ' + other.department : ''}`;

    renderThread();
    renderConversations();
  }

  function renderThread() {
    const user = S().getCurrentUser();
    const thread = S().messages.thread(user.id, activePartnerId).slice();
    const wrap = el('chat-thread');

    if (!thread.length) {
      wrap.innerHTML = `<div class="empty-state empty-state--small"><p>No messages yet. Say hello.</p></div>`;
      return;
    }

    let lastDay = null;
    wrap.innerHTML = thread.map(m => {
      const day = fmtDay(m.createdAt);
      let dayMarker = '';
      if (day !== lastDay) { dayMarker = `<div class="msg-day">${esc(day)}</div>`; lastDay = day; }
      const cls = m.senderId === user.id ? 'msg-out' : 'msg-in';
      return `${dayMarker}
        <div class="msg ${cls}">
          ${esc(m.body)}
          <div class="msg-meta">${esc(fmtTime(m.createdAt))}</div>
        </div>`;
    }).join('');

    wrap.scrollTop = wrap.scrollHeight;
  }

  // ---------- Send ----------
  function sendMessage(ev) {
    ev.preventDefault();
    const user = S().getCurrentUser();
    const input = el('chat-input');
    const body = input.value.trim();
    if (!body) return;
    if (!activePartnerId) return;
    const other = S().users.byId(activePartnerId);
    if (!other || !mayConverse(user, other)) return;

    S().messages.insert({
      id: S().newId('msg'),
      senderId: user.id,
      senderName: user.fullName,
      receiverId: other.id,
      receiverName: other.fullName,
      body,
      read: false,
      createdAt: S().nowIso(),
    });

    S().notify(other.id, 'message', 'New message',
      `${user.fullName}: ${body.slice(0, 80)}${body.length > 80 ? '…' : ''}`,
      'messages.html', { senderId: user.id });

    input.value = '';
    renderThread();
    renderConversations();
  }

  // ---------- Contacts picker ----------
  function openContacts() {
    const user = S().getCurrentUser();
    const search = (el('contact-search').value || '').trim().toLowerCase();
    const all = S().users.all().filter(u => u.id !== user.id && u.status === 'Active' && mayConverse(user, u));
    let list = all;
    if (search) list = list.filter(u =>
      (u.fullName || '').toLowerCase().includes(search) ||
      (u.role || '').toLowerCase().includes(search) ||
      (u.department || '').toLowerCase().includes(search)
    );
    const wrap = el('contact-list');
    const empty = el('contacts-empty');
    if (!list.length) { wrap.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    wrap.innerHTML = list.map(u => `
      <li class="contact-item" data-contact-id="${esc(u.id)}">
        <span class="avatar">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" />` : initials(u.fullName)}</span>
        <div class="who">
          <strong>${esc(u.fullName)}</strong>
          <small>${esc(u.department || u.email || '')}</small>
        </div>
        <span class="role-tag">${esc(u.role)}</span>
      </li>`).join('');
    wrap.querySelectorAll('.contact-item').forEach(li => {
      li.addEventListener('click', () => {
        P().closeModal('modal-contacts');
        openThread(li.dataset.contactId);
      });
    });
  }

  // ---------- Wire ----------
  function wireEvents() {
    el('chat-composer')?.addEventListener('submit', sendMessage);
    el('chat-search')?.addEventListener('input', renderConversations);
    el('contact-search')?.addEventListener('input', openContacts);
    el('btn-start-chat')?.addEventListener('click', () => { openContacts(); P().openModal('modal-contacts'); });
    el('btn-start-chat-empty')?.addEventListener('click', () => { openContacts(); P().openModal('modal-contacts'); });
    el('btn-new-chat')?.addEventListener('click', () => { openContacts(); P().openModal('modal-contacts'); });
    el('chat-back')?.addEventListener('click', () => {
      el('chat-layout').classList.remove('is-thread-open');
      activePartnerId = null;
      el('chat-active').hidden = true;
      el('chat-empty').hidden = false;
    });

    // Auto-grow the composer textarea
    const input = el('chat-input');
    input?.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el('chat-composer').requestSubmit();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'messages') return;
    if (!S() || !S().isLoggedIn()) return;
    wireEvents();
    renderConversations();
  });

  return { renderConversations };
})();