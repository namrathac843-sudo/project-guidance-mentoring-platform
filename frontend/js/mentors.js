/* =====================================================================
   mentors.js — Mentor directory, request workflow, incoming responses
   ===================================================================== */

window.PGMPMentors = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }
  function initials(name) { return P().initials(name); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function statusPill(status) {
    const map = {
      'Pending': 'pill-warn',
      'Accepted': 'pill-ok',
      'Declined': 'pill-danger',
      'Cancelled': 'pill-neutral',
    };
    return `<span class="pill ${map[status] || 'pill-neutral'}">${esc(status)}</span>`;
  }

  // ---------- Directory ----------
  function scopeMentors() {
    return S().users.filter(u =>
      (u.role === 'lecturer' || u.role === 'alumni') && u.status === 'Active'
    );
  }

  function applyFilters(list) {
    const q = (el('mentor-search').value || '').trim().toLowerCase();
    const role = el('mentor-role').value;
    const dept = el('mentor-dept').value;
    const exp = (el('mentor-expertise').value || '').trim().toLowerCase();

    let rows = list.slice();
    if (role) rows = rows.filter(m => m.role === role);
    if (dept) rows = rows.filter(m => m.department === dept);
    if (q) rows = rows.filter(m =>
      (m.fullName || '').toLowerCase().includes(q) ||
      (m.company || '').toLowerCase().includes(q) ||
      (m.designation || '').toLowerCase().includes(q) ||
      (m.jobDesignation || '').toLowerCase().includes(q)
    );
    if (exp) rows = rows.filter(m =>
      (m.expertise || []).some(e => String(e).toLowerCase().includes(exp)) ||
      (m.skills || []).some(e => String(e).toLowerCase().includes(exp))
    );
    rows.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
    return rows;
  }

  function mentorCard(m, user) {
    const avatar = m.avatar ? `<img src="${esc(m.avatar)}" alt="" />` : initials(m.fullName);
    const subtitle = m.role === 'lecturer'
      ? `${esc(m.designation || 'Lecturer')} · ${esc(m.department || '')}`
      : `${esc(m.jobDesignation || 'Professional')} at ${esc(m.company || '')}`;
    const tags = (m.expertise || []).slice(0, 4)
      .map(t => `<span class="tag">${esc(t)}</span>`).join('');

    // Existing request status for this student.
    const existing = S().requests.find(r =>
      r.studentId === user.id && r.mentorId === m.id && (r.status === 'Pending' || r.status === 'Accepted')
    );

    let actionBtn = '';
    if (user.role === 'student') {
      if (existing) {
        actionBtn = `<button type="button" class="btn btn-ghost btn-sm" disabled>
                       Request ${esc(existing.status.toLowerCase())}
                     </button>`;
      } else {
        actionBtn = `<button type="button" class="btn btn-primary btn-sm"
                       data-mentor-id="${esc(m.id)}" data-action="request">Request mentoring</button>`;
      }
    }

    return `
      <article class="mentor-card" data-mentor-id="${esc(m.id)}">
        <div class="mentor-head">
          <span class="mentor-avatar" aria-hidden="true">${avatar}</span>
          <div style="min-width:0;">
            <h3 class="mentor-name">${esc(m.fullName)}</h3>
            <p class="mentor-subtitle">${subtitle}</p>
            <p class="mentor-subtitle" style="color:var(--color-accent);font-weight:600;text-transform:capitalize;">
              ${esc(m.role)}
            </p>
          </div>
        </div>
        ${m.bio ? `<p class="mentor-bio">${esc(m.bio)}</p>` : ''}
        ${tags ? `<div class="mentor-tags">${tags}</div>` : ''}
        <div class="mentor-actions">
          <button type="button" class="btn btn-outline btn-sm" data-mentor-id="${esc(m.id)}" data-action="view">View profile</button>
          ${actionBtn}
        </div>
      </article>`;
  }

  function renderDirectory() {
    const user = S().getCurrentUser();
    const rows = applyFilters(scopeMentors());
    const grid = el('mentor-grid');
    const empty = el('mentor-empty');

    el('mentor-count').textContent = `${rows.length} mentor${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = rows.map(m => mentorCard(m, user)).join('');
  }

  // ---------- Profile modal ----------
  function openProfile(id) {
    const m = S().users.byId(id);
    if (!m) return;
    el('mentor-profile-title').textContent = m.fullName;
    const avatar = m.avatar ? `<img src="${esc(m.avatar)}" alt="" />` : initials(m.fullName);

    const tags = (m.expertise || []).map(t => `<span class="tag tag-accent">${esc(t)}</span>`).join(' ');
    const skills = (m.skills || []).map(t => `<span class="tag">${esc(t)}</span>`).join(' ');

    el('mentor-profile-body').innerHTML = `
      <div class="mentor-head" style="margin-bottom:1rem;">
        <span class="mentor-avatar" style="width:64px;height:64px;font-size:1.4rem;">${avatar}</span>
        <div>
          <h3 style="margin:0;">${esc(m.fullName)}</h3>
          <p class="muted" style="margin:.15rem 0;">${esc(m.role)} · ${esc(m.department || '')}</p>
        </div>
      </div>
      <dl class="detail-list">
        <dt>Email</dt><dd>${esc(m.email)}</dd>
        ${m.role === 'lecturer' ? `
          <dt>Designation</dt><dd>${esc(m.designation || '—')}</dd>
          <dt>Experience</dt><dd>${esc(m.experienceYears || '—')} years</dd>
        ` : `
          <dt>Company</dt><dd>${esc(m.company || '—')}</dd>
          <dt>Role</dt><dd>${esc(m.jobDesignation || '—')}</dd>
          <dt>Graduated</dt><dd>${esc(m.graduationYear || '—')} · ${esc(m.graduationDepartment || '')}</dd>
        `}
        ${m.bio ? `<dt>About</dt><dd><div class="pre">${esc(m.bio)}</div></dd>` : ''}
      </dl>
      ${tags ? `<p class="muted small" style="margin:.5rem 0 .25rem;">Expertise</p><div class="tag-row">${tags}</div>` : ''}
      ${skills ? `<p class="muted small" style="margin:.75rem 0 .25rem;">Skills</p><div class="tag-row">${skills}</div>` : ''}
    `;

    const footer = el('modal-mentor-profile').querySelector('.modal-footer');
    const existing = S().requests.find(r =>
      r.studentId === (S().getCurrentUser() || {}).id
      && r.mentorId === m.id
      && (r.status === 'Pending' || r.status === 'Accepted'));
    const user = S().getCurrentUser();

    // Rebuild footer: [Close] [+ Request mentoring] when allowed.
    const buttons = footer.querySelectorAll('button');
    buttons.forEach(b => b.remove());
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'btn btn-ghost modal-close';
    close.textContent = 'Close';
    footer.appendChild(close);

    if (user && user.role === 'student' && !existing) {
      const req = document.createElement('button');
      req.type = 'button'; req.className = 'btn btn-primary';
      req.textContent = 'Request mentoring';
      req.addEventListener('click', () => {
        P().closeModal('modal-mentor-profile');
        openRequestModal(m.id);
      });
      footer.appendChild(req);
    }

    P().openModal('modal-mentor-profile');
  }

  // ---------- Request modal ----------
  function openRequestModal(mentorId) {
    const m = S().users.byId(mentorId);
    if (!m) return;
    el('req-mentor-id').value = mentorId;
    el('req-mentor-context').textContent = `Send a mentoring request to ${m.fullName}.`;

    // Populate the student's own projects.
    const user = S().getCurrentUser();
    const myProjects = S().projects.byProject = null; // no-op, avoid lint
    const list = S().projects.byStudent(user.id);
    el('req-project').innerHTML = '<option value="">None</option>' +
      list.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');

    el('req-topic').value = '';
    el('req-message').value = '';
    P().openModal('modal-mentor-request');
  }

  function sendRequest() {
    const user = S().getCurrentUser();
    const mentorId = el('req-mentor-id').value;
    const mentor = S().users.byId(mentorId);
    if (!mentor) return;

    const topic = el('req-topic').value.trim();
    if (!topic) { P().toast({ type: 'error', title: 'Topic is required' }); return; }

    const record = {
      id: S().newId('mreq'),
      studentId: user.id,
      studentName: user.fullName,
      mentorId,
      mentorName: mentor.fullName,
      topic,
      message: el('req-message').value.trim(),
      projectId: el('req-project').value || '',
      status: 'Pending',
      responseNote: '',
      createdAt: S().nowIso(),
      updatedAt: S().nowIso(),
    };
    S().requests.insert(record);

    S().notify(mentorId, 'mentoring', 'New mentoring request',
      `${user.fullName} requested mentoring about "${topic}".`,
      'mentors.html', { requestId: record.id });

    P().toast({ type: 'success', title: 'Request sent' });
    P().closeModal('modal-mentor-request');
    renderAll();
  }

  // ---------- Response modal (for mentors) ----------
  function openRespond(requestId, action) {
    const r = S().requests.byId(requestId);
    if (!r) return;
    el('respond-request-id').value = requestId;
    el('respond-action').value = action;
    el('modal-respond-title').textContent = action === 'accept' ? 'Accept request' : 'Decline request';
    el('respond-context').textContent = `Request from ${r.studentName} about "${r.topic}".`;
    el('respond-note').value = '';
    P().openModal('modal-respond');
  }

  function submitResponse() {
    const requestId = el('respond-request-id').value;
    const action = el('respond-action').value;
    const note = el('respond-note').value.trim();
    const r = S().requests.byId(requestId);
    if (!r) return;

    const newStatus = action === 'accept' ? 'Accepted' : 'Declined';
    S().requests.update(requestId, { status: newStatus, responseNote: note });

    S().notify(r.studentId, 'mentoring',
      `Mentoring request ${newStatus.toLowerCase()}`,
      `Your request about "${r.topic}" was ${newStatus.toLowerCase()}.` + (note ? ` Note: ${note}` : ''),
      'mentors.html', { requestId });

    P().toast({ type: 'success', title: `Request ${newStatus.toLowerCase()}` });
    P().closeModal('modal-respond');
    renderAll();
  }

  // ---------- My requests / incoming requests ----------
  function renderMyRequests(user) {
    const card = el('my-requests-card');
    if (user.role !== 'student') { card.hidden = true; return; }

    const list = S().requests.filter(r => r.studentId === user.id);
    card.hidden = list.length === 0;
    if (!list.length) return;

    el('my-requests-body').innerHTML = list
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(r => `
        <tr>
          <td>${esc(r.mentorName)}</td>
          <td>${esc(r.topic)}</td>
          <td>${esc(fmtDate(r.createdAt))}</td>
          <td>${statusPill(r.status)}</td>
          <td>${esc(r.responseNote || '—')}</td>
          <td class="cell-actions">
            ${r.status === 'Pending'
              ? `<button type="button" class="btn btn-ghost btn-sm" data-action="cancel-request" data-id="${esc(r.id)}">Cancel</button>`
              : ''}
          </td>
        </tr>`).join('');
  }

  function renderIncoming(user) {
    const card = el('incoming-requests-card');
    if (user.role !== 'lecturer' && user.role !== 'alumni') { card.hidden = true; return; }

    const list = S().requests.filter(r => r.mentorId === user.id);
    card.hidden = list.length === 0;
    if (!list.length) return;

    el('incoming-requests-body').innerHTML = list
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(r => `
        <tr>
          <td>${esc(r.studentName)}</td>
          <td>${esc(r.topic)}</td>
          <td>${esc(r.message || '—')}</td>
          <td>${esc(fmtDate(r.createdAt))}</td>
          <td>${statusPill(r.status)}</td>
          <td class="cell-actions">
            ${r.status === 'Pending' ? `
              <button type="button" class="btn btn-primary btn-sm" data-action="accept-request" data-id="${esc(r.id)}">Accept</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="decline-request" data-id="${esc(r.id)}">Decline</button>
            ` : `<span class="muted small">—</span>`}
          </td>
        </tr>`).join('');
  }

  // ---------- Event wiring ----------
  function wireEvents() {
    ['mentor-search', 'mentor-role', 'mentor-dept', 'mentor-expertise'].forEach(id => {
      el(id)?.addEventListener('input', renderDirectory);
      el(id)?.addEventListener('change', renderDirectory);
    });
    el('mentor-clear')?.addEventListener('click', () => {
      el('mentor-search').value = '';
      el('mentor-role').value = '';
      el('mentor-dept').value = '';
      el('mentor-expertise').value = '';
      renderDirectory();
    });

    el('btn-send-mentor-request')?.addEventListener('click', sendRequest);
    el('btn-confirm-respond')?.addEventListener('click', submitResponse);

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action][data-mentor-id], [data-action][data-id]');
      if (!t) return;
      const action = t.dataset.action;
      if (action === 'view' && t.dataset.mentorId) openProfile(t.dataset.mentorId);
      else if (action === 'request' && t.dataset.mentorId) openRequestModal(t.dataset.mentorId);
      else if (action === 'accept-request') openRespond(t.dataset.id, 'accept');
      else if (action === 'decline-request') openRespond(t.dataset.id, 'decline');
      else if (action === 'cancel-request') cancelRequest(t.dataset.id);
    });
  }

  function cancelRequest(id) {
    const r = S().requests.byId(id);
    if (!r) return;
    S().requests.update(id, { status: 'Cancelled' });
    S().notify(r.mentorId, 'mentoring',
      'Mentoring request cancelled',
      `${r.studentName} cancelled the request about "${r.topic}".`,
      'mentors.html', { requestId: id });
    P().toast({ type: 'info', title: 'Request cancelled' });
    renderAll();
  }

  function renderAll() {
    renderDirectory();
    const user = S().getCurrentUser();
    renderMyRequests(user);
    renderIncoming(user);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'mentors') return;
    if (!S() || !S().isLoggedIn()) return;
    wireEvents();
    renderAll();
  });

  return { renderAll };
})();