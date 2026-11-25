(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  let token = null;
  let user = null;
  let ready = false;
  const request = async (path, options={}) => {
    const headers = {'Content-Type':'application/json', ...(options.headers||{})};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(path, {...options, headers});
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.json();
  };
  window.EPApi = {
    get ready(){ return ready; },
    async initialize(){
      if (tg) {
        try { tg.ready(); tg.expand(); } catch {}
        const initData = tg.initData || '';
        if (initData) {
          const auth = await request('/api/auth/telegram', {method:'POST', body:JSON.stringify({initData})});
          token = auth.token; user = auth.user; ready = true;
          const data = await request('/api/state');
          return data;
        }
      }
      // Outside Telegram, a demo profile remains in local storage.
      return null;
    },
    async saveState(state){
      if (!token) return;
      await request('/api/state', {method:'PUT', body:JSON.stringify(state)});
    },
    async register(profile){
      if (!token) return null;
      return request('/api/profile', {method:'PUT', body:JSON.stringify(profile)});
    },
    async validateModeratorKey(key){
      if (!token) return {valid:false,error:'Telegram Mini App orqali kiring.'};
      return request('/api/moderator/activate', {method:'POST',body:JSON.stringify({key})});
    }
  };
})();