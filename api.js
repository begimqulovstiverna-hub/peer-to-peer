(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  let token = null;
  let user = null;
  let ready = false;

  const request = async (path, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `API ${response.status}`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  window.EPApi = {
    get ready() {
      return ready;
    },
    get user() {
      return user;
    },
    get token() {
      return token;
    },

    async initialize() {
      if (tg) {
        try {
          tg.ready();
          tg.expand();
        } catch {}
        const initData = tg.initData || '';
        if (initData) {
          const auth = await request('/api/auth/telegram', {
            method: 'POST',
            body: JSON.stringify({ initData }),
          });
          token = auth.token;
          user = auth.user;
          ready = true;
          const data = await request('/api/state');
          return data;
        }
      }
      return null;
    },

    async saveState(state) {
      if (!token) return;
      await request('/api/state', { method: 'PUT', body: JSON.stringify(state) });
    },

    async register(profile) {
      if (!token) return null;
      return request('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
    },

    async validateModeratorKey(key) {
      if (!token) return { valid: false, error: 'Telegram Mini App orqali kiring.' };
      return request('/api/moderator/activate', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
    },

    // --- yangi API lar ---
    async addXp(amount, reason, meta) {
      if (!token) return null;
      return request('/api/xp', {
        method: 'POST',
        body: JSON.stringify({ amount, reason, meta }),
      });
    },

    async xpHistory() {
      if (!token) return { items: [] };
      return request('/api/xp/history');
    },

    async getBadges() {
      if (!token) return { items: [], defs: {} };
      return request('/api/badges');
    },

    async awardBadge(telegramId, badgeCode, note) {
      if (!token) return null;
      return request('/api/badges/award', {
        method: 'POST',
        body: JSON.stringify({ telegramId, badgeCode, note }),
      });
    },

    async getLessons(status = 'active') {
      if (!token) return { items: [] };
      return request(`/api/lessons?status=${encodeURIComponent(status)}`);
    },

    async createLesson(data) {
      if (!token) return null;
      return request('/api/lessons', { method: 'POST', body: JSON.stringify(data) });
    },

    async updateLesson(id, data) {
      if (!token) return null;
      return request(`/api/lessons/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },

    async speakerAction(lessonId, action) {
      if (!token) return null;
      return request(`/api/lessons/${lessonId}/speaker`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
    },

    async rsvp(lessonId, { cancel = false, notify = true } = {}) {
      if (!token) return null;
      return request(`/api/lessons/${lessonId}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ cancel, notify }),
      });
    },

    async saveAttendance(lessonId, records) {
      if (!token) return null;
      return request(`/api/lessons/${lessonId}/attendance`, {
        method: 'POST',
        body: JSON.stringify({ records }),
      });
    },

    async getAttendance(lessonId) {
      if (!token) return { rsvps: [], attendance: [] };
      return request(`/api/lessons/${lessonId}/attendance`);
    },

    async submitTest(payload) {
      if (!token) return null;
      return request('/api/tests/submit', { method: 'POST', body: JSON.stringify(payload) });
    },

    async addVocab(entry) {
      if (!token) return null;
      return request('/api/vocab', { method: 'POST', body: JSON.stringify(entry) });
    },

    async getVocab() {
      if (!token) return { items: [] };
      return request('/api/vocab');
    },

    async submitHomework(payload) {
      if (!token) return null;
      return request('/api/homework', { method: 'POST', body: JSON.stringify(payload) });
    },

    async getHomework() {
      if (!token) return { items: [] };
      return request('/api/homework');
    },

    async reviewHomework(id, status, comment) {
      if (!token) return null;
      return request(`/api/homework/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ status, comment }),
      });
    },

    async replyHomework(id, reply) {
      if (!token) return null;
      return request(`/api/homework/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply }),
      });
    },

    async postAnnouncement(title, body) {
      if (!token) return null;
      return request('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      });
    },

    async getAnnouncements() {
      if (!token) return { items: [] };
      return request('/api/announcements');
    },

    async postPeerFeedback(payload) {
      if (!token) return null;
      return request('/api/peer-feedback', { method: 'POST', body: JSON.stringify(payload) });
    },

    async getMeta() {
      return request('/api/meta/groups');
    },
  };
})();
