/* =====================================================================
   settings.js — Theme, preferences, password, demo reset, account actions
   ===================================================================== */

window.PGMPSettings = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  function el(id) { return document.getElementById(id); }

  // ---------- Theme ----------
  function wireTheme() {
    const current = S().getSettings().theme;
    document.querySelectorAll('input[name="theme"]').forEach(r => {
      r.checked = r.value === current;
      r.addEventListener('change', () => {
        if (r.checked) P().setTheme(r.value);
      });
    });
    // Listen for changes dispatched from the topbar button.
    document.addEventListener('pgmp:theme-changed', () => {
      const t = S().getSettings().theme;
      document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = r.value === t; });
    });
  }

  // ---------- Preferences ----------
  function wirePrefs() {
    const prefs = S().getSettings().prefs || {};
    ['project', 'mentoring', 'session', 'message'].forEach(k => {
      const box = el('pref-' + k);
      if (!box) return;
      box.checked = prefs[k] !== false;
      box.addEventListener('change', () => {
        S().updateSettings({ prefs: { [k]: box.checked } });
        P().toast({ type: 'info', title: 'Preferences saved' });
      });
    });
  }

  // ---------- Change password ----------
  function wireChangePassword() {
    const form = el('form-change-password');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const V = window.PGMPValidators;
      V.clearAllErrors(form);

      const user = S().getCurrentUser();
      const current = el('cp-current').value;
      const next = el('cp-new').value;
      const confirm = el('cp-confirm').value;

      if (S().demoHash(current) !== user.passwordHash) {
        P().toast({ type: 'error', title: 'Current password is incorrect' });
        return;
      }
      const problem = V.passwordProblem(next);
      if (problem) {
        P().toast({ type: 'error', title: 'Password too weak', message: problem });
        return;
      }
      if (next !== confirm) {
        P().toast({ type: 'error', title: 'Passwords do not match' });
        return;
      }

      S().users.update(user.id, { passwordHash: S().demoHash(next) });
      form.reset();
      P().toast({ type: 'success', title: 'Password changed' });
    });
  }

  // ---------- Logout ----------
  function wireLogout() {
    el('btn-logout')?.addEventListener('click', () => window.PGMPAuth.logout());
  }

  // ---------- Reset demo ----------
  function wireResetDemo() {
    el('btn-reset-demo')?.addEventListener('click', async () => {
      const ok = await P().confirm({
        title: 'Reset all demonstration data?',
        message: 'This deletes every pgmp_* key in this browser and re-seeds the demo accounts. You will be logged out.',
        confirmLabel: 'Reset everything',
      });
      if (!ok) return;
      S().reset(false);
      window.location.href = 'login.html';
    });
  }

  // ---------- Delete account ----------
  function wireDeleteAccount() {
    el('btn-delete-account')?.addEventListener('click', async () => {
      const user = S().getCurrentUser();
      if (!user) return;

      // Guard: don't delete the last administrator.
      if (user.role === 'admin') {
        const admins = S().users.filter(u => u.role === 'admin');
        if (admins.length <= 1) {
          P().toast({ type: 'error', title: 'Cannot delete the only administrator' });
          return;
        }
      }

      const ok = await P().confirm({
        title: 'Delete your account?',
        message: 'This removes your user record, projects, requests, sessions, messages, and notifications from this browser. This cannot be undone.',
        confirmLabel: 'Delete my account',
        requireTyped: 'DELETE',
      });
      if (!ok) return;

      const userId = user.id;
      S().users.remove(userId);
      S().projects.removeWhere(p => p.studentId === userId || p.guideId === userId);
      S().requests.removeWhere(r => r.studentId === userId || r.mentorId === userId);
      S().sessions.removeWhere(s => s.studentId === userId || s.mentorId === userId);
      S().messages.removeWhere(m => m.senderId === userId || m.receiverId === userId);
      S().notifications.removeWhere(n => n.userId === userId);
      S().clearCurrentSession();

      P().toast({ type: 'success', title: 'Account deleted' });
      setTimeout(() => { window.location.href = 'login.html'; }, 800);
    });
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'settings') return;
    if (!S() || !S().isLoggedIn()) return;
    wireTheme();
    wirePrefs();
    wireChangePassword();
    wireLogout();
    wireResetDemo();
    wireDeleteAccount();
  });

  return {};
})();