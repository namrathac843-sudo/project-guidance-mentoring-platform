/* =====================================================================
   projects.js — Project management (create, upload, review, download)
   =====================================================================
   Handles: cards/table view, filters, sorting, new/edit modal, details
   modal, review workflow, file upload to Local Storage (Base64), and
   download of the stored file via a Blob URL.
   ===================================================================== */

window.PGMPProjects = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;
  const V = () => window.PGMPValidators;

  const PAGE_SIZE = 0; // no pagination for the demo

  let currentView = 'grid';
  let editingId = null;
  let pendingFile = null;

  // ---------- Helpers ----------
  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function statusClass(status) {
    return ({
      'Accepted': 'pill-ok',
      'Rejected': 'pill-danger',
      'Submitted': 'pill-info',
      'Under Review': 'pill-info',
      'Changes Requested': 'pill-warn',
      'Draft': 'pill-neutral',
    })[status] || 'pill-neutral';
  }

  // ---------- Access scope ----------
  function scopeFor(user) {
    const all = S().projects.all();
    if (user.role === 'admin') return all;
    if (user.role === 'student') return all.filter(p => p.studentId === user.id);
    if (user.role === 'lecturer') return all.filter(
      p => p.guideId === user.id || p.department === user.department
    );
    // alumni
    const menteeIds = new Set(
      S().requests.filter(r => r.mentorId === user.id && r.status === 'Accepted')
        .map(r => r.studentId)
    );
    return all.filter(p => menteeIds.has(p.studentId));
  }

  function canEdit(user, project) {
    return user.role === 'admin'
      || project.studentId === user.id
      || project.guideId === user.id;
  }

  function canReview(user, project) {
    if (user.role === 'admin') return true;
    if (user.role !== 'lecturer') return false;
    return project.guideId === user.id
      || project.department === user.department
      || project.status === 'Submitted';
  }

  // ---------- Filtering & sorting ----------
  function applyFilters(list) {
    const q = (el('proj-search').value || '').trim().toLowerCase();
    const status = el('proj-status').value;
    const dept = el('proj-dept').value;
    const sort = el('proj-sort').value;

    let rows = list.slice();
    if (q) rows = rows.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q)
    );
    if (status) rows = rows.filter(p => p.status === status);
    if (dept)   rows = rows.filter(p => p.department === dept);

    if (sort === 'oldest')        rows.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    else if (sort === 'title')    rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else if (sort === 'progress') rows.sort((a, b) => (b.progress || 0) - (a.progress || 0));
    else                          rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return rows;
  }

  // ---------- Rendering ----------
  function projectCard(p, user) {
    const guide = p.guideId ? S().users.byId(p.guideId) : null;
    const student = S().users.byId(p.studentId);
    const teamNames = (p.teamMembers || []).join(', ');
    const showActions = {
      view: true,
      edit: canEdit(user, p) && p.status !== 'Accepted' && p.status !== 'Rejected',
      review: canReview(user, p) && p.status !== 'Draft',
      download: !!p.fileDataUrl,
    };

    const feedback = p.feedback
      ? `<div class="proj-feedback">Feedback: ${esc(p.feedback)}</div>` : '';

    return `
      <article class="project-card" data-project-id="${esc(p.id)}">
        <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start;">
          <h3>${esc(p.title)}</h3>
          <span class="pill ${statusClass(p.status)}">${esc(p.status)}</span>
        </div>
        <div class="proj-meta">
          ${user.role === 'student' ? '' : `<span><strong>Student:</strong> ${esc(student ? student.fullName : '—')}</span>`}
          <span><strong>Guide:</strong> ${esc(guide ? guide.fullName : 'Not assigned')}</span>
          <span><strong>Submitted:</strong> ${esc(fmtDate(p.createdAt))}</span>
          ${p.deadline ? `<span><strong>Deadline:</strong> ${esc(fmtDate(p.deadline))}</span>` : ''}
        </div>
        <p class="proj-desc">${esc(p.description)}</p>
        ${teamNames ? `<p class="muted small">Team: ${esc(teamNames)}</p>` : ''}
        ${feedback}
        <div class="proj-progress">
          <div class="bar"><span style="width:${Math.max(0, Math.min(100, p.progress || 0))}%"></span></div>
          <span>${p.progress || 0}%</span>
        </div>
        <div class="proj-actions">
          ${showActions.view ? `<button type="button" class="btn btn-outline btn-sm" data-action="view" data-id="${esc(p.id)}">Details</button>` : ''}
          ${showActions.edit ? `<button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(p.id)}">Edit</button>` : ''}
          ${showActions.review ? `<button type="button" class="btn btn-primary btn-sm" data-action="review" data-id="${esc(p.id)}">Review</button>` : ''}
          ${showActions.download ? `<button type="button" class="btn btn-ghost btn-sm" data-action="download" data-id="${esc(p.id)}">Download</button>` : ''}
        </div>
      </article>`;
  }

  function renderGrid(rows, user) {
    const grid = el('proj-grid');
    const table = el('proj-table-wrap');
    const empty = el('proj-empty');
    grid.hidden = rows.length === 0 || currentView !== 'grid';
    table.hidden = rows.length === 0 || currentView !== 'table';

    if (!rows.length) {
      empty.hidden = false;
      el('proj-empty-msg').textContent = user.role === 'student'
        ? 'Create your first project to get started.'
        : 'No projects match your filters.';
      el('proj-count').textContent = '0 projects';
      return;
    }
    empty.hidden = true;
    el('proj-count').textContent = `${rows.length} project${rows.length === 1 ? '' : 's'}`;

    if (currentView === 'grid') {
      grid.innerHTML = rows.map(p => projectCard(p, user)).join('');
    } else {
      const body = el('proj-table-body');
      body.innerHTML = rows.map(p => {
        const guide = p.guideId ? S().users.byId(p.guideId) : null;
        const student = S().users.byId(p.studentId);
        const team = (p.teamMembers || []).length
          ? `${student ? student.fullName : '—'} +${p.teamMembers.length}`
          : (student ? student.fullName : '—');
        return `
          <tr data-project-id="${esc(p.id)}">
            <td class="cell-title">${esc(p.title)}</td>
            <td>${esc(team)}</td>
            <td>${esc(guide ? guide.fullName : '—')}</td>
            <td>${esc(fmtDate(p.createdAt))}</td>
            <td>${p.deadline ? esc(fmtDate(p.deadline)) : '—'}</td>
            <td><span class="pill ${statusClass(p.status)}">${esc(p.status)}</span></td>
            <td>${p.progress || 0}%</td>
            <td class="cell-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-action="view" data-id="${esc(p.id)}">Details</button>
              ${canReview(user, p) && p.status !== 'Draft'
                ? `<button type="button" class="btn btn-primary btn-sm" data-action="review" data-id="${esc(p.id)}">Review</button>` : ''}
              ${p.fileDataUrl
                ? `<button type="button" class="btn btn-ghost btn-sm" data-action="download" data-id="${esc(p.id)}">Download</button>` : ''}
            </td>
          </tr>`;
      }).join('');
    }
  }

  function refresh() {
    const user = S().getCurrentUser();
    if (!user) return;
    const rows = applyFilters(scopeFor(user));
    renderGrid(rows, user);
  }

  // ---------- Guide dropdown ----------
  function populateGuides() {
    const select = el('project-guide');
    if (!select) return;
    const user = S().getCurrentUser();
    const lecturers = S().users.filter(u => u.role === 'lecturer' && u.status === 'Active');

    // Prefer lecturers in the same department, then the rest.
    lecturers.sort((a, b) => {
      const aMatch = a.department === user.department ? 0 : 1;
      const bMatch = b.department === user.department ? 0 : 1;
      return aMatch - bMatch || (a.fullName || '').localeCompare(b.fullName || '');
    });

    select.innerHTML = '<option value="">Assign later</option>' +
      lecturers.map(l => `<option value="${esc(l.id)}">${esc(l.fullName)} — ${esc(l.department || '')}</option>`).join('');
  }

  // ---------- File input ----------
  function wireFileInput() {
    const input = el('project-file');
    const info = el('project-file-info');
    if (!input) return;

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      info.hidden = true;
      pendingFile = null;
      V().clearFieldError('project-file');

      if (!file) return;
      const check = V().validateFile(file, S().FILE_SIZE_LIMIT);
      if (!check.ok) {
        V().setFieldError('project-file', check.error);
        input.value = '';
        return;
      }

      pendingFile = file;
      info.hidden = false;
      info.innerHTML = `<span><strong>${esc(file.name)}</strong> · ${esc(V().humanFileSize(file.size))}</span>
                        <span class="muted small">Stored in this browser only</span>`;
    });
  }

  // ---------- New / edit modal ----------
  function openNewModal() {
    editingId = null;
    pendingFile = null;
    el('modal-project-title').textContent = 'New project';
    el('form-project').reset();
    el('project-id').value = '';
    el('project-file-info').hidden = true;
    V().clearAllErrors(el('form-project'));

    // Prefill from current user
    const user = S().getCurrentUser();
    if (user) {
      el('project-department').value = user.department || '';
      el('project-semester').value = user.semester || '';
    }
    populateGuides();
    P().openModal('modal-project');
  }

  function openEditModal(id) {
    const user = S().getCurrentUser();
    const p = S().projects.byId(id);
    if (!p || !canEdit(user, p)) return;

    editingId = id;
    pendingFile = null;
    el('modal-project-title').textContent = 'Edit project';
    el('form-project').reset();
    el('project-id').value = id;
    V().clearAllErrors(el('form-project'));

    el('project-title').value = p.title || '';
    el('project-description').value = p.description || '';
    el('project-category').value = p.category || '';
    el('project-department').value = p.department || '';
    el('project-semester').value = p.semester || '';
    el('project-deadline').value = p.deadline || '';
    el('project-team').value = (p.teamMembers || []).join(', ');

    populateGuides();
    el('project-guide').value = p.guideId || '';
    el('project-file-info').hidden = true;
    P().openModal('modal-project');
  }

  async function saveProject(ev) {
    ev.preventDefault();
    const user = S().getCurrentUser();
    const form = el('form-project');
    V().clearAllErrors(form);

    const title = el('project-title').value.trim();
    const description = el('project-description').value.trim();

    if (!title) { V().setFieldError('project-title', 'Title is required.'); return; }
    if (!description) { V().setFieldError('project-description', 'Description is required.'); return; }

    const deadline = el('project-deadline').value;
    const deadlineValue = deadline || '';

    // Assemble payload.
    const payload = {
      title,
      description,
      category: el('project-category').value,
      department: el('project-department').value || user.department || '',
      semester: el('project-semester').value,
      teamMembers: P().escapeHtml === undefined ? [] :
        el('project-team').value.split(',').map(s => s.trim()).filter(Boolean),
      guideId: el('project-guide').value || '',
      deadline: deadlineValue,
    };

    // Save file if provided.
    let fileMeta = null;
    if (pendingFile) {
      try {
        const dataUrl = await S().fileToDataUrl(pendingFile);
        fileMeta = Object.assign(S().describeFile(pendingFile), { dataUrl });
      } catch (err) {
        V().setFieldError('project-file', 'Could not read the file: ' + err.message);
        return;
      }
    }

    if (editingId) {
      const existing = S().projects.byId(editingId);
      if (!existing) return;
      const patch = Object.assign({}, payload);
      if (fileMeta) {
        patch.fileName = fileMeta.name;
        patch.fileSize = fileMeta.size;
        patch.fileMime = fileMeta.mime;
        patch.fileDataUrl = fileMeta.dataUrl;
        patch.storedName = fileMeta.name;
      }
      S().projects.update(editingId, patch);
      S().notify(existing.studentId === user.id ? existing.guideId || user.id : existing.studentId,
        'project', 'Project updated', `"${existing.title}" was updated.`,
        'projects.html', { projectId: editingId });
      P().toast({ type: 'success', title: 'Project saved' });
    } else {
      const record = Object.assign({
        id: S().newId('project'),
        studentId: user.id,
        status: 'Draft',
        progress: 0,
        feedback: '',
        createdAt: S().nowIso(),
        updatedAt: S().nowIso(),
        history: [{ status: 'Draft', by: user.id, byName: user.fullName, note: 'Project created', at: S().nowIso() }],
      }, payload);

      if (fileMeta) {
        record.fileName = fileMeta.name;
        record.fileSize = fileMeta.size;
        record.fileMime = fileMeta.mime;
        record.fileDataUrl = fileMeta.dataUrl;
        record.storedName = fileMeta.name;
        // Uploading a file at creation submits it for review.
        record.status = 'Submitted';
        record.history.push({
          status: 'Submitted', by: user.id, byName: user.fullName,
          note: 'File uploaded for review', at: S().nowIso(),
        });
      }

      S().projects.insert(record);

      // Notify guide if assigned.
      if (record.guideId) {
        S().notify(record.guideId, 'project', 'New project assigned',
          `${user.fullName} created "${record.title}".`,
          'projects.html', { projectId: record.id });
      }
      P().toast({
        type: 'success',
        title: record.status === 'Submitted' ? 'Project submitted' : 'Project saved as draft',
      });
    }

    P().closeModal('modal-project');
    refresh();
  }

  // ---------- Details modal ----------
  function openDetails(id) {
    const user = S().getCurrentUser();
    const p = S().projects.byId(id);
    if (!p) return;
    const student = S().users.byId(p.studentId);
    const guide = p.guideId ? S().users.byId(p.guideId) : null;

    el('modal-details-title').textContent = p.title;

    const history = (p.history || []).slice().reverse().map(h => {
      const dotClass = h.status === 'Accepted' ? 'is-ok'
        : h.status === 'Rejected' ? 'is-danger'
        : h.status === 'Changes Requested' ? 'is-warn' : '';
      return `
        <div class="timeline-item">
          <span class="timeline-dot ${dotClass}"></span>
          <div class="timeline-body">
            <strong>${esc(h.status)}</strong>
            <small>${esc(h.byName || '')} · ${esc(fmtDate(h.at))}</small>
            ${h.note ? `<p class="muted small" style="margin:.25rem 0 0;">${esc(h.note)}</p>` : ''}
          </div>
        </div>`;
    }).join('');

    el('details-body').innerHTML = `
      <dl class="detail-list">
        <dt>Student</dt><dd>${esc(student ? student.fullName : '—')}</dd>
        <dt>Guide</dt><dd>${esc(guide ? guide.fullName : 'Not assigned')}</dd>
        <dt>Department</dt><dd>${esc(p.department || '—')}</dd>
        <dt>Category</dt><dd>${esc(p.category || '—')}</dd>
        <dt>Semester</dt><dd>${esc(p.semester || '—')}</dd>
        <dt>Team</dt><dd>${esc((p.teamMembers || []).join(', ') || '—')}</dd>
        <dt>Status</dt><dd><span class="pill ${statusClass(p.status)}">${esc(p.status)}</span></dd>
        <dt>Progress</dt><dd>${p.progress || 0}%</dd>
        <dt>Deadline</dt><dd>${p.deadline ? esc(fmtDate(p.deadline)) : '—'}</dd>
        <dt>Submitted</dt><dd>${esc(fmtDate(p.createdAt))}</dd>
        <dt>Updated</dt><dd>${esc(fmtDate(p.updatedAt))}</dd>
        <dt>Description</dt><dd><div class="pre">${esc(p.description)}</div></dd>
        ${p.feedback ? `<dt>Feedback</dt><dd><div class="pre">${esc(p.feedback)}</div></dd>` : ''}
        ${p.fileName ? `<dt>File</dt><dd>${esc(p.fileName)}${p.fileSize ? ' · ' + esc(V().humanFileSize(p.fileSize)) : ''}</dd>` : ''}
      </dl>
      ${history ? `<h3 style="margin-top:1rem;">History</h3><div class="timeline">${history}</div>` : ''}
    `;

    // Footer buttons
    const footer = el('details-footer');
    footer.innerHTML = '';
    if (p.fileDataUrl) {
      const dl = document.createElement('button');
      dl.type = 'button'; dl.className = 'btn btn-outline';
      dl.textContent = 'Download file';
      dl.addEventListener('click', () => downloadFile(p.id));
      footer.appendChild(dl);
    }
    if (canEdit(user, p) && p.status !== 'Accepted' && p.status !== 'Rejected') {
      const ed = document.createElement('button');
      ed.type = 'button'; ed.className = 'btn btn-primary';
      ed.textContent = 'Edit';
      ed.addEventListener('click', () => { P().closeModal('modal-details'); openEditModal(p.id); });
      footer.appendChild(ed);
    }

    P().openModal('modal-details');
  }

  // ---------- Review workflow ----------
  function openReview(id, action) {
    const p = S().projects.byId(id);
    if (!p) return;
    el('review-project-id').value = id;
    el('review-action').value = action || 'request_changes';

    const titles = {
      accept: 'Accept project',
      reject: 'Reject project',
      request_changes: 'Request changes',
      start_review: 'Start review',
    };
    el('modal-review-title').textContent = titles[action] || 'Review project';
    el('review-context').textContent = `Reviewing "${p.title}".`;

    const feedbackReq = el('review-req');
    const hint = el('review-hint');
    const progressGroup = el('review-progress-group');
    const progressInput = el('review-progress');
    const progressOutput = el('review-progress-value');

    if (action === 'accept' || action === 'start_review') {
      feedbackReq.style.display = 'none';
      hint.textContent = action === 'accept' ? 'Optional note for the student.' : 'Optional.';
    } else {
      feedbackReq.style.display = '';
      hint.textContent = 'Explain your decision so the student can act on it.';
    }

    progressGroup.hidden = action !== 'accept';
    if (action === 'accept') {
      progressInput.value = p.progress || 100;
      progressOutput.textContent = progressInput.value + '%';
    }

    el('review-feedback').value = '';
    V().clearFieldError('review-feedback');

    P().openModal('modal-review');
  }

  async function submitReview() {
    const id = el('review-project-id').value;
    const action = el('review-action').value;
    const feedback = el('review-feedback').value.trim();
    const progress = parseInt(el('review-progress').value, 10) || 0;

    const project = S().projects.byId(id);
    if (!project) return;

    if ((action === 'reject' || action === 'request_changes') && !feedback) {
      V().setFieldError('review-feedback', 'Feedback is required for this action.');
      return;
    }

    const user = S().getCurrentUser();
    const newStatus = {
      accept: 'Accepted',
      reject: 'Rejected',
      request_changes: 'Changes Requested',
      start_review: 'Under Review',
    }[action];

    const patch = {
      status: newStatus,
      feedback: feedback || project.feedback || '',
      reviewedBy: user.id,
      reviewedAt: S().nowIso(),
      history: (project.history || []).concat([{
        status: newStatus, by: user.id, byName: user.fullName,
        note: feedback || action, at: S().nowIso(),
      }]),
    };
    if (action === 'accept') patch.progress = Math.max(project.progress || 0, progress);

    S().projects.update(id, patch);

    S().notify(project.studentId, 'project',
      `Project ${newStatus.toLowerCase()}`,
      `"${project.title}" is now "${newStatus}".` + (feedback ? ` Feedback: ${feedback}` : ''),
      'projects.html', { projectId: id, status: newStatus });

    P().toast({ type: 'success', title: `Project ${newStatus}` });
    P().closeModal('modal-review');
    refresh();
  }

  // ---------- Download ----------
  function downloadFile(id) {
    const p = S().projects.byId(id);
    if (!p || !p.fileDataUrl) {
      P().toast({ type: 'error', title: 'No file available' });
      return;
    }
    const a = document.createElement('a');
    a.href = p.fileDataUrl;
    a.download = p.fileName || 'project-file';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- Event wiring ----------
  function wireEvents() {
    el('btn-new-project')?.addEventListener('click', openNewModal);
    el('btn-new-project-empty')?.addEventListener('click', openNewModal);

    el('form-project')?.addEventListener('submit', saveProject);
    el('btn-submit-review')?.addEventListener('click', submitReview);

    // Review slider
    el('review-progress')?.addEventListener('input', (e) => {
      el('review-progress-value').textContent = e.target.value + '%';
    });

    // Filters
    ['proj-search', 'proj-status', 'proj-dept', 'proj-sort'].forEach(id => {
      el(id)?.addEventListener('input', refresh);
      el(id)?.addEventListener('change', refresh);
    });
    el('proj-clear-filters')?.addEventListener('click', () => {
      el('proj-search').value = '';
      el('proj-status').value = '';
      el('proj-dept').value = '';
      el('proj-sort').value = 'newest';
      refresh();
    });

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        currentView = btn.dataset.view;
        refresh();
      });
    });

    // Delegated card / row actions
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-action][data-id]');
      if (!trigger) return;
      const { action, id } = trigger.dataset;
      if (action === 'view') openDetails(id);
      else if (action === 'edit') openEditModal(id);
      else if (action === 'review') openReview(id, 'request_changes');
      else if (action === 'download') downloadFile(id);
    });

    // URL query — e.g. projects.html?action=new
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'new') {
      setTimeout(openNewModal, 100);
    }
    if (params.get('q')) {
      const search = el('proj-search');
      if (search) { search.value = params.get('q'); }
    }
  }

  // ---------- Bootstrap ----------
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'projects') return;
    if (!S() || !S().isLoggedIn()) return;

    const user = S().getCurrentUser();
    // Students always see the New project button; others do not.
    if (user.role !== 'student' && user.role !== 'admin') {
      el('btn-new-project').hidden = true;
    }
    wireEvents();
    populateGuides();
    wireFileInput();
    refresh();
  });

  return { refresh };
})();