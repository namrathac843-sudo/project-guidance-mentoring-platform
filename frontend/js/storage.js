/* =====================================================================
   storage.js — Local Storage data layer for the whole application
   =====================================================================
   Namespaced keys (as required by the brief):

     pgmp_users               → array of user records
     pgmp_projects            → array of project records (with embedded file)
     pgmp_mentoring_requests  → array of mentoring-request records
     pgmp_sessions            → array of mentoring-session records
     pgmp_messages            → array of message records
     pgmp_notifications       → array of notification records
     pgmp_settings            → single object { theme, prefs }
     pgmp_current_session     → single object { userId, token, loggedInAt }

   This is a browser-only store. It is readable and writable by the user
   and by any script on this origin. It is NOT secure authentication and
   it is NOT a shared database. See the README for the full statement.
   ===================================================================== */

window.PGMPStorage = (function () {
  'use strict';

  // ---------- Constants ----------
  const KEYS = Object.freeze({
    users:         'pgmp_users',
    projects:      'pgmp_projects',
    requests:      'pgmp_mentoring_requests',
    sessions:      'pgmp_sessions',
    messages:      'pgmp_messages',
    notifications: 'pgmp_notifications',
    settings:      'pgmp_settings',
    current:       'pgmp_current_session',
  });

  const FILE_SIZE_LIMIT = 2 * 1024 * 1024; // 2 MB — see README

  // ---------- Low-level safe access ----------
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null ? fallback : parsed;
    } catch (err) {
      console.warn('[PGMP] Corrupted Local Storage value at', key, err);
      // A corrupt value must not break the whole application.
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      // QuotaExceededError is the usual culprit (large file payloads).
      console.error('[PGMP] Could not write to Local Storage', key, err);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  }

  // ---------- ID helper ----------
  function newId(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    const time = Date.now().toString(36).slice(-4);
    return `${prefix}_${time}${rand}`;
  }

  function nowIso() { return new Date().toISOString(); }

  // ---------- Generic collection ----------
  function collection(key) {
    return {
      all:     () => read(key, []).slice(),
      count:   () => read(key, []).length,
      find:    (pred) => read(key, []).find(pred) || null,
      filter:  (pred) => read(key, []).filter(pred),
      byId:    (id)   => read(key, []).find(x => x.id === id) || null,

      insert(item) {
        const list = read(key, []);
        list.push(item);
        write(key, list);
        return item;
      },

      update(id, patch) {
        const list = read(key, []);
        const idx = list.findIndex(x => x.id === id);
        if (idx === -1) return null;
        list[idx] = Object.assign({}, list[idx], patch, { updatedAt: nowIso() });
        write(key, list);
        return list[idx];
      },

      /** Replace an entire collection (used by reset & bulk ops). */
      replaceAll(items) {
        write(key, Array.isArray(items) ? items : []);
      },

      remove(id) {
        const list = read(key, []);
        const next = list.filter(x => x.id !== id);
        write(key, next);
        return next.length !== list.length;
      },

      removeWhere(pred) {
        const list = read(key, []);
        const next = list.filter(x => !pred(x));
        write(key, next);
        return list.length - next.length;
      },
    };
  }

  // ---------- Users ----------
  const users = collection(KEYS.users);
  users.byEmail = (email) => {
    const target = (email || '').trim().toLowerCase();
    return read(KEYS.users, []).find(u => (u.email || '').toLowerCase() === target) || null;
  };
  users.byUsn = (usn) => {
    const target = (usn || '').trim().toUpperCase();
    if (!target) return null;
    return read(KEYS.users, []).find(u => (u.usn || '').toUpperCase() === target) || null;
  };

  // ---------- Projects ----------
  const projects = collection(KEYS.projects);
  projects.byStudent = (studentId) =>
    read(KEYS.projects, []).filter(p => p.studentId === studentId);
  projects.byGuide = (guideId) =>
    read(KEYS.projects, []).filter(p => p.guideId === guideId);

  // ---------- Mentoring requests ----------
  const requests = collection(KEYS.requests);

  // ---------- Sessions ----------
  const sessions = collection(KEYS.sessions);

  // ---------- Messages ----------
  const messages = collection(KEYS.messages);
  messages.thread = (aId, bId) => {
    const a = aId, b = bId;
    return read(KEYS.messages, [])
      .filter(m =>
        (m.senderId === a && m.receiverId === b) ||
        (m.senderId === b && m.receiverId === a)
      )
      .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
  };

  // ---------- Notifications ----------
  const notifications = collection(KEYS.notifications);
  notifications.forUser = (userId) =>
    read(KEYS.notifications, [])
      .filter(n => n.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  notifications.unreadCount = (userId) =>
    read(KEYS.notifications, []).filter(n => n.userId === userId && !n.read).length;

  // =====================================================================
  // Current session
  // =====================================================================
  function getCurrentSession() {
    return read(KEYS.current, null);
  }

  function setCurrentSession(session) {
    write(KEYS.current, session);
  }

  function clearCurrentSession() {
    remove(KEYS.current);
  }

  function getCurrentUser() {
    const s = getCurrentSession();
    if (!s || !s.userId) return null;
    return users.byId(s.userId);
  }

  function isLoggedIn() {
    const s = getCurrentSession();
    if (!s || !s.userId) return false;
    return !!users.byId(s.userId);
  }

  // =====================================================================
  // Settings (theme, notification preferences)
  // =====================================================================
  const DEFAULT_SETTINGS = {
    theme: 'light',
    prefs: {
      project: true,
      mentoring: true,
      session: true,
      message: true,
      account: true,
    },
  };

  function getSettings() {
    const stored = read(KEYS.settings, {});
    return {
      theme: stored.theme || DEFAULT_SETTINGS.theme,
      prefs: Object.assign({}, DEFAULT_SETTINGS.prefs, stored.prefs || {}),
    };
  }

  function updateSettings(patch) {
    const current = getSettings();
    const next = Object.assign({}, current, patch);
    if (patch && patch.prefs) {
      next.prefs = Object.assign({}, current.prefs, patch.prefs);
    }
    write(KEYS.settings, next);
    return next;
  }

  // =====================================================================
  // Files (Base64 inside Local Storage; documented demo-only)
  // =====================================================================
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }

  function describeFile(file) {
    return {
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
    };
  }

  // =====================================================================
  // Notifications helper (used by every feature module)
  // =====================================================================
  function notify(userId, type, title, message, link, meta) {
    if (!userId) return null;
    const settings = getSettings();
    // Respect the notification preferences.
    if (settings.prefs && settings.prefs[type] === false) return null;

    const record = {
      id: newId('notif'),
      userId,
      type: type || 'account',
      title: title || 'Notification',
      message: message || '',
      link: link || '',
      meta: meta || {},
      read: false,
      createdAt: nowIso(),
    };
    notifications.insert(record);
    return record;
  }

  // =====================================================================
  // Demo seeding and reset
  // =====================================================================
  function demoHash(password) {
    // DEMO-ONLY hash. Not secure. Real authentication runs through the
    // Flask backend using PBKDF2-SHA256 (see backend/utils.py).
    let h = 5381;
    const s = String(password || '');
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return 'demo$' + (h >>> 0).toString(16);
  }

  const DEMO_USERS = [
    {
      id: 'user_demo_admin',
      fullName: 'Demo Administrator',
      email: 'admin@gat.ac.in',
      collegeName: 'Global Academy of Technology',
      department: 'Administration',
      usn: '',
      role: 'admin',
      passwordHash: demoHash('Admin@12345'),
      status: 'Active',
      avatar: '',
      bio: 'Seeded administrator account for the demonstration.',
    },
    {
      id: 'user_demo_lecturer',
      fullName: 'Dr. Meera Rao',
      email: 'meera.rao@gat.ac.in',
      collegeName: 'Global Academy of Technology',
      department: 'Computer Science and Engineering',
      usn: '',
      role: 'lecturer',
      designation: 'Associate Professor',
      experienceYears: 11,
      expertise: ['Machine Learning', 'Databases', 'Distributed Systems'],
      skills: ['Python', 'SQL', 'Research Supervision'],
      mentorAvailability: true,
      passwordHash: demoHash('Lecturer@123'),
      status: 'Active',
      avatar: '',
      bio: 'Associate Professor focused on applied machine learning and student mentoring.',
    },
    {
      id: 'user_demo_student',
      fullName: 'Ananya Sharma',
      email: '1GA21CS001@gat.ac.in',
      collegeName: 'Global Academy of Technology',
      department: 'Computer Science and Engineering',
      usn: '1GA21CS001',
      role: 'student',
      semester: '6',
      skills: ['Python', 'Flask', 'JavaScript'],
      interests: 'Applied machine learning, web platforms',
      certifications: [],
      courses: [],
      mentorAvailability: false,
      passwordHash: demoHash('Student@123'),
      status: 'Active',
      avatar: '',
      bio: 'Final-year CSE student working on an intelligent agriculture platform.',
    },
    {
      id: 'user_demo_alumni',
      fullName: 'Arjun Krishnan',
      email: 'arjun.k@gat.ac.in',
      collegeName: 'Global Academy of Technology',
      department: 'Computer Science and Engineering',
      graduationDepartment: 'Computer Science',
      graduationYear: '2020',
      company: 'Infosys',
      jobDesignation: 'Senior Software Engineer',
      expertise: ['Cloud', 'DevOps', 'Data Engineering'],
      skills: ['AWS', 'Docker', 'Kubernetes'],
      mentorAvailability: true,
      role: 'alumni',
      passwordHash: demoHash('Alumni@123'),
      status: 'Active',
      avatar: '',
      bio: 'Alumnus mentoring students on cloud engineering and career preparation.',
    },
  ];

  function seedIfEmpty() {
    const existing = read(KEYS.users, []);
    if (existing.length > 0) return false;

    const stamp = nowIso();
    const seeded = DEMO_USERS.map(u => Object.assign({}, u, {
      createdAt: stamp,
      updatedAt: stamp,
    }));
    users.replaceAll(seeded);
    projects.replaceAll([]);
    requests.replaceAll([]);
    sessions.replaceAll([]);
    messages.replaceAll([]);
    notifications.replaceAll([]);
    write(KEYS.settings, DEFAULT_SETTINGS);
    console.info('[PGMP] Demo accounts seeded. See the login page for credentials.');
    return true;
  }

  function reset(keepSession) {
    const sessionBackup = keepSession ? getCurrentSession() : null;
    Object.values(KEYS).forEach(k => remove(k));
    write(KEYS.settings, DEFAULT_SETTINGS);
    seedIfEmpty();
    if (sessionBackup) setCurrentSession(sessionBackup);
    return true;
  }

  // =====================================================================
  // Public API
  // =====================================================================
  return {
    KEYS,
    FILE_SIZE_LIMIT,
    newId,
    nowIso,
    read,
    write,
    remove,

    users,
    projects,
    requests,
    sessions,
    messages,
    notifications,

    getCurrentSession,
    setCurrentSession,
    clearCurrentSession,
    getCurrentUser,
    isLoggedIn,

    getSettings,
    updateSettings,

    fileToDataUrl,
    describeFile,

    notify,

    demoHash,
    seedIfEmpty,
    reset,
  };
})();