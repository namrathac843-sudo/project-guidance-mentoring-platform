/* =====================================================================
   validators.js — Client-side form & file validation
   =====================================================================
   Mirrors the server-side rules in backend/utils.py so the user gets
   immediate feedback. It is NOT a substitute for server validation.
   ===================================================================== */

window.PGMPValidators = (function () {
  'use strict';

  // Same USN pattern used by the backend by default.
  // Change here as well if you change USN_PATTERN in .env.
  const USN_PATTERN = /^[0-9]{1}[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{3}$/i;

  // Mirrors COLLEGE_EMAIL_DOMAIN in .env.
  const COLLEGE_EMAIL_DOMAIN = 'gat.ac.in';

  const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

  const ALLOWED_EXTS = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'csv', 'xls', 'xlsx'];

  // ---------------- Basic field validators ----------------

  function isNonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isEmail(value) {
    return EMAIL_RE.test((value || '').trim());
  }

  function isUsn(value) {
    return USN_PATTERN.test((value || '').trim());
  }

  function passwordProblem(pw) {
    if (!pw || pw.length < 8) return 'Password must be at least 8 characters long.';
    if (!/[A-Za-z]/.test(pw)) return 'Password must contain at least one letter.';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
    return null;
  }

  function isFutureDate(iso) {
    if (!iso) return true;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  }

  function isUrl(value) {
    if (!value) return false;
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  // ---------------- File validation ----------------

  function fileExtension(name) {
    if (!name || name.indexOf('.') === -1) return '';
    return name.split('.').pop().toLowerCase();
  }

  function validateFile(file, maxBytes) {
    if (!file) return { ok: false, error: 'No file was selected.' };
    const ext = fileExtension(file.name);
    if (!ext) return { ok: false, error: 'The file must have an extension (for example .pdf).' };
    if (!ALLOWED_EXTS.includes(ext)) {
      return {
        ok: false,
        error: `Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXTS.join(', ')}.`,
      };
    }
    if (file.size === 0) return { ok: false, error: 'The file is empty.' };
    const cap = maxBytes || (2 * 1024 * 1024);
    if (file.size > cap) {
      const mb = (cap / (1024 * 1024)).toFixed(1);
      return { ok: false, error: `The file is too large for Local Storage. Maximum: ${mb} MB.` };
    }
    return { ok: true, error: null, extension: ext };
  }

  function humanFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  // ---------------- DOM helpers ----------------

  function setFieldError(fieldId, message) {
    const input = document.getElementById(fieldId);
    if (input) input.setAttribute('aria-invalid', 'true');
    const errorEl = document.querySelector(`[data-error-for="${fieldId}"]`);
    if (errorEl) errorEl.textContent = message || '';
  }

  function clearFieldError(fieldId) {
    const input = document.getElementById(fieldId);
    if (input) input.removeAttribute('aria-invalid');
    const errorEl = document.querySelector(`[data-error-for="${fieldId}"]`);
    if (errorEl) errorEl.textContent = '';
  }

  function clearAllErrors(formEl) {
    if (!formEl) return;
    formEl.querySelectorAll('[data-error-for]').forEach(el => { el.textContent = ''; });
    formEl.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));
  }

  // ---------------- Composite validators ----------------

  /**
   * Validate the entire registration payload.
   * Returns { ok, errors: { fieldId: message } }
   */
  function validateRegistration(data, role) {
    const errors = {};

    if (!isNonEmpty(data.fullName))            errors['reg-fullname']   = 'Full name is required.';
    if (!isNonEmpty(data.collegeName))         errors['reg-college']    = 'College name is required.';
    if (!isNonEmpty(data.department))          errors['reg-department'] = 'Department is required.';

    if (!isEmail(data.email)) {
      errors['reg-email'] = 'Please enter a valid email address.';
    } else if (role === 'student') {
      const usn = (data.usn || '').trim().toUpperCase();
      if (!isUsn(usn)) {
        errors['reg-usn'] = 'USN must look like 1GA21CS001.';
      } else {
        const expected = `${usn.toLowerCase()}@${COLLEGE_EMAIL_DOMAIN}`;
        if (data.email.trim().toLowerCase() !== expected) {
          errors['reg-email'] = `College email must be exactly "${expected}".`;
        }
      }
    }

    if (role === 'student' && !data.usn) {
      errors['reg-usn'] = 'USN is required for students.';
    }

    const pwProblem = passwordProblem(data.password);
    if (pwProblem) errors['reg-password'] = pwProblem;
    if (data.password !== data.confirmPassword) {
      errors['reg-confirm'] = 'Password and Confirm Password do not match.';
    }

    return { ok: Object.keys(errors).length === 0, errors };
  }

  // ---------------- Public API ----------------
  return {
    USN_PATTERN,
    COLLEGE_EMAIL_DOMAIN,
    ALLOWED_EXTS,

    isNonEmpty,
    isEmail,
    isUsn,
    isUrl,
    isFutureDate,
    passwordProblem,

    fileExtension,
    validateFile,
    humanFileSize,

    setFieldError,
    clearFieldError,
    clearAllErrors,

    validateRegistration,
  };
})();