import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, RULES_VERSION } from './engine.mjs';
import { createStore, digest } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));

function validateSettlement(value) {
  if (!keysOnly(value, ['day', 'events', 'spending', 'sawNote', 'claimedBalance', 'ending']) ||
      !Number.isInteger(value.day) || value.day < 1 || value.day > 6 ||
      !Array.isArray(value.events) || value.events.length < 1 || value.events.length > 32 ||
      !Array.isArray(value.spending) || value.spending.length > 5 ||
      value.spending.some(key => typeof key !== 'string' || !['data', 'heat', 'extra', 'med', 'gpu'].includes(key)) ||
      new Set(value.spending).size !== value.spending.length ||
      typeof value.sawNote !== 'boolean' || !Number.isInteger(value.claimedBalance) ||
      value.claimedBalance < -1000 || value.claimedBalance > 10000 ||
      (value.ending !== undefined && value.ending !== 'deny')) {
    fail(400, 'invalid_settlement', '结算数据格式不正确。');
  }
  for (const event of value.events) {
    const fields = { decision: ['type', 'decision', 'exposed'], rush: ['type', 'choices'], clones: ['type', 'hits', 'passed'] };
    if (!object(event) || !Object.hasOwn(fields, event.type) || !keysOnly(event, fields[event.type])) {
      fail(400, 'invalid_event', '游戏事件格式不正确。');
    }
    if ((event.type === 'decision' && (!['approve', 'deny', 'detain'].includes(event.decision) || typeof event.exposed !== 'boolean')) ||
        (event.type === 'rush' && (!Array.isArray(event.choices) || event.choices.length !== 6 || event.choices.some(choice => ![null, 'approve', 'deny'].includes(choice)))) ||
        (event.type === 'clones' && (!Number.isInteger(event.hits) || !Number.isInteger(event.passed) || event.hits < 0 || event.passed < 0 || event.hits + event.passed !== 10))) {
      fail(400, 'invalid_event', '游戏事件格式不正确。');
    }
  }
}

// Object key order does not alter an idempotent retry. Event/selection order does.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'json_required', '请使用 JSON 请求。');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'encoding', '不接受压缩请求。');
  if (Number(req.headers['content-length']) > MAX_BODY) fail(413, 'body_too_large', '请求过大。');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) fail(413, 'body_too_large', '请求过大。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail(400, 'invalid_json', 'JSON 格式不正确。'); }
}

function createLimiter(now, maximumKeys = 10000) {
  const buckets = new Map();
  let lastSweep = 0;
  return (key, limit, duration = 60000) => {
    const t = now();
    if (t - lastSweep > 60000) {
      for (const [id, bucket] of buckets) if (bucket.until <= t) buckets.delete(id);
      lastSweep = t;
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= t) {
      if (!bucket && buckets.size >= maximumKeys) fail(429, 'rate_limit', '请求繁忙，请稍后重试。');
      bucket = { count: 0, until: t + duration };
      buckets.set(key, bucket);
    }
    if (++bucket.count > limit) fail(429, 'rate_limit', '请求过于频繁，请稍后重试。');
  };
}

export async function exchangeWechatCode(code, { appId, appSecret, fetchImpl = fetch }) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
  let response, body;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) fail(502, 'wechat_unavailable', '微信登录暂不可用。');
    const text = await response.text();
    if (text.length > 8192) fail(502, 'wechat_unavailable', '微信登录响应异常。');
    body = JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Network errors can contain the URL with its secret: never pass those through.
    fail(502, 'wechat_unavailable', '微信登录暂不可用，请稍后重试。');
  }
  if (body.errcode || typeof body.openid !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(body.openid)) {
    fail(401, 'wechat_code_invalid', '微信登录已失效，请重新登录。');
  }
  return body.openid; // session_key and unionid are intentionally discarded.
}

export function createServer(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const appId = options.appId ?? env.WECHAT_APP_ID ?? '';
  const appSecret = options.appSecret ?? env.WECHAT_APP_SECRET ?? '';
  const configured = !!appId && !!appSecret;
  const engine = createEngine(options.sourceDir ?? env.GAME_SOURCE_DIR ?? resolve(HERE, '../..'));
  const store = createStore(options.dbPath ?? env.DB_PATH ?? resolve(HERE, 'data/ranking.sqlite'), options.limits);
  const limit = createLimiter(now, options.rateLimitKeys);
  const ttlMs = Number(options.sessionTtlMs ?? Number(env.SESSION_TTL_SECONDS ?? 604800) * 1000);
  const minDayMs = Number(options.minDayMs ?? Number(env.MIN_DAY_SECONDS ?? 10) * 1000);
  if (!Number.isFinite(ttlMs) || ttlMs < 1000 || !Number.isFinite(minDayMs) || minDayMs < 0) {
    store.close(); throw new Error('Invalid session TTL or minimum day duration');
  }
  const exchangeCode = options.exchangeCode ?? (code => exchangeWechatCode(code, { appId, appSecret }));
  const rates = { ip: 120, auth: 12, player: 60, ...(options.rates || {}) };
  let authInFlight = 0;
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '60' } : {}) });
      res.end(JSON.stringify(value));
    };
    try {
      if ((req.url || '').length > 2048) fail(414, 'url_too_long', '请求地址过长。');
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        send(200, { ok: true, service: 'ip-please-ranking', wechatConfigured: configured }); return;
      }
      let ip = req.socket.remoteAddress || 'unknown';
      if (env.TRUST_PROXY === 'true' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
        const header = req.headers['x-real-ip'];
        if (typeof header === 'string' && /^[0-9a-fA-F:.]{3,64}$/.test(header)) ip = header;
      }
      limit(`ip:${ip}`, rates.ip);
      limit('requests:global', 1200);
      const authenticate = (required = true) => {
        const header = req.headers.authorization;
        if (!header && !required) return null;
        if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) fail(401, 'unauthorized', '请先使用微信登录。');
        const player = store.session(header.slice(7), now());
        if (!player) fail(401, 'session_expired', '登录已过期，请重新登录。');
        limit(`player:${player.id}`, rates.player);
        return player;
      };
      if (req.method === 'POST' && url.pathname === '/v1/auth/wechat') {
        if (!configured) fail(503, 'wechat_not_configured', '微信登录尚未配置；练习模式仍可游玩。');
        limit(`auth:${ip}`, rates.auth);
        limit('auth:global', 300);
        const body = await readBody(req);
        if (!keysOnly(body, ['code']) || typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{6,256}$/.test(body.code)) fail(400, 'invalid_code', '微信登录凭证格式不正确。');
        if (authInFlight >= 16) fail(429, 'rate_limit', '登录请求繁忙，请稍后重试。');
        let openid;
        authInFlight++;
        try { openid = await exchangeCode(body.code); }
        finally { authInFlight--; }
        if (typeof openid !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(openid)) fail(401, 'wechat_code_invalid', '微信登录凭证无效。');
        const result = store.login(digest(`${appId}:${openid}`), digest(body.code), now(), ttlMs);
        if (result.error === 'code_used') fail(401, 'code_used', '登录凭证已使用，请重新登录。');
        if (result.error) fail(503, 'capacity', '服务暂时繁忙。');
        send(200, result); return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/leaderboard') {
        const value = url.searchParams.get('limit') ?? '20';
        if (!/^\d{1,2}$/.test(value) || +value < 1 || +value > 20) fail(400, 'invalid_limit', '排行榜条数需为 1 至 20。');
        const player = authenticate(false);
        send(200, { ...store.leaderboard(+value, player?.id), metric: 'peak_settled_tokens', rulesVersion: RULES_VERSION }); return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/runs') {
        const player = authenticate();
        const body = await readBody(req);
        if (!keysOnly(body, []) || Object.keys(body).length) fail(400, 'invalid_run', '开局请求需为空对象。');
        const seed = randomBytes(24).toString('hex');
        const result = store.newRun(player.id, seed, engine.initialState(seed), RULES_VERSION, now());
        if (result.error === 'run_limit') fail(429, 'run_limit', '今日开局次数已达上限。');
        if (result.error) fail(503, 'capacity', '服务暂时繁忙。');
        send(201, result); return;
      }
      const match = /^\/v1\/runs\/([^/]+)\/settlements$/.exec(url.pathname);
      if (req.method === 'POST' && match) {
        const player = authenticate();
        if (!UUID.test(match[1])) fail(400, 'invalid_run', '对局编号不正确。');
        const body = await readBody(req);
        validateSettlement(body);
        const run = store.run(match[1]);
        if (!run) fail(404, 'run_not_found', '对局不存在或已过期。');
        if (run.player_id !== player.id) fail(403, 'run_forbidden', '无法提交其他玩家的对局。');
        const hash = digest(canonical(body));
        const previous = store.settlement(run.id, body.day);
        if (previous) {
          if (previous.payload_hash !== hash) fail(409, 'settlement_conflict', '该日已经结算，内容不能更改。');
          send(200, JSON.parse(previous.result)); return;
        }
        if (run.finished || body.day !== run.day) fail(409, 'day_conflict', '结算日期与对局进度不一致。');
        if (run.rules_version !== RULES_VERSION) fail(409, 'rules_changed', '游戏规则已更新，请重新开局。');
        // Offline days can arrive back-to-back. Their cumulative wall-clock
        // budget starts at run creation, rather than the latest upload time.
        if (now() - run.created_at < minDayMs * body.day) fail(409, 'day_too_fast', '结算过快，请稍后重试。');
        let replay;
        try { replay = engine.replay(run.seed, JSON.parse(run.state), body); }
        catch (error) {
          if (/^(note_flag_regression|too_many_events|event_order|rush_length|rush_choice|clone_count|unknown_event|decision|invalid_exposure|incomplete_day|unavailable_note|ending|balance_mismatch|spending_key|extra_requires_data|unaffordable_spending)$/.test(error.message)) {
            fail(400, error.message, '结算与实际游戏规则不一致。');
          }
          throw error;
        }
        send(200, store.settle(run, body, hash, replay, now())); return;
      }
      fail(404, 'not_found', '接口不存在。');
    } catch (error) {
      if (error instanceof ApiError) send(error.status, { error: { code: error.code, message: error.message } });
      else {
        // Never log error objects or request bodies: provider URLs may contain secrets.
        options.onInternalError?.('ranking_internal_error');
        send(500, { error: { code: 'internal_error', message: '服务暂时不可用，请稍后重试。' } });
      }
    } finally {
      // Drain rejected bodies so keep-alive connections cannot leave unread requests.
      if (!req.complete && !req.destroyed) req.resume();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 128;
  server.on('close', () => store.close());
  return server;
}

export async function start(options = {}) {
  const env = options.env ?? process.env;
  const server = createServer(options);
  const host = options.host ?? env.HOST ?? '127.0.0.1';
  const port = Number(options.port ?? env.PORT ?? 18765);
  try {
    await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.removeListener('error', reject); resolveListen(); });
    });
  } catch (error) { server.emit('close'); throw error; }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await start({ onInternalError: code => process.stderr.write(`${code}\n`) });
  process.stdout.write(`ip-please-ranking listening on ${server.address().address}:${server.address().port}\n`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
