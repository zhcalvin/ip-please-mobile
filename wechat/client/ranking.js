'use strict';

const KEY = 'ip-please-wechat-ranking-v1';
const clone = (value) => JSON.parse(JSON.stringify(value));

function createRanking(wx, config, changed = () => {}) {
  let stored;
  try { stored = wx.getStorageSync(KEY); if (typeof stored === 'string') stored = JSON.parse(stored); } catch (e) { /* damaged local cache */ }
  const data = stored && stored.version === 1 ? stored : { version: 1, session: null, run: null, pending: [] };
  if (!Array.isArray(data.pending)) data.pending = [];
  let active = null, loginJob = null, flushJob = null;
  const state = { entries: [], me: null, loading: false, status: '练习模式 · 不计入排行', error: '', lastUpdated: null };
  const persist = () => { try { wx.setStorageSync(KEY, clone(data)); } catch (e) { state.error = '存储空间不足，退出后可能无法恢复排行进度'; } changed(); };
  function request(path, method = 'GET', body, authenticated = false) {
    return new Promise((resolve, reject) => {
      wx.request({ url: config.apiBase.replace(/\/+$/, '') + path, method, data: body, timeout: 10000,
        header: { 'content-type': 'application/json', ...(authenticated && data.session ? { Authorization: `Bearer ${data.session.token}` } : {}) },
        success(res) {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
          else {
            const detail = res.data && res.data.error;
            const error = new Error(detail && detail.message || `服务暂不可用 (${res.statusCode})`);
            error.status = res.statusCode; error.code = detail && detail.code;
            reject(error);
          }
        }, fail() { reject(new Error('网络不可用，请稍后重试')); },
      });
    });
  }
  async function authenticate(force = false) {
    if (!force && data.session && new Date(data.session.expiresAt).getTime() > Date.now() + 60000) return data.session;
    if (loginJob) return loginJob;
    loginJob = (async () => {
      const code = await new Promise((resolve, reject) => wx.login({ timeout: 10000, success: (res) => res.code ? resolve(res.code) : reject(new Error('微信登录失败')), fail: () => reject(new Error('微信登录暂不可用')) }));
      const session = await request('/v1/auth/wechat', 'POST', { code });
      if (!session.token || !session.player || !session.player.id || !session.expiresAt) throw new Error('登录服务返回无效数据');
      data.session = session; persist(); return session;
    })().finally(() => { loginJob = null; });
    return loginJob;
  }
  async function authorized(path, method, body) {
    await authenticate();
    try { return await request(path, method, body, true); }
    catch (e) { if (e.status !== 401) throw e; await authenticate(true); return request(path, method, body, true); }
  }
  async function flush() {
    if (flushJob) return flushJob;
    flushJob = (async () => {
      for (const item of data.pending.filter((it) => !it.rejected)) {
        try {
          const session = await authenticate();
          if (session.player.id !== item.playerId) { item.rejected = '微信账号已变化，原账号成绩未上传'; persist(); continue; }
          const result = await authorized(`/v1/runs/${encodeURIComponent(item.runId)}/settlements`, 'POST', item.payload);
          if (!result.accepted) throw new Error('成绩尚未被确认');
          data.pending = data.pending.filter((it) => it !== item);
          state.status = `已验证结余 ${result.balance} token`;
          state.error = '';
          persist();
        } catch (error) {
          if (error.status === 409 && error.code === 'day_too_fast') {
            state.error = error.message; state.status = '成绩已保存在本机，稍后可重试提交';
            changed(); break;
          }
          if (error.status === 400 || error.status === 403 || error.status === 409 || error.status === 404) {
            item.rejected = error.message;
            if (active && active.runId === item.runId) active = null;
            if (data.run && data.run.runId === item.runId) data.run.invalid = true;
            state.error = '本局校验未通过，继续练习；请从头开始参加排行';
            persist();
            continue;
          }
          state.error = error.message; state.status = '成绩已保存在本机，联网后自动补交'; changed(); break;
        }
      }
    })().finally(() => { flushJob = null; });
    return flushJob;
  }
  return {
    state, get active() { return active; }, get pendingCount() { return data.pending.filter((it) => !it.rejected).length; },
    async start() {
      active = null;
      try {
        await flush();
        const session = await authenticate();
        const run = await authorized('/v1/runs', 'POST', {});
        if (!run.runId || !run.seed || !run.rulesVersion || run.day !== 1) throw new Error('对局服务返回无效数据');
        active = { runId: run.runId, seed: run.seed, rulesVersion: run.rulesVersion, playerId: session.player.id, nextDay: 1, save: null, finished: false };
        data.run = active; state.status = '全国排行挑战 · 每日结算自动提交'; state.error = ''; persist(); return true;
      } catch (error) { data.run = null; state.status = '练习模式 · 不计入排行'; state.error = `${error.message}，本次可离线游玩`; persist(); return false; }
    },
    resume(save) {
      const run = data.run;
      // Only the exact day-boundary save produced by this owned run can resume.
      if (run && !run.finished && !run.invalid && run.save === JSON.stringify(save) && run.nextDay === save.day && data.session && run.playerId === data.session.player.id) {
        active = run; state.status = '全国排行挑战 · 每日结算自动提交'; void flush(); changed(); return true;
      }
      active = null; state.status = '练习存档 · 从头开始可参加全国排行'; changed(); return false;
    },
    practice() { active = null; state.status = '练习模式 · 不计入排行'; changed(); },
    settle(payload, nextSave, finished) {
      if (!active || active.finished || active.nextDay !== payload.day) return false;
      const item = { runId: active.runId, playerId: active.playerId, payload: clone(payload) };
      if (data.pending.some((it) => it.runId === item.runId && it.payload.day === payload.day)) return false;
      data.pending.push(item);
      active.nextDay = payload.day + 1; active.finished = !!finished;
      active.save = nextSave ? JSON.stringify(nextSave) : null;
      data.run = active; state.status = '成绩已保存在本机，正在验证'; persist(); void flush(); return true;
    },
    async refresh() {
      if (state.loading) return;
      state.loading = true; state.error = ''; changed();
      try {
        // Show public results before any wx.login request can time out.
        let board;
        try { board = await request('/v1/leaderboard?limit=20', 'GET', undefined, !!data.session); }
        catch (e) { if (e.status !== 401) throw e; board = await request('/v1/leaderboard?limit=20'); }
        state.entries = Array.isArray(board.entries) ? board.entries.slice(0, 20) : [];
        state.me = board.me || null; state.lastUpdated = Date.now();
        changed();
        // Enrich personal rank in the background; unavailable credentials never
        // hold the public board behind the authentication timeout.
        void (async () => {
          try {
            await authenticate(); await flush();
            const mine = await request('/v1/leaderboard?limit=20', 'GET', undefined, true);
            state.entries = Array.isArray(mine.entries) ? mine.entries.slice(0, 20) : state.entries;
            state.me = mine.me || null; changed();
          } catch (e) { /* Public leaderboard remains available anonymously. */ }
        })();
      } catch (error) { state.error = error.message; }
      finally { state.loading = false; changed(); }
    },
    flush,
  };
}

module.exports = { createRanking, KEY };
