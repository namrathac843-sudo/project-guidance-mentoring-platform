/* =====================================================================
   auth.js — Registration, login, logout, and session guard
   =====================================================================
   Works entirely against Local Storage. The Flask backend endpoints
   exist for the REST demo but are not required for the shell to work.

   SECURITY NOTE
   -------------
   Local Storage authentication is a DEMONSTRATION ONLY. Passwords are
   hashed with a toy algorithm on the client. Anyone with DevTools can
   read or modify the store. This is NOT production-safe. See README.

   COLLEGE-EMAIL POLICY (this revision)
   ------------------------------------
   Every role must register with an official college email:
     * Student  → <USN>@<COLLEGE_EMAIL_DOMAIN>
                  (e.g. 1ga21cs001@gat.ac.in)
     * Lecturer → any local-part @<COLLEGE_EMAIL_DOMAIN>
                  (e.g. meera.rao@gat.ac.in)
     * Alumni   → any local-part @<COLLEGE_EMAIL_DOMAIN>
                  (e.g. arjun.k@gat.ac.in)
   Registration with a personal email (gmail, yahoo, …) is rejected with
   the message: "You must register using your college email."
   ===================================================================== */

window.PGMPAuth = (function () {
  'use strict';

  const S = () => window.PGMPStorage;
  const V = () => window.PGMPValidators;

  // ===================================================================
  // Registration page
  // ===================================================================
  function initRegisterPage() {
    const form = document.getElementById('register-form');
    if (!form) return;

    // Role tabs -----------------------------------------------------
    const roleInput = document.getElementById('reg-role');
    const tabs = document.querySelectorAll('.role-tab');
    const sections = document.querySelectorAll('[data-role-section]');
    const emailHint = document.getElementById('email-hint');

    function setRole(role) {
      roleInput.value = role;
      tabs.forEach(t => {
        const active = t.dataset.role === role;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      sections.forEach(s => {
        s.hidden = s.dataset.roleSection !== role;
      });

      // Email hint text depends on the selected role.
      if (emailHint) {
        const domain = V().COLLEGE_EMAIL_DOMAIN;
        if (role === 'student') {
          emailHint.innerHTML =
            `Student emails must match your USN: <code>&lt;USN&gt;@${domain}</code>` +
            ` (e.g. <code>1ga21cs001@${domain}</code>).`;
        } else {
          emailHint.innerHTML =
            `You must register using your official college email ` +
            `(ends with <code>@${domain}</code>).`;
        }
      }
    }

    tabs.forEach(t => t.addEventListener('click', () => setRole(t.dataset.role)));
    setRole('student');

    // Show/hide password buttons ------------------------------------
    document.querySelectorAll('[data-toggle-password]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.togglePassword);
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.textContent = reveal ? 'Hide' : 'Show';
        btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      });
    });

    // Live clear of field errors ------------------------------------
    form.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', () => V().clearFieldError(el.id));
      el.addEventListener('change', () => V().clearFieldError(el.id));
    });

    // Submit --------------------------------------------------------
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      V().clearAllErrors(form);
      const alertBox = document.getElementById('register-alert');
      alertBox.hidden = true;

      const role = roleInput.value;
      const data = {
        fullName: document.getElementById('reg-fullname').value.trim(),
        email: document.getElementById('reg-email').value.trim().toLowerCase(),
        collegeName: document.getElementById('reg-college').value.trim(),
        department: document.getElementById('reg-department').value,
        usn: '',
        role: role,
        password: document.getElementById('reg-password').value,
        confirmPassword: document.getElementById('reg-confirm').value,
      };

      // Role-specific fields
      if (role === 'student') {
        data.usn = document.getElementById('reg-usn').value.trim().toUpperCase();
        data.semester = document.getElementById('reg-semester').value;
        data.skills = splitCSV(document.getElementById('reg-skills').value);
        data.interests = '';
      } else if (role === 'lecturer') {
        data.designation = document.getElementById('reg-designation').value.trim();
        data.experienceYears = document.getElementById('reg-experience').value;
        data.usn = document.getElementById('reg-usn-lecturer').value.trim();
        data.expertise = splitCSV(document.getElementById('reg-expertise').value);
        data.skills = [];
      } else if (role === 'alumni') {
        data.graduationDepartment = document.getElementById('reg-grad-dept').value.trim();
        data.graduationYear = document.getElementById('reg-grad-year').value;
        data.company = document.getElementById('reg-company').value.trim();
        data.jobDesignation = document.getElementById('reg-job').value.trim();
        data.expertise = splitCSV(document.getElementById('reg-expertise-alumni').value);
        data.skills = [];
      }

      // --- Standard validation (name, email format, password, USN) ---
      const result = V().validateRegistration(data, role);
      if (!result.ok) {
        Object.entries(result.errors).forEach(([field, msg]) => V().setFieldError(field, msg));
        showAlert(alertBox, 'error', 'Please correct the highlighted fields.');
        focusFirstInvalid(result.errors);
        return;
      }

      // ============================================================
      // STRICT COLLEGE-EMAIL ENFORCEMENT
      // ------------------------------------------------------------
      // Every role must use an official college email address.
      //   * Student  → <USN>@<domain>  (already checked in validators.js)
      //   * Lecturer → any local-part @<domain>
      //   * Alumni   → any local-part @<domain>
      // ============================================================
      const domain = (V().COLLEGE_EMAIL_DOMAIN || '').toLowerCase();
      const domainSuffix = '@' + domain;

      if (!domain || !data.email.endsWith(domainSuffix)) {
        V().setFieldError(
          'reg-email',
          `You must register using your college email (ends with ${domainSuffix}).`
        );
        showAlert(
          alertBox,
          'error',
          `You must register using your official college email. ` +
          `Only emails ending with ${domainSuffix} are allowed.`
        );
        // Move focus to the email field so the user sees the error.
        const emailEl = document.getElementById('reg-email');
        if (emailEl) emailEl.focus();
        return;
      }

      // ============================================================
      // LECTURER / ALUMNI local-part sanity check
      // ------------------------------------------------------------
      // Reject obviously fake local-parts such as "admin@", "root@",
      // "test@" to keep the directory tidy for the demo.
      // ============================================================
      if (role === 'lecturer' || role === 'alumni') {
        const localPart = data.email.slice(0, data.email.length - domainSuffix.length);
        const blocked = ['admin', 'root', 'test', 'user', 'demo', 'null', 'undefined'];
        if (!localPart || blocked.includes(localPart)) {
          V().setFieldError(
            'reg-email',
            'Please use your real staff / alumni email (for example firstname.lastname).'
          );
          showAlert(
            alertBox,
            'error',
            'That email prefix is not allowed. Please register with your official college email.'
          );
          return;
        }
      }

      // --- Terms acknowledgement ---------------------------------
      if (!document.getElementById('reg-terms').checked) {
        showAlert(alertBox, 'error', 'Please accept the demonstration notice before continuing.');
        return;
      }

      // --- Duplicate checks --------------------------------------
      if (S().users.byEmail(data.email)) {
        V().setFieldError('reg-email', 'An account with this email already exists.');
        showAlert(alertBox, 'error', 'That email is already registered.');
        return;
      }
      if (data.usn && S().users.byUsn(data.usn)) {
        V().setFieldError('reg-usn', 'An account with this USN already exists.');
        showAlert(alertBox, 'error', 'That USN is already registered.');
        return;
      }

      // --- Save the user -----------------------------------------
      const user = {
        id: S().newId('user'),
        fullName: data.fullName,
        email: data.email,
        collegeName: data.collegeName,
        department: data.department,
        usn: data.usn || '',
        role: data.role,
        passwordHash: S().demoHash(data.password),
        status: 'Active',
        avatar: '',
        bio: '',
        phone: '',
        mentorAvailability: data.role === 'lecturer' || data.role === 'alumni',
        createdAt: S().nowIso(),
        updatedAt: S().nowIso(),
      };

      if (role === 'student') {
        Object.assign(user, {
          semester: data.semester,
          skills: data.skills,
          interests: data.interests,
          certifications: [],
          courses: [],
        });
      } else if (role === 'lecturer') {
        Object.assign(user, {
          designation: data.designation,
          experienceYears: data.experienceYears,
          expertise: data.expertise,
          skills: data.skills,
        });
      } else if (role === 'alumni') {
        Object.assign(user, {
          graduationDepartment: data.graduationDepartment,
          graduationYear: data.graduationYear,
          company: data.company,
          jobDesignation: data.jobDesignation,
          expertise: data.expertise,
          skills: data.skills,
        });
      }

      S().users.insert(user);
      S().notify(
        user.id,
        'account',
        'Welcome',
        'Your account was created successfully. Complete your profile to get started.',
        'profile.html'
      );

      showAlert(alertBox, 'success', 'Registration successful. Redirecting to login…');
      setTimeout(() => { window.location.href = 'login.html?registered=1'; }, 900);
    });
  }

  // ===================================================================
  // Login page
  // ===================================================================
  function initLoginPage() {
    const form = document.getElementById('login-form');
    if (!form) return;

    // Remember my email
    const emailInput = document.getElementById('login-email');
    const remembered = localStorage.getItem('pgmp_remembered_email');
    if (remembered) {
      emailInput.value = remembered;
      document.getElementById('login-remember').checked = true;
    }

    // Show/hide password
    document.querySelectorAll('[data-toggle-password]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.togglePassword);
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.textContent = reveal ? 'Hide' : 'Show';
      });
    });

    // Alert if we came from a registration
    const params = new URLSearchParams(window.location.search);
    if (params.get('registered') === '1') {
      const box = document.getElementById('login-alert');
      showAlert(box, 'success', 'Account created. Please log in.');
    }

    // Live clear
    form.querySelectorAll('input').forEach(el => {
      el.addEventListener('input', () => V().clearFieldError(el.id));
    });

    // Submit
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      V().clearAllErrors(form);
      const alertBox = document.getElementById('login-alert');
      alertBox.hidden = true;

      const email = emailInput.value.trim().toLowerCase();
      const password = document.getElementById('login-password').value;

      if (!email)    { V().setFieldError('login-email', 'Email is required.'); return; }
      if (!password) { V().setFieldError('login-password', 'Password is required.'); return; }
      if (!V().isEmail(email)) {
        V().setFieldError('login-email', 'Enter a valid email address.');
        return;
      }

      // -----------------------------------------------------------
      // 1. The email must be an official college email
      // -----------------------------------------------------------
      const domainSuffix = '@' + (V().COLLEGE_EMAIL_DOMAIN || '').toLowerCase();
      if (domainSuffix.length > 1 && !email.endsWith(domainSuffix)) {
        V().setFieldError(
          'login-email',
          `Please use your college email (ends with ${domainSuffix}).`
        );
        showAlert(
          alertBox,
          'error',
          `You must log in using your official college email (${domainSuffix}).`
        );
        return;
      }

      // -----------------------------------------------------------
      // 2. The email must exist in the college directory
      // -----------------------------------------------------------
      const user = S().users.byEmail(email);
      if (!user) {
        V().setFieldError('login-email', 'This email is not registered.');
        showAlert(
          alertBox,
          'error',
          'Email does not exist. Please register using your official college email.'
        );
        return;
      }

      // -----------------------------------------------------------
      // 3. The password must match
      // -----------------------------------------------------------
      if (user.passwordHash !== S().demoHash(password)) {
        V().setFieldError('login-password', 'Incorrect password.');
        showAlert(alertBox, 'error', 'Incorrect password. Please try again.');
        return;
      }

      // -----------------------------------------------------------
      // 4. The account must be active
      // -----------------------------------------------------------
      if (user.status === 'Deactivated') {
        showAlert(
          alertBox,
          'error',
          'This account is deactivated. Please contact an administrator.'
        );
        return;
      }

      // -----------------------------------------------------------
      // 5. Success
      // -----------------------------------------------------------
      S().setCurrentSession({
        userId: user.id,
        token: 'local-' + S().newId('sess'),
        loggedInAt: S().nowIso(),
      });

      if (document.getElementById('login-remember').checked) {
        localStorage.setItem('pgmp_remembered_email', email);
      } else {
        localStorage.removeItem('pgmp_remembered_email');
      }

      showAlert(alertBox, 'success', 'Login successful. Redirecting…');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
    });

    // Forgot-password toggle
    const forgotPanel = document.getElementById('forgot-panel');
    const openForgot = document.getElementById('open-forgot');
    const closeForgot = document.getElementById('close-forgot');
    const forgotForm = document.getElementById('forgot-form');
    const forgotResult = document.getElementById('forgot-result');
    const resetForm = document.getElementById('reset-form');

    if (openForgot) {
      openForgot.addEventListener('click', (e) => {
        e.preventDefault();
        forgotPanel.hidden = false;
        openForgot.style.display = 'none';
      });
    }
    if (closeForgot) {
      closeForgot.addEventListener('click', () => {
        forgotPanel.hidden = true;
        openForgot.style.display = '';
        forgotResult.hidden = true;
      });
    }

    if (forgotForm) {
      forgotForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const email = document.getElementById('forgot-email').value.trim().toLowerCase();

        // Enforce the same college-email rule here.
        const domainSuffix = '@' + (V().COLLEGE_EMAIL_DOMAIN || '').toLowerCase();
        if (domainSuffix.length > 1 && !email.endsWith(domainSuffix)) {
          showAlert(
            alertBox,
            'error',
            `Please enter your college email (ends with ${domainSuffix}).`
          );
          return;
        }

        const user = S().users.byEmail(email);
        if (!user) {
          showAlert(
            alertBox,
            'warning',
            'This email is not registered. If you believe this is wrong, contact an administrator.'
          );
          return;
        }

        // DEMO ONLY: the token is shown on screen.
        const token = 'reset-' + S().newId('tok');
        sessionStorage.setItem('pgmp_reset_' + token, user.id);
        document.getElementById('forgot-token-display').textContent = token;
        document.getElementById('reset-token').value = token;
        forgotResult.hidden = false;
        showAlert(
          alertBox,
          'info',
          'Demo mode: the reset token is shown on screen because no mail server is configured.'
        );
      });
    }

    if (resetForm) {
      resetForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const token = document.getElementById('reset-token').value.trim();
        const pw = document.getElementById('reset-password').value;
        const confirm = document.getElementById('reset-confirm').value;

        const userId = sessionStorage.getItem('pgmp_reset_' + token);
        if (!userId) {
          showAlert(alertBox, 'error', 'That reset token is invalid or already used.');
          return;
        }

        const problem = V().passwordProblem(pw);
        if (problem) { showAlert(alertBox, 'error', problem); return; }
        if (pw !== confirm) {
          showAlert(alertBox, 'error', 'Passwords do not match.');
          return;
        }

        S().users.update(userId, { passwordHash: S().demoHash(pw) });
        sessionStorage.removeItem('pgmp_reset_' + token);
        showAlert(alertBox, 'success', 'Password updated. You can now log in.');
        setTimeout(() => {
          forgotPanel.hidden = true;
          forgotResult.hidden = true;
          openForgot.style.display = '';
        }, 1200);
      });
    }
  }

  // ===================================================================
  // Session guard (called from app.js on protected pages)
  // ===================================================================
  function requireAuth() {
    if (!S().isLoggedIn()) {
      const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'dashboard.html');
      window.location.href = 'login.html?next=' + next;
      return null;
    }
    return S().getCurrentUser();
  }

  // ===================================================================
  // Logout
  // ===================================================================
  function logout() {
    S().clearCurrentSession();
    window.location.href = 'login.html?loggedout=1';
  }

  // ===================================================================
  // Helpers
  // ===================================================================
  function splitCSV(str) {
    return String(str || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function showAlert(box, type, message) {
    if (!box) return;
    box.className = 'alert is-' + type;
    box.textContent = message;
    box.hidden = false;
  }

  function focusFirstInvalid(errors) {
    const firstField = Object.keys(errors)[0];
    if (firstField) {
      const el = document.getElementById(firstField);
      if (el) el.focus();
    }
  }

  // ===================================================================
  // Public API
  // ===================================================================
  return {
    initRegisterPage,
    initLoginPage,
    requireAuth,
    logout,
    splitCSV,
  };
})();