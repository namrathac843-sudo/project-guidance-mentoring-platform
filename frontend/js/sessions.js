/* =====================================================================
   sessions.js — Mentoring session scheduling, rescheduling, cancel
   ===================================================================== */

window.PGMPSessions = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  let currentScope = 'upcoming';
  let editingId = null;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
    });
  }

  // ---------- Scope ----------
  function scoped(user) {
    const all = S().sessions.all();
    if (user.role === 'admin') return all;
    return all.filter(s => s.mentorId === user.id || s.studentId === user.id);
  }

  function byScope(list, scope) {
    const today = new Date().toISOString().slice(0, 10);
    if (scope === 'upcoming') return list.filter(s =>
      s.status === 'Scheduled' && s.date >= today
    ).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    if (scope === 'past') return list.filter(s =>
      (s.date < today) || s.status === 'Completed'
    ).sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
    return list.filter(s => s.status === 'Cancelled')
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  // ---------- Cards ----------
  function sessionCard(s, user) {
    const canManage = user.role === 'admin' || s.mentorId === user.id;
    const cancelled = s.status === 'Cancelled';
    const past = s.date < new Date().toISOString().slice(0, 10) && !cancelled;
    const cls = cancelled ? 'is-cancelled' : (past ? 'is-past' : '');
    const counterpart = s.mentorId === user.id
      ? `Student: <strong>${esc(s.studentName)}</strong>`
      : `Mentor: <strong>${esc(s.mentorName)}</strong>`;

    const statusPill = cancelled
      ? `<span class="pill pill-danger">Cancelled</span>`
      : past
        ? `<span class="pill pill-neutral">Completed</span>`
        : `<span class="pill pill-ok">Scheduled</span>`;

    return `
      <article class="session-card ${cls}" data-session-id="${esc(s.id)}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
          <h3 style="margin:0;font-size:1rem;">${esc(s.title)}</h3>
          ${statusPill}
        </div>
        ${s.description ? `<p class="muted small" style="margin:0;">${esc(s.description)}</p>` : ''}
        <div class="session-when">
          <span><strong>${esc(fmtDate(s.date))}</strong></span>
          <span>${esc(s.startTime)} – ${esc(s.endTime)}</span>
          <span>${esc(s.platform)}</span>
        </div>
        <p class="session-who">${counterpart}</p>
        ${s.instructions ? `<p class="muted small" style="margin:0;">${esc(s.instructions)}</p>` : ''}
        ${cancelled && s.cancelReason ? `<p class="muted small">Reason: ${esc(s.cancelReason)}</p>` : ''}
        <div class="session-actions">
          ${!cancelled ? `<a class="btn btn-primary btn-sm" href="${esc(s.meetingUrl)}" target="_blank" rel="noopener">Join session</a>` : ''}
          ${canManage && !cancelled ? `
            <button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(s.id)}">Reschedule</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="cancel" data-id="${esc(s.id)}">Cancel</button>
          ` : ''}
        </div>
      </article>`;
  }

  // ---------- Render ----------
  function render() {
    const user = S().getCurrentUser();
    const all = scoped(user);
    const upcoming = byScope(all, 'upcoming');
    const past = byScope(all, 'past');
    const cancelled = byScope(all, 'cancelled');

    el('tab-count-upcoming').textContent = upcoming.length;
    el('tab-count-past').textContent = past.length;
    el('tab-count-cancelled').textContent = cancelled.length;

    const list = currentScope === 'upcoming' ? upcoming
      : currentScope === 'past' ? past : cancelled;

    const grid = el('session-grid');
    const empty = el('session-empty');
    if (!list.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      el('session-empty-title').textContent = `No ${currentScope} sessions`;
      el('session-empty-msg').textContent = currentScope === 'upcoming'
        ? 'Schedule a session to see it here.'
        : 'Nothing to show yet.';
      return;
    }
    empty.hidden = true;
    grid.innerHTML = list.map(s => sessionCard(s, user)).join('');
  }

  // ---------- Form ----------
  function populateSelectors() {
    const user = S().getCurrentUser();
    const mentors = S().users.filter(u => u.role === 'lecturer' || u.role === 'alumni');
    const students = S().users.filter(u => u.role === 'student');

    const mentorSel = el('session-mentor');
    mentorSel.innerHTML = mentors.map(m =>
      `<option value="${esc(m.id)}">${esc(m.fullName)} (${esc(m.role)})</option>`
    ).join('');

    const studentSel = el('session-student');
    studentSel.innerHTML = students.map(s =>
      `<option value="${esc(s.id)}">${esc(s.fullName)} · ${esc(s.usn || s.email)}</option>`
    ).join('');

    // Defaults
    if (user.role !== 'admin') mentorSel.value = user.id;
    mentorSel.disabled = user.role !== 'admin';

    // Project dropdown filled per-student at modal open
    el('session-project').innerHTML = '<option value="">None</option>';
  }

  function openNew() {
    editingId = null;
    el('modal-session-title').textContent = 'Schedule session';
    el('form-session').reset();
    el('session-id').value = '';
    populateSelectors();
    // Default to tomorrow
    const d = new Date(); d.setDate(d.getDate() + 1);
    el('session-date').value = d.toISOString().slice(0, 10);
    el('session-start').value = '10:00';
    el('session-end').value = '11:00';
    P().openModal('modal-session');
  }

  function openEdit(id) {
    const s = S().sessions.byId(id);
    if (!s) return;
    editingId = id;
    el('modal-session-title').textContent = 'Reschedule session';
    el('session-id').value = id;
    populateSelectors();
    el('session-title').value = s.title || '';
    el('session-description').value = s.description || '';
    el('session-mentor').value = s.mentorId;
    el('session-student').value = s.studentId;
    el('session-platform').value = s.platform;
    el('session-date').value = s.date;
    el('session-start').value = s.startTime;
    el('session-end').value = s.endTime;
    el('session-url').value = s.meetingUrl;
    el('session-instructions').value = s.instructions || '';
    refreshProjectOptions(s.studentId, s.projectId);
    P().openModal('modal-session');
  }

  function refreshProjectOptions(studentId, selectedId) {
    const list = S().projects.byStudent(studentId);
    el('session-project').innerHTML = '<option value="">None</option>' +
      list.map(p => `<option value="${esc(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.title)}</option>`).join('');
  }

  // ---------- Validation ----------
  function validateUrl(platform, url) {
    if (!url) return 'A meeting URL is required.';
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return 'The URL must start with https://.';
      const host = u.hostname.toLowerCase();
      if (platform === 'Google Meet' && !host.endsWith('meet.google.com')) {
        return 'A Google Meet link must point to meet.google.com.';
      }
      if (platform === 'Zoom' && !(host.endsWith('zoom.us') || host.endsWith('zoom.com'))) {
        return 'A Zoom link must point to zoom.us.';
      }
    } catch (_) { return 'The URL is not valid.'; }
    return null;
  }

  function saveSession(ev) {
    ev.preventDefault();
    const user = S().getCurrentUser();
    const form = el('form-session');
    window.PGMPValidators.clearAllErrors(form);

    const title = el('session-title').value.trim();
    const studentId = el('session-student').value;
    const mentorId = el('session-mentor').value;
    const date = el('session-date').value;
    const start = el('session-start').value;
    const end = el('session-end').value;
    const platform = el('session-platform').value;
    const url = el('session-url').value.trim();

    if (!title) { P().toast({ type: 'error', title: 'Title is required' }); return; }
    if (!studentId) { P().toast({ type: 'error', title: 'Student is required' }); return; }
    if (!mentorId) { P().toast({ type: 'error', title: 'Mentor is required' }); return; }
    if (!date) { window.PGMPValidators.setFieldError('session-date', 'Date is required.'); return; }
    if (!start || !end) { window.PGMPValidators.setFieldError('session-end', 'Both times are required.'); return; }
    if (end <= start) { window.PGMPValidators.setFieldError('session-end', 'End time must be after start time.'); return; }

    const urlError = validateUrl(platform, url);
    if (urlError) { window.PGMPValidators.setFieldError('session-url', urlError); return; }

    const student = S().users.byId(studentId);
    const mentor = S().users.byId(mentorId);
    const record = {
      title,
      description: el('session-description').value.trim(),
      mentorId,
      mentorName: mentor ? mentor.fullName : '',
      studentId,
      studentName: student ? student.fullName : '',
      projectId: el('session-project').value || '',
      date, startTime: start, endTime: end,
      platform, meetingUrl: url,
      instructions: el('session-instructions').value.trim(),
      status: 'Scheduled',
      updatedAt: S().nowIso(),
    };

    if (editingId) {
      S().sessions.update(editingId, record);
      S().notify(studentId, 'session', 'Session rescheduled',
        `"${title}" is now on ${date} from ${start} to ${end}.`,
        'mentoring-sessions.html', { sessionId: editingId });
      P().toast({ type: 'success', title: 'Session updated' });
    } else {
      record.id = S().newId('sess');
      record.createdAt = S().nowIso();
      S().sessions.insert(record);
      S().notify(studentId, 'session', 'New mentoring session',
        `${mentor.fullName} scheduled "${title}" on ${date} at ${start}.`,
        'mentoring-sessions.html', { sessionId: record.id });
      P().toast({ type: 'success', title: 'Session scheduled' });
    }

    P().closeModal('modal-session');
    render();
  }

  // ---------- Cancel ----------
  function openCancel(id) {
    el('cancel-session-id').value = id;
    el('cancel-session-reason').value = '';
    P().openModal('modal-cancel-session');
  }

  function submitCancel() {
    const id = el('cancel-session-id').value;
    const reason = el('cancel-session-reason').value.trim();
    const s = S().sessions.byId(id);
    if (!s) return;
    S().sessions.update(id, { status: 'Cancelled', cancelReason: reason });
    S().notify(s.studentId, 'session', 'Session cancelled',
      `"${s.title}" on ${s.date} was cancelled.` + (reason ? ` Reason: ${reason}` : ''),
      'mentoring-sessions.html', { sessionId: id });
    P().toast({ type: 'info', title: 'Session cancelled' });
    P().closeModal('modal-cancel-session');
    render();
  }

  // ---------- Wire ----------
  function wireEvents() {
    el('btn-new-session')?.addEventListener('click', openNew);
    el('form-session')?.addEventListener('submit', saveSession);
    el('btn-confirm-cancel-session')?.addEventListener('click', submitCancel);

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => {
          t.classList.toggle('is-active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        currentScope = tab.dataset.scope;
        render();
      });
    });

    el('session-student')?.addEventListener('change', (e) => {
      refreshProjectOptions(e.target.value, '');
    });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action][data-id]');
      if (!t) return;
      if (t.dataset.action === 'edit') openEdit(t.dataset.id);
      else if (t.dataset.action === 'cancel') openCancel(t.dataset.id);
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') setTimeout(openNew, 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'sessions') return;
    if (!S() || !S().isLoggedIn()) return;
    const user = S().getCurrentUser();
    if (user.role === 'student') {
      el('btn-new-session').hidden = true;
    }
    wireEvents();
    render();
  });

  return { render };
})();