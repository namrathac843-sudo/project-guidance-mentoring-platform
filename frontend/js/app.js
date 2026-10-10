/* =====================================================================
   app.js — Application shell for every authenticated page
   =====================================================================
   Responsibilities
     * verify the session (redirect to login if not authenticated)
     * render the sidebar + topbar into <div id="app-shell">
     * highlight the active menu item based on <body data-page="...">
     * apply the saved theme before paint
     * wire up the theme toggle, sidebar toggle, user menu, notif bell
     * provide global helpers: PGMP.toast, PGMP.confirm, PGMP.openModal,
       PGMP.closeModal, PGMP.escapeHtml, PGMP.refreshBell, PGMP.refreshShell
   ===================================================================== */

window.PGMP = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const A = () => window.PGMPAuth;

  // ---------- Theme (applied as early as possible) ----------
  function applyThemeFromSettings() {
    if (!S()) return;
    const settings = S().getSettings();
    let theme = settings.theme;
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  }

  function currentEffectiveTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function setTheme(theme) {
    S().updateSettings({ theme });
    if (theme === 'system') {
      applyThemeFromSettings();
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    document.dispatchEvent(new CustomEvent('pgmp:theme-changed', { detail: { theme } }));
    // Update the topbar button icon
    updateThemeButtons();
  }

  function toggleTheme() {
    const now = currentEffectiveTheme();
    setTheme(now === 'dark' ? 'light' : 'dark');
  }

  function updateThemeButtons() {
    const dark = currentEffectiveTheme() === 'dark';
    document.querySelectorAll('[data-theme-toggle], #theme-toggle-landing')
      .forEach(btn => {
        const icon = btn.querySelector('.theme-icon');
        if (icon) icon.textContent = dark ? '☀' : '🌙';
        btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      });
  }

  // ---------- Escape helper ----------
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function titleCase(str) {
    return String(str || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  // ---------- Sidebar / topbar navigation ----------
  const NAV_ITEMS = [
    { href: 'dashboard.html',           label: 'Dashboard',          icon: '▤',  page: 'dashboard' },
    { href: 'projects.html',            label: 'My Projects',        icon: '📁', page: 'projects' },
    { href: 'mentors.html',             label: 'Mentors',            icon: '🎓', page: 'mentors' },
    { href: 'mentoring-sessions.html',  label: 'Mentoring Sessions', icon: '📅', page: 'sessions' },
    { href: 'messages.html',            label: 'Messages',           icon: '💬', page: 'messages' },
    { href: 'notifications.html',       label: 'Notifications',      icon: '🔔', page: 'notifications' },
    { href: 'profile.html',             label: 'Profile',            icon: '👤', page: 'profile' },
    { href: 'settings.html',            label: 'Settings',           icon: '⚙',  page: 'settings' },
  ];

  function buildSidebar(user) {
    const activePage = document.body.dataset.page || '';
    const items = NAV_ITEMS.map(item => {
      const active = item.page === activePage ? ' is-active' : '';
      const badge = item.page === 'notifications'
        ? `<span class="nav-badge" data-nav-badge hidden>0</span>`
        : '';
      return `
        <li>
          <a class="${active.trim()}" href="${item.href}">
            <span class="nav-icon" aria-hidden="true">${item.icon}</span>
            <span>${item.label}</span>
            ${badge}
          </a>
        </li>`;
    }).join('');

    const avatar = user && user.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="" />`
      : initials(user && user.fullName);

    return `
      <aside class="sidebar" aria-label="Main navigation">
        <a href="dashboard.html" class="brand">
          <span class="brand-mark" aria-hidden="true">PG</span>
          <span class="brand-text">Project Guidance &amp; Mentoring</span>
        </a>

        <div class="sidebar-user">
          <span class="avatar" aria-hidden="true">${avatar}</span>
          <div class="who">
            <strong>${escapeHtml(user.fullName || '')}</strong>
            <small>${escapeHtml(titleCase(user.role || ''))}</small>
          </div>
        </div>

        <nav class="sidebar-nav" aria-label="Primary">
          <ul>${items}</ul>
        </nav>

        <div class="sidebar-footer">
          <button type="button" class="btn btn-ghost btn-block" data-logout>Log out</button>
          <p class="small" style="margin:.6rem 0 0;opacity:.7;">Demonstration build — data lives in this browser only.</p>
        </div>
      </aside>
    `;
  }

  function buildTopbar(user) {
    const avatar = user && user.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="" />`
      : initials(user && user.fullName);

    return `
      <header class="topbar" role="banner">
        <button type="button" class="icon-btn topbar-toggle"
                data-sidebar-toggle aria-label="Toggle navigation">☰</button>

        <form class="topbar-search" role="search" onsubmit="return false;">
          <label for="shell-search" class="sr-only">Search</label>
          <input type="search" id="shell-search" placeholder="Search projects, mentors, sessions…" />
        </form>

        <div class="topbar-spacer"></div>

        <div class="topbar-actions">
          <button type="button" class="icon-btn" data-theme-toggle
                  aria-label="Toggle theme">
            <span class="theme-icon" aria-hidden="true">🌙</span>
          </button>

          <div class="bell-wrap">
            <button type="button" class="icon-btn" id="shell-bell"
                    aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
              🔔
              <span class="bell-dot" id="shell-bell-dot" hidden>0</span>
            </button>
          </div>

          <div class="user-menu">
            <button type="button" id="shell-user-btn"
                    aria-haspopup="menu" aria-expanded="false">
              <span class="avatar" aria-hidden="true">${avatar}</span>
              <span class="who">
                <strong>${escapeHtml(user.fullName || '')}</strong>
                <small>${escapeHtml(titleCase(user.role || ''))}</small>
              </span>
              <span aria-hidden="true">▾</span>
            </button>
            <div class="user-dropdown" id="shell-user-dropdown" role="menu" hidden>
              <a href="profile.html" role="menuitem">👤 Profile</a>
              <a href="settings.html" role="menuitem">⚙ Settings</a>
              <a href="notifications.html" role="menuitem">🔔 Notifications</a>
              <hr />
              <button type="button" class="danger" data-logout role="menuitem">⏻ Log out</button>
            </div>
          </div>
        </div>
      </header>
      <div class="shell-overlay" data-sidebar-overlay></div>
    `;
  }

  // ---------- Notification dropdown (mini) ----------
  function buildBellDropdown() {
    return `
      <div class="notif-dropdown" id="shell-notif-dropdown" hidden>
        <header>
          <h3>Notifications</h3>
          <button type="button" id="shell-notif-mark-all">Mark all read</button>
        </header>
        <div id="shell-notif-body"></div>
        <footer>
          <a href="notifications.html">View all notifications</a>
        </footer>
      </div>`;
  }

  function renderBellDropdown(user) {
    const body = document.getElementById('shell-notif-body');
    if (!body) return;

    const items = S().notifications.forUser(user.id).slice(0, 6);
    if (!items.length) {
      body.innerHTML = '<p class="muted small" style="padding:1rem;">You have no notifications yet.</p>';
      return;
    }
    body.innerHTML = items.map(n => `
      <div class="notification-item ${n.read ? '' : 'is-unread'}"
           data-notif-id="${escapeHtml(n.id)}"
           ${n.link ? `data-notif-link="${escapeHtml(n.link)}"` : ''}>
        <span class="notification-icon is-${escapeHtml(n.type)}" aria-hidden="true">•</span>
        <div class="notification-body">
          <strong>${escapeHtml(n.title)}</strong>
          <p>${escapeHtml(n.message)}</p>
          <span class="notification-meta">${relativeTime(n.createdAt)}</span>
        </div>
      </div>`).join('');

    body.querySelectorAll('.notification-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.notifId;
        S().notifications.update(id, { read: true });
        const link = el.dataset.notifLink;
        if (link) {
          window.location.href = link;
        } else {
          refreshBell(user.id);
          renderBellDropdown(user);
        }
      });
    });
  }

  function refreshBell(userId) {
    const count = S().notifications.unreadCount(userId);
    const dot = document.getElementById('shell-bell-dot');
    const navBadge = document.querySelector('[data-nav-badge]');
    if (dot) {
      if (count > 0) { dot.textContent = count > 99 ? '99+' : String(count); dot.hidden = false; }
      else { dot.hidden = true; }
    }
    if (navBadge) {
      if (count > 0) { navBadge.textContent = count > 99 ? '99+' : String(count); navBadge.hidden = false; }
      else { navBadge.hidden = true; }
    }
  }

  function relativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} h ago`;
    const days = Math.floor(hr / 24);
    if (days < 7) return `${days} d ago`;
    return new Date(iso).toLocaleDateString();
  }

  // ---------- Toast ----------
  function ensureToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(opts) {
    const o = opts || {};
    const stack = ensureToastStack();
    const el = document.createElement('div');
    const type = o.type || 'info';
    const icons = { success: '✓', error: '!', warning: '⚠', info: 'ℹ' };
    el.className = `toast is-${type}`;
    el.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icons[type] || 'ℹ'}</span>
      <div class="toast-body">
        <strong>${escapeHtml(o.title || 'Notice')}</strong>
        ${o.message ? `<p>${escapeHtml(o.message)}</p>` : ''}
      </div>
      <button type="button" class="toast-close" aria-label="Dismiss">×</button>`;
    stack.appendChild(el);

    const close = () => {
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, o.timeout || 3800);
  }

  // ---------- Modal helpers ----------
  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('is-open'));
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('is-open');
    m.classList.add('is-closing');
    setTimeout(() => {
      m.hidden = true;
      m.classList.remove('is-closing');
    }, 180);
  }

  function wireModalCloseButtons() {
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('.modal-close');
      if (closeBtn) {
        const backdrop = closeBtn.closest('.modal-backdrop');
        if (backdrop) closeModal(backdrop.id);
        return;
      }
      // Click on the backdrop itself
      if (e.target.classList.contains('modal-backdrop')) {
        closeModal(e.target.id);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal-backdrop.is-open').forEach(m => closeModal(m.id));
    });
  }

  /**
   * Show a confirm dialog. Returns a promise resolving to true/false.
   * Options: { title, message, confirmLabel, danger, requireTyped }
   * The modal markup lives in each page (#modal-confirm). When it is not
   * present, we create a minimal one on the fly.
   */
  function confirm(opts) {
    return new Promise((resolve) => {
      const o = opts || {};
      let modal = document.getElementById('modal-confirm');
      let temp = false;

      if (!modal) {
        // Build a temporary one
        temp = document.createElement('div');
        temp.className = 'modal-backdrop';
        temp.id = 'modal-confirm';
        temp.hidden = true;
        temp.innerHTML = `
          <div class="modal modal--sm" role="dialog" aria-modal="true">
            <header class="modal-header">
              <h2 id="modal-confirm-title">Confirm</h2>
              <button type="button" class="icon-btn modal-close" aria-label="Close">×</button>
            </header>
            <div class="modal-body">
              <p id="confirm-message"></p>
              <div class="form-group" id="confirm-typed-group" hidden>
                <label for="confirm-typed">Type <code id="confirm-typed-target"></code> to continue</label>
                <input type="text" id="confirm-typed" autocomplete="off" />
              </div>
            </div>
            <footer class="modal-footer">
              <button type="button" class="btn btn-ghost modal-close">Cancel</button>
              <button type="button" class="btn btn-danger" id="btn-confirm-yes">Confirm</button>
            </footer>
          </div>`;
        document.body.appendChild(temp);
      }

      const titleEl = modal.querySelector('#modal-confirm-title');
      const msgEl = modal.querySelector('#confirm-message');
      const yesBtn = modal.querySelector('#btn-confirm-yes');
      const typedGroup = modal.querySelector('#confirm-typed-group');
      const typedInput = modal.querySelector('#confirm-typed');
      const typedTarget = modal.querySelector('#confirm-typed-target');

      if (titleEl) titleEl.textContent = o.title || 'Are you sure?';
      if (msgEl) msgEl.textContent = o.message || '';
      if (yesBtn) {
        yesBtn.textContent = o.confirmLabel || 'Confirm';
        yesBtn.className = 'btn ' + (o.danger === false ? 'btn-primary' : 'btn-danger');
      }

      if (o.requireTyped) {
        typedGroup.hidden = false;
        typedTarget.textContent = o.requireTyped;
        typedInput.value = '';
        yesBtn.disabled = true;
        typedInput.addEventListener('input', () => {
          yesBtn.disabled = typedInput.value.trim() !== o.requireTyped;
        });
      } else {
        typedGroup.hidden = true;
        yesBtn.disabled = false;
      }

      const cleanup = () => {
        yesBtn.replaceWith(yesBtn.cloneNode(true)); // strip listeners
        if (temp) temp.remove();
      };

      // Cancel
      const cancelBtns = modal.querySelectorAll('.modal-close');
      cancelBtns.forEach(b => {
        const handler = () => { closeModal(modal.id); resolve(false); };
        b.addEventListener('click', handler, { once: true });
      });

      // Confirm
      yesBtn.addEventListener('click', () => {
        closeModal(modal.id);
        resolve(true);
      }, { once: true });

      openModal(modal.id);
    });
  }

  // ---------- Global click handlers ----------
  function wireGlobalActions(user) {
    // Logout (any element with [data-logout])
    document.addEventListener('click', (e) => {
      const logoutBtn = e.target.closest('[data-logout]');
      if (logoutBtn) {
        e.preventDefault();
        A().logout();
      }
    });

    // Sidebar toggle (mobile)
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-sidebar-toggle]')) {
        document.body.classList.toggle('is-sidebar-open');
      }
      if (e.target.closest('[data-sidebar-overlay]')) {
        document.body.classList.remove('is-sidebar-open');
      }
    });

    // Theme toggle buttons
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-theme-toggle]') || e.target.closest('#theme-toggle-landing')) {
        toggleTheme();
      }
    });

    // User menu dropdown
    const userBtn = document.getElementById('shell-user-btn');
    const userDropdown = document.getElementById('shell-user-dropdown');
    if (userBtn && userDropdown) {
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.hidden = !userDropdown.hidden;
        userBtn.setAttribute('aria-expanded', String(!userDropdown.hidden));
      });
      document.addEventListener('click', (e) => {
        if (!userDropdown.hidden
            && !e.target.closest('#shell-user-btn')
            && !e.target.closest('#shell-user-dropdown')) {
          userDropdown.hidden = true;
          userBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Notification bell
    const bell = document.getElementById('shell-bell');
    if (bell) {
      bell.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('shell-notif-dropdown');
        if (!panel) return;
        panel.hidden = !panel.hidden;
        bell.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) renderBellDropdown(user);
      });
      document.addEventListener('click', (e) => {
        const panel = document.getElementById('shell-notif-dropdown');
        if (panel && !panel.hidden
            && !e.target.closest('#shell-bell')
            && !e.target.closest('#shell-notif-dropdown')) {
          panel.hidden = true;
          bell.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // "Mark all read" inside the bell dropdown
    const markAll = document.getElementById('shell-notif-mark-all');
    if (markAll) {
      markAll.addEventListener('click', () => {
        S().notifications.forUser(user.id).forEach(n => {
          if (!n.read) S().notifications.update(n.id, { read: true });
        });
        refreshBell(user.id);
        renderBellDropdown(user);
        toast({ type: 'success', title: 'Marked all as read' });
      });
    }

    // Topbar search: filter across the app and route the user
    const search = document.getElementById('shell-search');
    if (search) {
      search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const q = search.value.trim();
        if (!q) return;
        routeSearch(user, q);
      });
    }
  }

  /**
   * Topbar search: figures out the most likely destination for the query
   * and navigates with a ?q= parameter. Local Storage keeps the intent.
   */
  function routeSearch(user, q) {
    const lower = q.toLowerCase();
    const userId = user.id;

    // Count matches per section.
    const myProjects = user.role === 'student'
      ? S().projects.byStudent(userId)
      : user.role === 'lecturer'
        ? S().projects.filter(p => p.guideId === userId || p.department === user.department)
        : S().projects.all();
    const projectHits = myProjects.filter(p => (p.title || '').toLowerCase().includes(lower)).length;

    const mentorHits = S().users.filter(u => u.role === 'lecturer' || u.role === 'alumni')
      .filter(u => (u.fullName || '').toLowerCase().includes(lower)).length;

    // Pick the section with the most hits; fall back to projects.
    let dest = 'projects.html';
    if (mentorHits > projectHits && mentorHits > 0) dest = 'mentors.html';
    if (projectHits === 0 && mentorHits === 0) dest = 'projects.html';

    window.location.href = `${dest}?q=${encodeURIComponent(q)}`;
  }

  // ---------- Shell init ----------
  function initShell() {
    const requiresAuth = document.body.dataset.requiresAuth === 'true';
    const shell = document.getElementById('app-shell');
    if (!requiresAuth || !shell) return;

    const user = A().requireAuth();
    if (!user) return;

    shell.innerHTML = buildSidebar(user) + buildTopbar(user) + buildBellDropdown();

    updateThemeButtons();
    refreshBell(user.id);
    wireGlobalActions(user);

    // Live theme change from the OS when in "system" mode
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => {
      if (S().getSettings().theme === 'system') applyThemeFromSettings();
    });
  }

  // ---------- Public API ----------
  return {
    initShell,
    applyThemeFromSettings,
    setTheme,
    toggleTheme,
    currentEffectiveTheme,
    updateThemeButtons,

    toast,
    confirm,
    openModal,
    closeModal,

    refreshBell,
    refreshShell() { initShell(); },

    escapeHtml,
    initials,
    titleCase,
    relativeTime,
    routeSearch,
  };
})();

/* =====================================================================
   Bootstrap — run as soon as the DOM is ready
   ===================================================================== */
(function bootstrap() {
  'use strict';

  // Apply theme before paint (as early as possible)
  if (window.PGMPStorage) {
    // Seed the demo accounts if this is the first run.
    try { window.PGMPStorage.seedIfEmpty(); } catch (e) { console.warn(e); }
  }
  if (window.PGMP) window.PGMP.applyThemeFromSettings();

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.PGMP) return;

    // Wire up page-specific auth forms
    if (window.PGMPAuth) {
      if (document.body.dataset.page === 'register') window.PGMPAuth.initRegisterPage();
      if (document.body.dataset.page === 'login')    window.PGMPAuth.initLoginPage();
    }

    // Build the shell for authenticated pages
    window.PGMP.initShell();

    // Also keep the landing-page theme button in sync
    window.PGMP.updateThemeButtons();
  });
})();