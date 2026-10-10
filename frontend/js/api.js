/* =====================================================================
   api.js — Thin wrapper around fetch() for the Flask REST API
   =====================================================================
   The frontend uses Local Storage as its primary store, so this module
   is optional at runtime. It exists so that:
     * the REST endpoints in backend/*.py can be demonstrated from the UI
     * future versions can move data server-side without rewriting the
       frontend

   Every method returns a normalised result:
     { ok: true,  status: 200, data: {...} }
     { ok: false, status: 4xx, error: 'message' }
   ===================================================================== */

window.PGMPApi = (function () {
  'use strict';

  const BASE = ''; // same-origin — Flask serves both the API and the UI

  function token() {
    const s = window.PGMPStorage ? window.PGMPStorage.getCurrentSession() : null;
    return s && s.token ? s.token : null;
  }

  async function request(method, path, options) {
    const opts = options || {};
    const headers = Object.assign(
      { 'Accept': 'application/json' },
      opts.headers || {}
    );

    let body = opts.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const t = token();
    if (t) headers['Authorization'] = `Bearer ${t}`;

    let response;
    try {
      response = await fetch(BASE + path, {
        method,
        headers,
        body,
        credentials: 'omit',
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        error: 'The Flask backend is not reachable. ' +
               'The Local Storage demo continues to work without it.',
        networkError: true,
      };
    }

    // 204 No Content
    if (response.status === 204) {
      return { ok: true, status: 204, data: null };
    }

    let payload = null;
    const ct = response.headers.get('Content-Type') || '';
    try {
      if (ct.includes('application/json')) {
        payload = await response.json();
      } else {
        payload = await response.text();
      }
    } catch (err) {
      payload = null;
    }

    if (!response.ok) {
      const message =
        (payload && payload.error) ||
        (typeof payload === 'string' && payload) ||
        `Request failed with status ${response.status}.`;
      return { ok: false, status: response.status, error: message, data: payload };
    }

    // Our Flask API returns { success: true, data: {...} }.
    return {
      ok: true,
      status: response.status,
      data: payload && payload.data !== undefined ? payload.data : payload,
    };
  }

  return {
    get:    (path)        => request('GET',    path),
    post:   (path, body)  => request('POST',   path, { body }),
    put:    (path, body)  => request('PUT',    path, { body }),
    del:    (path)        => request('DELETE', path),
    upload: (path, formData) => request('POST', path, { body: formData }),

    // ---- Convenience wrappers around the Flask routes ----
    health:            ()           => request('GET', '/api/health'),
    login:             (email, pw)  => request('POST', '/api/auth/login',    { body: { email, password: pw } }),
    register:          (payload)    => request('POST', '/api/auth/register', { body: payload }),
    logout:            ()           => request('POST', '/api/auth/logout'),
    me:                ()           => request('GET',  '/api/auth/me'),

    listProjects:      ()           => request('GET', '/api/projects'),
    createProject:     (p)          => request('POST', '/api/projects', { body: p }),
    reviewProject:     (id, body)   => request('POST', `/api/projects/${id}/review`, { body }),

    listMentors:       ()           => request('GET',  '/api/mentors'),
    createRequest:     (body)       => request('POST', '/api/mentoring-requests', { body }),
    updateRequest:     (id, body)   => request('PUT',  `/api/mentoring-requests/${id}`, { body }),

    listSessions:      ()           => request('GET',  '/api/sessions'),
    createSession:     (body)       => request('POST', '/api/sessions', { body }),
    updateSession:     (id, body)   => request('PUT',  `/api/sessions/${id}`, { body }),

    listConversations: ()           => request('GET',  '/api/messages/conversations'),
    listContacts:      ()           => request('GET',  '/api/messages/contacts'),
    thread:            (id)         => request('GET',  `/api/messages/${id}`),
    sendMessage:       (body)       => request('POST', '/api/messages', { body }),

    listNotifications: ()           => request('GET',  '/api/notifications'),
    unreadCount:       ()           => request('GET',  '/api/notifications/unread-count'),
    markAllRead:       ()           => request('PUT',  '/api/notifications/read-all'),
  };
})();