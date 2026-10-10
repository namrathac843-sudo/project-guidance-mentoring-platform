/* =====================================================================
   dashboard.js — Role-specific dashboard rendering + Chart.js
   =====================================================================
   Reads from Local Storage. Renders stat cards, quick panels, charts,
   and recent activity tables depending on the current user's role.
   Shows a helpful empty state when there is no data instead of faking
   numbers.
   ===================================================================== */

window.PGMPDashboard = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const P = () => window.PGMP;

  let statusChart, progressChart, usersChart, overtimeChart;

  // ---------- Small helpers ----------
  function el(id) { return document.getElementById(id); }
  function esc(v) { return P().escapeHtml(v); }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  // ---------- Data scoping per role ----------
  function myProjects(user) {
    const all = S().projects.all();
    if (user.role === 'student') return all.filter(p => p.studentId === user.id);
    if (user.role === 'lecturer') return all.filter(
      p => p.guideId === user.id || p.department === user.department
    );
    if (user.role === 'alumni') {
      const menteeIds = new Set(
        S().requests.filter(r => r.mentorId === user.id && r.status === 'Accepted')
          .map(r => r.studentId)
      );
      return all.filter(p => menteeIds.has(p.studentId));
    }
    return all; // admin
  }

  function statusCounts(projects) {
    const c = {
      'Draft': 0, 'Submitted': 0, 'Under Review': 0,
      'Accepted': 0, 'Changes Requested': 0, 'Rejected': 0,
    };
    projects.forEach(p => { if (c[p.status] !== undefined) c[p.status]++; });
    return c;
  }

  function mySessions(user, scope) {
    const all = S().sessions.all();
    let list;
    if (user.role === 'admin') list = all;
    else list = all.filter(s => s.mentorId === user.id || s.studentId === user.id);

    const today = new Date().toISOString().slice(0, 10);
    if (scope === 'upcoming') return list.filter(s => s.date >= today && s.status === 'Scheduled');
    if (scope === 'past')     return list.filter(s => s.date < today || s.status === 'Completed');
    return list;
  }

  function myRequests(user) {
    const all = S().requests.all();
    if (user.role === 'student') return all.filter(r => r.studentId === user.id);
    if (user.role === 'lecturer' || user.role === 'alumni') return all.filter(r => r.mentorId === user.id);
    return all;
  }

  // ---------- Greeting ----------
  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // ---------- Stat cards per role ----------
  function statCard(label, value, hint, icon, variant) {
    return `
      <article class="stat-card ${variant ? 'stat-card--' + variant : ''}">
        <span class="stat-label">${esc(label)}</span>
        <span class="stat-value">${esc(String(value))}</span>
        ${hint ? `<span class="stat-hint">${esc(hint)}</span>` : ''}
        <span class="stat-icon" aria-hidden="true">${icon}</span>
      </article>`;
  }

  function renderAdminStats(user) {
    const users = S().users.all();
    const projects = S().projects.all();
    const counts = statusCounts(projects);
    const sessions = S().sessions.all().filter(s => s.status === 'Scheduled');

    el('dash-stats').innerHTML = [
      statCard('Total users', users.length, `${users.filter(u => u.status === 'Active').length} active`, '👥', 'info'),
      statCard('Students', users.filter(u => u.role === 'student').length, '', '🎒'),
      statCard('Lecturers', users.filter(u => u.role === 'lecturer').length, '', '👨‍🏫'),
      statCard('Alumni', users.filter(u => u.role === 'alumni').length, '', '🎓'),
      statCard('Total projects', projects.length, '', '📁', 'info'),
      statCard('Pending review', counts['Submitted'] + counts['Under Review'], 'Awaiting decision', '⏳', 'warn'),
      statCard('Accepted', counts['Accepted'], '', '✓', 'ok'),
      statCard('Rejected', counts['Rejected'], '', '✕', 'danger'),
      statCard('Active sessions', sessions.length, '', '📅'),
    ].join('');
  }

  function renderLecturerStats(user) {
    const projects = myProjects(user);
    const counts = statusCounts(projects);
    const sessions = mySessions(user, 'upcoming');
    const requests = myRequests(user).filter(r => r.status === 'Pending');
    const studentsAssigned = new Set(projects.map(p => p.studentId)).size;

    el('dash-stats').innerHTML = [
      statCard('Students assigned', studentsAssigned, '', '👥', 'info'),
      statCard('Awaiting review', counts['Submitted'] + counts['Under Review'], '', '⏳', 'warn'),
      statCard('Accepted', counts['Accepted'], '', '✓', 'ok'),
      statCard('Rejected', counts['Rejected'], '', '✕', 'danger'),
      statCard('Upcoming sessions', sessions.length, '', '📅'),
      statCard('Pending requests', requests.length, 'From students', '📨', 'info'),
    ].join('');
  }

  function renderStudentStats(user) {
    const projects = myProjects(user);
    const counts = statusCounts(projects);
    const sessions = mySessions(user, 'upcoming');
    const requests = myRequests(user).filter(r => r.status === 'Pending');
    const notifs = S().notifications.forUser(user.id).filter(n => !n.read).length;
    const msgs = S().messages.all().filter(m => m.receiverId === user.id && !m.read).length;

    // Progress: average of all projects, or 0 if none.
    const avgProgress = projects.length
      ? Math.round(projects.reduce((s, p) => s + (p.progress || 0), 0) / projects.length)
      : 0;

    el('dash-stats').innerHTML = [
      statCard('Projects submitted', projects.length, '', '📁', 'info'),
      statCard('Awaiting approval', counts['Submitted'] + counts['Under Review'], '', '⏳', 'warn'),
      statCard('Accepted', counts['Accepted'], '', '✓', 'ok'),
      statCard('Rejected', counts['Rejected'], '', '✕', 'danger'),
      statCard('Average progress', avgProgress + '%', projects.length ? 'Across all your projects' : 'No projects yet', '📊'),
      statCard('Upcoming sessions', sessions.length, '', '📅'),
      statCard('Pending requests', requests.length, 'To mentors', '📨'),
      statCard('Unread notifications', notifs, '', '🔔', 'info'),
      statCard('Unread messages', msgs, '', '💬'),
    ].join('');
  }

  function renderAlumniStats(user) {
    const sessions = S().sessions.all().filter(s => s.mentorId === user.id);
    const upcoming = sessions.filter(s => s.status === 'Scheduled' && s.date >= new Date().toISOString().slice(0, 10));
    const requests = myRequests(user);
    const pending = requests.filter(r => r.status === 'Pending');
    const studentsMentored = new Set(requests.filter(r => r.status === 'Accepted').map(r => r.studentId)).size;
    const notifs = S().notifications.forUser(user.id).filter(n => !n.read).length;
    const msgs = S().messages.all().filter(m => m.receiverId === user.id && !m.read).length;

    el('dash-stats').innerHTML = [
      statCard('Sessions conducted', sessions.filter(s => s.status === 'Completed' || (s.date < new Date().toISOString().slice(0,10))).length, '', '✓', 'ok'),
      statCard('Pending requests', pending.length, '', '📨', 'warn'),
      statCard('Upcoming sessions', upcoming.length, '', '📅'),
      statCard('Students mentored', studentsMentored, 'Across all sessions', '👥', 'info'),
      statCard('Unread notifications', notifs, '', '🔔'),
      statCard('Unread messages', msgs, '', '💬'),
    ].join('');
  }

  // ---------- Quick action buttons ----------
  function renderQuickActions(user) {
    const wrap = el('dash-quick-actions');
    if (!wrap) return;
    const actions = [];

    if (user.role === 'student') {
      actions.push(`<a class="btn btn-primary" href="projects.html?action=new">+ New project</a>`);
      actions.push(`<a class="btn btn-outline" href="mentors.html">Find mentors</a>`);
      actions.push(`<a class="btn btn-ghost" href="mentoring-sessions.html">My sessions</a>`);
    } else if (user.role === 'lecturer') {
      actions.push(`<a class="btn btn-primary" href="projects.html">Review projects</a>`);
      actions.push(`<a class="btn btn-outline" href="mentoring-sessions.html">Schedule session</a>`);
    } else if (user.role === 'alumni') {
      actions.push(`<a class="btn btn-primary" href="mentoring-sessions.html?action=new">Schedule session</a>`);
      actions.push(`<a class="btn btn-outline" href="mentors.html">Requests</a>`);
    } else {
      actions.push(`<a class="btn btn-primary" href="settings.html?tab=users">Manage users</a>`);
      actions.push(`<a class="btn btn-outline" href="projects.html">All projects</a>`);
    }
    wrap.innerHTML = actions.join('');
  }

  // ---------- Panels (recent items) ----------
  function panel(title, subtitle, bodyHtml, emptyText) {
    const body = bodyHtml || `<p class="muted small">${esc(emptyText || 'Nothing to show yet.')}</p>`;
    return `
      <article class="card panel">
        <header class="card-header">
          <h2>${esc(title)}</h2>
          ${subtitle ? `<p class="card-subtitle">${esc(subtitle)}</p>` : ''}
        </header>
        ${body}
      </article>`;
  }

  function recentProjectsTable(user) {
    const list = myProjects(user)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 5);
    if (!list.length) return '';
    return `
      <div class="table-scroll">
        <table class="data-table" style="min-width:auto;">
          <thead><tr><th>Title</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>
            ${list.map(p => `
              <tr>
                <td class="cell-title">${esc(p.title)}</td>
                <td>${statusPill(p.status)}</td>
                <td>${esc(fmtDate(p.updatedAt))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function statusPill(status) {
    const map = {
      'Accepted': 'pill-ok',
      'Rejected': 'pill-danger',
      'Submitted': 'pill-info',
      'Under Review': 'pill-info',
      'Changes Requested': 'pill-warn',
      'Draft': 'pill-neutral',
    };
    return `<span class="pill ${map[status] || 'pill-neutral'}">${esc(status)}</span>`;
  }

  function upcomingSessionsList(user) {
    const list = mySessions(user, 'upcoming')
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
      .slice(0, 4);
    if (!list.length) return '';
    return `<ul style="display:grid;gap:.5rem;">${
      list.map(s => `
        <li style="display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--color-border);">
          <div>
            <strong style="font-size:.9rem;">${esc(s.title)}</strong>
            <div class="muted small">${esc(s.date)} · ${esc(s.startTime)}–${esc(s.endTime)}</div>
          </div>
          <a class="btn btn-ghost btn-sm" href="${esc(s.meetingUrl)}" target="_blank" rel="noopener">Join</a>
        </li>`).join('')
    }</ul>`;
  }

  function recentNotificationsList(user) {
    const list = S().notifications.forUser(user.id).slice(0, 4);
    if (!list.length) return '';
    return `<ul style="display:grid;gap:.5rem;">${
      list.map(n => `
        <li style="padding:.5rem 0;border-bottom:1px solid var(--color-border);">
          <strong style="display:block;font-size:.88rem;">${esc(n.title)}</strong>
          <span class="muted small">${esc(n.message)}</span>
        </li>`).join('')
    }</ul>`;
  }

  function recentActivityList() {
    // Build a merged timeline from recent records (no fake entries).
    const events = [];
    S().projects.all().forEach(p => events.push({
      at: p.updatedAt || p.createdAt,
      text: `Project "${p.title}" — ${p.status}`,
    }));
    S().sessions.all().forEach(s => events.push({
      at: s.updatedAt || s.createdAt,
      text: `Session "${s.title}" — ${s.status}`,
    }));
    S().users.all().forEach(u => events.push({
      at: u.createdAt,
      text: `${u.fullName} registered as ${u.role}`,
    }));
    events.sort((a, b) => (a.at < b.at ? 1 : -1));
    const top = events.slice(0, 6);
    if (!top.length) return '';
    return `<ul style="display:grid;gap:.5rem;">${
      top.map(e => `
        <li style="display:flex;justify-content:space-between;gap:1rem;padding:.5rem 0;border-bottom:1px solid var(--color-border);">
          <span style="font-size:.86rem;">${esc(e.text)}</span>
          <span class="muted small">${esc(fmtDateTime(e.at))}</span>
        </li>`).join('')
    }</ul>`;
  }

  function renderPanels(user) {
    const panels = el('dash-panels');
    const parts = [];

    if (user.role === 'admin') {
      parts.push(panel('Recent activity', 'Everything that happened recently', recentActivityList(), 'No activity yet.'));
      parts.push(panel('Recent projects', 'Latest submissions across the platform', recentProjectsTable(user), 'No projects yet.'));
    } else if (user.role === 'lecturer') {
      parts.push(panel('Recent student submissions', 'Projects you can review',
        recentProjectsTable(user), 'No projects assigned to your department yet.'));
      parts.push(panel('Upcoming sessions', 'Mentoring sessions you have scheduled',
        upcomingSessionsList(user), 'No upcoming sessions.'));
    } else if (user.role === 'student') {
      parts.push(panel('My recent projects', 'Latest updates', recentProjectsTable(user), 'No projects yet — start one from the Projects page.'));
      parts.push(panel('Upcoming sessions', 'Meet your mentors', upcomingSessionsList(user), 'No sessions scheduled yet.'));
      parts.push(panel('Notifications', 'Recent updates', recentNotificationsList(user), 'Nothing new.'));
    } else if (user.role === 'alumni') {
      parts.push(panel('Upcoming sessions', 'Students you will be mentoring',
        upcomingSessionsList(user), 'No upcoming sessions.'));
      parts.push(panel('Recent notifications', '', recentNotificationsList(user), 'Nothing new.'));
    }

    if (parts.length) {
      panels.innerHTML = parts.join('');
      panels.hidden = false;
    }
  }

  // ---------- Charts ----------
  function hasAnyData(values) {
    return values.some(v => v > 0);
  }

  function destroyChart(chart) {
    if (chart && typeof chart.destroy === 'function') { try { chart.destroy(); } catch (_) {} }
  }

  function renderStatusChart(projects) {
    const canvas = el('chart-status');
    if (!canvas || typeof Chart === 'undefined') return;
    const counts = statusCounts(projects);
    const labels = Object.keys(counts);
    const values = labels.map(k => counts[k]);

    const empty = el('chart-status-empty');
    if (empty) empty.hidden = hasAnyData(values);
    canvas.style.display = hasAnyData(values) ? '' : 'none';
    if (!hasAnyData(values)) { destroyChart(statusChart); statusChart = null; return; }

    destroyChart(statusChart);
    statusChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ['#94a3b8', '#3b82f6', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}` } },
        },
        cutout: '60%',
      },
    });
  }

  function renderProgressChart(projects) {
    const canvas = el('chart-progress');
    if (!canvas || typeof Chart === 'undefined') return;
    const top = projects
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 8);
    const empty = el('chart-progress-empty');
    const anyProgress = top.some(p => (p.progress || 0) > 0);

    if (empty) empty.hidden = anyProgress;
    canvas.style.display = anyProgress ? '' : 'none';
    if (!top.length || !anyProgress) { destroyChart(progressChart); progressChart = null; return; }

    destroyChart(progressChart);
    progressChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: top.map(p => p.title.length > 22 ? p.title.slice(0, 20) + '…' : p.title),
        datasets: [{
          label: 'Progress %',
          data: top.map(p => p.progress || 0),
          backgroundColor: 'rgba(13, 148, 136, 0.75)',
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%', font: { size: 11 } } },
          x: { ticks: { font: { size: 10 } } },
        },
      },
    });
  }

  function renderUsersChart() {
    const card = el('chart-users-card');
    const canvas = el('chart-users');
    if (!card || !canvas || typeof Chart === 'undefined') return;
    const users = S().users.all();
    const roles = ['student', 'lecturer', 'alumni', 'admin'];
    const counts = roles.map(r => users.filter(u => u.role === r).length);

    card.hidden = !hasAnyData(counts);
    if (!hasAnyData(counts)) { destroyChart(usersChart); usersChart = null; return; }

    destroyChart(usersChart);
    usersChart = new Chart(canvas.getContext('2d'), {
      type: 'pie',
      data: {
        labels: roles.map(r => r.charAt(0).toUpperCase() + r.slice(1)),
        datasets: [{
          data: counts,
          backgroundColor: ['#0ea5e9', '#6366f1', '#0d9488', '#f59e0b'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      },
    });
  }

  function renderOvertimeChart(projects) {
    const card = el('chart-overtime-card');
    const canvas = el('chart-overtime');
    if (!card || !canvas || typeof Chart === 'undefined') return;

    // Group submissions by YYYY-MM.
    const buckets = {};
    projects.forEach(p => {
      const m = (p.createdAt || '').slice(0, 7);
      if (m) buckets[m] = (buckets[m] || 0) + 1;
    });
    const months = Object.keys(buckets).sort();
    const values = months.map(m => buckets[m]);

    card.hidden = months.length === 0;
    const empty = el('chart-overtime-empty');
    if (empty) empty.hidden = months.length > 0;
    canvas.style.display = months.length ? '' : 'none';
    if (!months.length) { destroyChart(overtimeChart); overtimeChart = null; return; }

    destroyChart(overtimeChart);
    overtimeChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'Submissions',
          data: values,
          borderColor: '#0d9488',
          backgroundColor: 'rgba(13,148,136,0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } } } },
      },
    });
  }

  // ---------- Main render ----------
  function render() {
    const user = S().getCurrentUser();
    if (!user) return;

    // Greeting
    const greetEl = el('dash-greeting');
    if (greetEl) greetEl.textContent = `${greeting()}, ${user.fullName.split(' ')[0]}`;
    const subEl = el('dash-subtitle');
    if (subEl) {
      const roleText = {
        student: 'Track your projects, sessions, and mentor feedback.',
        lecturer: 'Review submissions and mentor your students.',
        alumni: 'Share your industry experience with current students.',
        admin: 'Monitor activity across the platform.',
      }[user.role] || 'Welcome to your dashboard.';
      subEl.textContent = roleText;
    }

    renderQuickActions(user);
    el('dash-loading').hidden = true;

    if (user.role === 'admin')         renderAdminStats(user);
    else if (user.role === 'lecturer') renderLecturerStats(user);
    else if (user.role === 'student')  renderStudentStats(user);
    else if (user.role === 'alumni')   renderAlumniStats(user);
    el('dash-stats').hidden = false;

    renderPanels(user);

    const projects = myProjects(user);
    const stats = el('dash-charts');
    if (stats) stats.hidden = false;

    renderStatusChart(projects);
    renderProgressChart(projects);
    if (user.role === 'admin') {
      renderUsersChart();
      renderOvertimeChart(S().projects.all());
    }

    el('dash-tables').hidden = true; // panels above already cover this
  }

  // ---------- Bootstrap ----------
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page !== 'dashboard') return;
    if (!window.PGMPStorage || !window.PGMPStorage.isLoggedIn()) return;
    render();

    // Re-render when the theme changes (chart text color relies on CSS vars).
    document.addEventListener('pgmp:theme-changed', () => render());
  });

  return { render };
})();