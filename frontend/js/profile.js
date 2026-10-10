/* =====================================================================
   profile.js — Profile view / edit for every role
   ===================================================================== */

window.PGMPProfile = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  let editMode = false;

  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }
  function initials(name) { return P().initials(name); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function userRoleLabel(role) {
    return ({ student: 'Student', lecturer: 'Lecturer', alumni: 'Alumni', admin: 'Administrator' })[role] || role;
  }

  // ---------- View ----------
  function renderView() {
    const user = S().getCurrentUser();
    if (!user) return;

    const avatar = user.avatar
      ? `<img src="${esc(user.avatar)}" alt="" />`
      : initials(user.fullName);

    el('profile-avatar').innerHTML = avatar;
    el('profile-name').textContent = user.fullName;
    el('profile-role').textContent = userRoleLabel(user.role);
    el('profile-dept').textContent = user.department || '';
    el('profile-email').textContent = user.email;
    el('profile-college').textContent = user.collegeName || '—';
    el('profile-usn').textContent = user.usn || '—';
    if (user.role === 'admin') el('profile-usn-row').hidden = true;
    el('profile-joined').textContent = fmtDate(user.createdAt);

    const projectCount = S().projects.byStudent(user.id).length;

    const section = (title, body) => `
      <section class="card" style="margin-bottom:1rem;">
        <header class="card-header"><h2>${title}</h2></header>
        ${body}
      </section>`;

    const paragraphs = [];

    paragraphs.push(section('About', `
      <p>${user.bio ? esc(user.bio) : '<span class="muted">No bio yet.</span>'}</p>
      ${user.phone ? `<p class="muted small">Contact: ${esc(user.phone)}</p>` : ''}
    `));

    if (user.role === 'student') {
      paragraphs.push(section('Academic', `
        <dl class="detail-list">
          <dt>USN</dt><dd>${esc(user.usn || '—')}</dd>
          <dt>Semester</dt><dd>${esc(user.semester || '—')}</dd>
          <dt>Department</dt><dd>${esc(user.department || '—')}</dd>
          <dt>Projects</dt><dd>${projectCount}</dd>
          <dt>Interests</dt><dd>${esc(user.interests || '—')}</dd>
        </dl>
      `));

      const skillTags = (user.skills || []).map(s => `<span class="tag tag-accent">${esc(s)}</span>`).join(' ');
      paragraphs.push(section('Skills', skillTags
        ? `<div class="tag-row">${skillTags}</div>`
        : `<p class="muted small">No skills added yet.</p>`));

      const certList = (user.certifications || []).map(c =>
        `<li style="padding:.4rem 0;border-bottom:1px solid var(--color-border);">${esc(c.name || c)}${c.year ? ' · ' + esc(c.year) : ''}</li>`).join('');
      paragraphs.push(section('Certifications', certList
        ? `<ul>${certList}</ul>`
        : `<p class="muted small">No certifications added yet.</p>`));

      const courseList = (user.courses || []).map(c =>
        `<li style="padding:.4rem 0;border-bottom:1px solid var(--color-border);">${esc(c.name || c)}${c.provider ? ' · ' + esc(c.provider) : ''}</li>`).join('');
      paragraphs.push(section('Courses completed', courseList
        ? `<ul>${courseList}</ul>`
        : `<p class="muted small">No courses added yet.</p>`));
    } else if (user.role === 'lecturer') {
      paragraphs.push(section('Professional', `
        <dl class="detail-list">
          <dt>Designation</dt><dd>${esc(user.designation || '—')}</dd>
          <dt>Experience</dt><dd>${esc(user.experienceYears || '—')} years</dd>
          <dt>Department</dt><dd>${esc(user.department || '—')}</dd>
          <dt>Mentoring</dt><dd>${user.mentorAvailability ? 'Available' : 'Not available'}</dd>
        </dl>
        <p class="muted small" style="margin:.5rem 0 .25rem;">Expertise</p>
        <div class="tag-row">${(user.expertise || []).map(t => `<span class="tag tag-accent">${esc(t)}</span>`).join(' ') || '<span class="muted">—</span>'}</div>
      `));
    } else if (user.role === 'alumni') {
      paragraphs.push(section('Professional', `
        <dl class="detail-list">
          <dt>Company</dt><dd>${esc(user.company || '—')}</dd>
          <dt>Role</dt><dd>${esc(user.jobDesignation || '—')}</dd>
          <dt>Graduated</dt><dd>${esc(user.graduationYear || '—')} · ${esc(user.graduationDepartment || '')}</dd>
          <dt>Mentoring</dt><dd>${user.mentorAvailability ? 'Available' : 'Not available'}</dd>
        </dl>
        <p class="muted small" style="margin:.5rem 0 .25rem;">Expertise</p>
        <div class="tag-row">${(user.expertise || []).map(t => `<span class="tag tag-accent">${esc(t)}</span>`).join(' ') || '<span class="muted">—</span>'}</div>
      `));
    } else {
      paragraphs.push(section('Administrator', `
        <dl class="detail-list">
          <dt>Role</dt><dd>Administrator</dd>
          <dt>Access</dt><dd>User management, project oversight, platform statistics</dd>
        </dl>
      `));
    }

    el('profile-view').innerHTML = paragraphs.join('');
  }

  // ---------- Edit ----------
  function enterEdit() {
    const user = S().getCurrentUser();
    if (!user) return;
    editMode = true;
    el('profile-view').hidden = true;
    el('profile-edit').hidden = false;
    el('btn-edit-profile').hidden = true;
    el('btn-save-profile').hidden = false;
    el('btn-cancel-edit').hidden = false;

    // Fill in fields
    el('edit-fullname').value = user.fullName || '';
    el('edit-college').value = user.collegeName || '';
    el('edit-department').value = user.department || '';
    el('edit-phone').value = user.phone || '';
    el('edit-bio').value = user.bio || '';

    // Show only the block matching the current role.
    document.querySelectorAll('[data-edit-role]').forEach(block => {
      block.hidden = block.dataset.editRole !== user.role;
    });

    if (user.role === 'student') {
      el('edit-semester').value = user.semester || '';
      el('edit-interests').value = user.interests || '';
      el('edit-skills').value = (user.skills || []).join(', ');
    } else if (user.role === 'lecturer') {
      el('edit-designation').value = user.designation || '';
      el('edit-experience').value = user.experienceYears || '';
      el('edit-expertise').value = (user.expertise || []).join(', ');
    } else if (user.role === 'alumni') {
      el('edit-gradyear').value = user.graduationYear || '';
      el('edit-company').value = user.company || '';
      el('edit-job').value = user.jobDesignation || '';
      el('edit-expertise-alumni').value = (user.expertise || []).join(', ');
    }
  }

  function exitEdit() {
    editMode = false;
    el('profile-view').hidden = false;
    el('profile-edit').hidden = true;
    el('btn-edit-profile').hidden = false;
    el('btn-save-profile').hidden = true;
    el('btn-cancel-edit').hidden = true;
  }

  function save() {
    const user = S().getCurrentUser();
    if (!user) return;

    const patch = {
      fullName: el('edit-fullname').value.trim() || user.fullName,
      collegeName: el('edit-college').value.trim(),
      department: el('edit-department').value,
      phone: el('edit-phone').value.trim(),
      bio: el('edit-bio').value.trim(),
    };

    if (user.role === 'student') {
      patch.semester = el('edit-semester').value;
      patch.interests = el('edit-interests').value.trim();
      patch.skills = splitCSV(el('edit-skills').value);
    } else if (user.role === 'lecturer') {
      patch.designation = el('edit-designation').value.trim();
      patch.experienceYears = el('edit-experience').value;
      patch.expertise = splitCSV(el('edit-expertise').value);
    } else if (user.role === 'alumni') {
      patch.graduationYear = el('edit-gradyear').value;
      patch.company = el('edit-company').value.trim();
      patch.jobDesignation = el('edit-job').value.trim();
      patch.expertise = splitCSV(el('edit-expertise-alumni').value);
    }

    S().users.update(user.id, patch);

    // Refresh shell avatar / name.
    const sidebarAvatar = document.querySelector('.sidebar-user .avatar');
    const topAvatar = document.querySelector('.user-menu .avatar');
    const topName = document.querySelector('.user-menu .who strong');
    const sidebarName = document.querySelector('.sidebar-user .who strong');
    if (sidebarName) sidebarName.textContent = patch.fullName;
    if (topName) topName.textContent = patch.fullName;
    if (!user.avatar) {
      const init = initials(patch.fullName);
      if (sidebarAvatar) sidebarAvatar.textContent = init;
      if (topAvatar) topAvatar.textContent = init;
    }

    P().toast({ type: 'success', title: 'Profile saved' });
    exitEdit();
    renderView();
  }

  function splitCSV(str) {
    return String(str || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  // ---------- Avatar upload ----------
  function wireAvatar() {
    el('btn-change-avatar')?.addEventListener('click', () => el('avatar-input').click());
    el('avatar-input')?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        P().toast({ type: 'error', title: 'Please choose an image file.' });
        return;
      }
      if (file.size > 512 * 1024) {
        P().toast({ type: 'error', title: 'Image is too large.', message: 'Maximum 512 KB.' });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const user = S().getCurrentUser();
        S().users.update(user.id, { avatar: reader.result });
        const img = `<img src="${esc(reader.result)}" alt="" />`;
        el('profile-avatar').innerHTML = img;
        document.querySelectorAll('.sidebar-user .avatar, .user-menu .avatar')
          .forEach(a => { a.innerHTML = img; });
        P().toast({ type: 'success', title: 'Avatar updated' });
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Wire ----------
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'profile') return;
    if (!S() || !S().isLoggedIn()) return;
    el('btn-edit-profile')?.addEventListener('click', enterEdit);
    el('btn-save-profile')?.addEventListener('click', save);
    el('btn-cancel-edit')?.addEventListener('click', exitEdit);
    wireAvatar();
    renderView();
  });

  return { renderView };
})();