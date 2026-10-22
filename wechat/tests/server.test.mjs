import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { start, exchangeWechatCode } from '../server/server.mjs';
import { createEngine, RULES_VERSION } from '../server/engine.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const engine = createEngine(ROOT);
const costs = { data: 5, heat: 3, extra: 10, med: 10, gpu: 20 };

function perfect(seed, state, spending = ['data', 'heat', 'extra']) {
  const info = engine.inspect(seed, state);
  let pay = 0, bonus = 0;
  const events = info.queue.map(item => {
    if (item.type === 'rush') { pay += info.rush.length * 2; return { type: 'rush', choices: info.rush }; }
    if (item.type === 'clones') { bonus += 10; return { type: 'clones', hits: 10, passed: 0 }; }
    if (!item.author) pay += 5;
    const exposed = item.canExpose && item.ok.includes('detain');
    if (exposed) bonus += 5;
    return { type: 'decision', decision: exposed ? 'detain' : item.ok[0], exposed };
  });
  const final = state.day === 6;
  const balance = final ? 0 : state.savings + pay + bonus - 5 - spending.reduce((sum, key) => sum + costs[key], 0);
  return { day: state.day, events, spending, sawNote: !!state.flags.sawNote || info.queue.some(item => item.note), claimedBalance: balance };
}

async function fixture(t, options = {}) {
  let clock = Date.now();
  const directory = mkdtempSync(join(tmpdir(), 'ip-please-ranking-'));
  const dbPath = join(directory, 'ranking.sqlite');
  let server;
  let base;
  const config = { sourceDir: ROOT, dbPath, host: '127.0.0.1', port: 0,
    appId: 'test-app', appSecret: 'test-private-secret', now: () => clock, minDayMs: 0,
    exchangeCode: async code => `openid_${code.split('-')[0]}`, env: {}, ...options };
  const launch = async () => {
    server = await start(config);
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const close = () => new Promise((resolveClose, reject) => { server.close(error => error ? reject(error) : resolveClose()); server.closeIdleConnections(); });
  await launch();
  t.after(async () => { if (server.listening) await close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async (path, body, token, extra = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extra.headers || {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...extra });
    return { status: response.status, data: await response.json() };
  };
  const login = async (code = 'alice-login') => {
    const response = await request('/v1/auth/wechat', { code });
    assert.equal(response.status, 200);
    return response.data;
  };
  const run = async token => {
    const response = await request('/v1/runs', {}, token);
    assert.equal(response.status, 201);
    return response.data;
  };
  return { request, login, run, dbPath, tick: (ms = 1000) => { clock += ms; },
    restart: async () => { await close(); await launch(); } };
}

test('deterministic queue and original daily wage / spending / family rules', () => {
  const first = engine.inspect('known-seed');
  assert.deepEqual(first, engine.inspect('known-seed'));
  const payload = perfect('known-seed', first.state, []);
  assert.equal(payload.claimedBalance, 25);
  const result = engine.replay('known-seed', first.state, payload);
  assert.equal(result.balance, 25);
  assert.equal(result.ledger.pay, 30);
  assert.equal(result.nextDay, 2);
  assert.equal(result.state.family.haiku.hunger, 1);
  assert.equal(result.state.family.opus.hunger, 3);
  assert.throws(() => engine.replay('known-seed', first.state, { ...payload, claimedBalance: 999 }), /balance_mismatch/);
});

test('first citation is free; later errors deduct original five-token fines', () => {
  const state = engine.initialState('citation');
  const payload = perfect('citation', state, []);
  const queue = engine.inspect('citation', state).queue;
  for (let i = 0; i < 2; i++) payload.events[i].decision = queue[i].ok.includes('approve') ? 'deny' : 'approve';
  payload.claimedBalance = 10; // Four correct * 5 - 5 electricity - 5 second citation.
  const result = engine.replay('citation', state, payload);
  assert.equal(result.ledger.cites, 2);
  assert.equal(result.ledger.fines, 5);
  assert.equal(result.balance, 10);
});

test('reject impossible detention/exposure, note forgery, queue truncation and household rows', () => {
  const state = engine.initialState('validation');
  const base = perfect('validation', state, []);
  const changed = fn => { const payload = structuredClone(base); fn(payload); return payload; };
  assert.throws(() => engine.replay('validation', state, changed(p => { p.events[0].decision = 'detain'; })), /decision/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.events[0].exposed = true; })), /invalid_exposure/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.sawNote = true; })), /unavailable_note/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.events.pop(); })), /incomplete_day/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.events.push(p.events[0]); })), /too_many_events/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.spending = ['extra']; })), /extra_requires_data/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.spending = ['gpu']; })), /spending_key/);
  assert.throws(() => engine.replay('validation', state, changed(p => { p.spending = ['data', 'heat', 'extra', 'med']; })), /spending_key/);
});

test('six-day replay handles note on day4, day5 bribe/rush/clones and final author zero', () => {
  const seed = 'six-day';
  let state = engine.initialState(seed);
  for (let day = 1; day <= 6; day++) {
    const spending = day >= 4 ? ['data', 'heat', 'extra', 'med'] : ['data', 'heat', 'extra'];
    // Medicine disappears again after day4 treatment.
    if (day >= 5) spending.splice(spending.indexOf('med'), 1);
    const payload = perfect(seed, state, spending);
    const result = engine.replay(seed, state, payload);
    assert.equal(result.ledger.fines, 0);
    if (day < 4) assert.equal(result.state.flags.sawNote, false);
    if (day === 4) { assert.equal(result.state.flags.sawNote, true); assert.equal(result.ledger.pay, 52); }
    if (day === 5) { assert.equal(result.ledger.bribe, 0); assert.ok(result.ledger.bonus >= 10); }
    if (day === 6) { assert.equal(result.balance, 0); assert.equal(result.finished, true); assert.equal(result.nextDay, null); }
    state = result.state;
  }
});

test('day5 approving the relay earns original bribe only after the day4 note', () => {
  const seed = 'bribe';
  for (const sawNote of [false, true]) {
    const state = { ...engine.initialState(seed), day: 5, savings: 100, flags: { sawNote } };
    const payload = perfect(seed, state, []);
    const relay = engine.inspect(seed, state).queue.findIndex(item => item.person === 'RELAY');
    payload.events[relay].decision = 'approve';
    payload.claimedBalance += (sawNote ? 20 : 0) - 5;
    const result = engine.replay(seed, state, payload);
    assert.equal(result.ledger.bribe, sawNote ? 20 : 0);
    assert.equal(result.ledger.cites, 1);
  }
});

test('rush and clone rewards are bounded, with one citation per failed event', () => {
  const seed = 'events';
  const day4 = { ...engine.initialState(seed), day: 4, savings: 100 };
  const rushPayload = perfect(seed, day4, []);
  const rush = rushPayload.events.find(event => event.type === 'rush');
  const hits = rush.choices.filter(choice => choice === 'approve').length;
  rush.choices = ['approve', 'approve', 'approve', 'approve', 'approve', null];
  // Only the two original approve answers remain correct.
  rushPayload.claimedBalance -= 8;
  const rushResult = engine.replay(seed, day4, rushPayload);
  assert.equal(hits, 2);
  assert.equal(rushResult.ledger.cites, 1);
  assert.equal(rushResult.ledger.fines, 0);
  rush.choices.push('approve');
  assert.throws(() => engine.replay(seed, day4, rushPayload), /rush_length/);
  const day5 = { ...engine.initialState(seed), day: 5, savings: 100 };
  const clonePayload = perfect(seed, day5, []);
  const clones = clonePayload.events.find(event => event.type === 'clones');
  clones.hits = 7; clones.passed = 3; clonePayload.claimedBalance -= 3;
  assert.equal(engine.replay(seed, day5, clonePayload).ledger.cites, 1);
  clones.hits = 11;
  assert.throws(() => engine.replay(seed, day5, clonePayload), /clone_count/);
});

test('day6 Jorji denial requeues once; denying author preserves prior settled savings', () => {
  const seed = 'ending';
  const state = { ...engine.initialState(seed), day: 6, savings: 100 };
  const payload = perfect(seed, state, []);
  payload.events[0].decision = 'deny';
  payload.events.splice(1, 0, { type: 'decision', decision: 'deny', exposed: false });
  payload.events.at(-1).decision = 'deny';
  payload.ending = 'deny';
  payload.claimedBalance = 100;
  const result = engine.replay(seed, state, payload);
  assert.equal(result.settled, false);
  assert.equal(result.balance, 100);
  assert.equal(result.ledger.cites, 2);
  assert.equal(result.ledger.fines, 5);
  assert.equal(result.ledger.total, 6);
  payload.events.splice(1, 1);
  payload.events.forEach(event => { if (event.type === 'decision') event.exposed = false; });
  assert.throws(() => engine.replay(seed, state, payload), /incomplete_day/);
});

test('missing WeChat credentials fails closed; no public test identity or score API', async t => {
  const f = await fixture(t, { appSecret: '' });
  assert.deepEqual((await f.request('/healthz')).data, { ok: true, service: 'ip-please-ranking', wechatConfigured: false });
  assert.equal((await f.request('/v1/auth/wechat', { code: 'alice-login' })).status, 503);
  assert.equal((await f.request('/v1/auth/dev', { openid: 'other-player' })).status, 404);
  assert.equal((await f.request('/v1/scores', { score: 999999 })).status, 404);
  assert.equal((await f.request('/v1/leaderboard')).status, 200);
  assert.equal((await f.request('/v1/runs', {})).status, 401);
});

test('login uses real exchange boundary, stable anonymous identity and hashed tokens', async t => {
  const f = await fixture(t);
  const a = await f.login();
  const again = await f.login('alice-again');
  assert.deepEqual(a.player, again.player);
  assert.notEqual(a.token, again.token);
  assert.equal(a.token.length, 43);
  assert.equal((await f.request('/v1/auth/wechat', { code: 'alice-login' })).status, 401);
  assert.equal((await f.request('/v1/auth/wechat', { code: 'alice-next', openid: 'forged' })).status, 400);
  const db = new DatabaseSync(f.dbPath, { readOnly: true });
  const raw = db.prepare('SELECT * FROM sessions').all();
  assert.ok(raw.every(row => row.token_hash.length === 64 && row.token_hash !== a.token));
  assert.equal(db.prepare('SELECT identity_hash FROM players').get().identity_hash.length, 64);
  db.close();
  assert.ok(!readFileSync(f.dbPath).includes(Buffer.from('openid_alice')));
});

test('HTTP settlements reject forged scores, foreign owners, day skips and duplicate changes', async t => {
  const f = await fixture(t);
  const alice = await f.login();
  const bob = await f.login('bob-login');
  const run = await f.run(alice.token);
  const path = `/v1/runs/${run.runId}/settlements`;
  const payload = perfect(run.seed, run.state, []);
  assert.equal(run.rulesVersion, RULES_VERSION);
  assert.equal((await f.request(path, payload, bob.token)).status, 403);
  assert.equal((await f.request(path, { ...payload, day: 2 }, alice.token)).status, 409);
  assert.equal((await f.request(path, { ...payload, claimedBalance: 999 }, alice.token)).status, 400);
  const accepted = await f.request(path, payload, alice.token);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.balance, 25);
  assert.equal(accepted.data.best.score, 25);
  assert.deepEqual(await f.request(path, payload, alice.token), accepted);
  const reorderedKeys = Object.fromEntries(Object.entries(payload).reverse());
  assert.deepEqual(await f.request(path, reorderedKeys, alice.token), accepted);
  assert.equal((await f.request(path, { ...payload, claimedBalance: 24 }, alice.token)).status, 409);
});

test('ranking ties favor earlier achievement, own-rank and immutable personal best survive restart', async t => {
  const f = await fixture(t);
  const alice = await f.login();
  const bob = await f.login('bob-login');
  const aRun = await f.run(alice.token);
  await f.request(`/v1/runs/${aRun.runId}/settlements`, perfect(aRun.seed, aRun.state, []), alice.token);
  f.tick();
  const bRun = await f.run(bob.token);
  await f.request(`/v1/runs/${bRun.runId}/settlements`, perfect(bRun.seed, bRun.state, []), bob.token);
  const board = (await f.request('/v1/leaderboard?limit=1', undefined, bob.token)).data;
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0].playerId, alice.player.id);
  assert.equal(board.me.rank, 2);
  const lowerRun = await f.run(alice.token);
  await f.request(`/v1/runs/${lowerRun.runId}/settlements`, perfect(lowerRun.seed, lowerRun.state), alice.token);
  assert.equal((await f.request('/v1/leaderboard', undefined, alice.token)).data.me.score, 25);
  await f.restart();
  const restored = (await f.request('/v1/leaderboard', undefined, alice.token)).data;
  assert.equal(restored.entries.length, 2);
  assert.equal(restored.me.rank, 1);
  const payload = perfect(aRun.seed, aRun.state, []);
  assert.equal((await f.request(`/v1/runs/${aRun.runId}/settlements`, payload, alice.token)).status, 200);
});

test('API bounds body sizes, content type, arrays, limits, rate and expired sessions', async t => {
  const f = await fixture(t, { sessionTtlMs: 1000, rates: { auth: 3, player: 20, ip: 30 } });
  const alice = await f.login();
  const run = await f.run(alice.token);
  const payload = perfect(run.seed, run.state, []);
  assert.equal((await f.request('/v1/leaderboard?limit=21')).status, 400);
  assert.equal((await f.request('/v1/leaderboard?limit=NaN')).status, 400);
  assert.equal((await f.request('/v1/runs', { score: 1 }, alice.token)).status, 400);
  assert.equal((await f.request(`/v1/runs/${run.runId}/settlements`, { ...payload, events: Array(33).fill(payload.events[0]) }, alice.token)).status, 400);
  assert.equal((await f.request('/v1/runs', {}, alice.token, { headers: { 'content-type': 'text/plain', authorization: `Bearer ${alice.token}` } })).status, 415);
  assert.equal((await f.request('/v1/auth/wechat', { code: 'x'.repeat(66000) })).status, 413);
  f.tick(1001);
  assert.equal((await f.request('/v1/runs', {}, alice.token)).status, 401);
  await f.login('bob-login');
  assert.equal((await f.request('/v1/auth/wechat', { code: 'carol-login' })).status, 429);
});

test('minimum day time and persistent run creation limits are enforced', async t => {
  const f = await fixture(t, { minDayMs: 10000, rates: { player: 100, ip: 200 } });
  const alice = await f.login();
  const run = await f.run(alice.token);
  const payload = perfect(run.seed, run.state, []);
  assert.equal((await f.request(`/v1/runs/${run.runId}/settlements`, payload, alice.token)).data.error.code, 'day_too_fast');
  f.tick(10000);
  assert.equal((await f.request(`/v1/runs/${run.runId}/settlements`, payload, alice.token)).status, 200);
  for (let i = 1; i < 30; i++) await f.run(alice.token);
  assert.equal((await f.request('/v1/runs', {}, alice.token)).status, 429);
});

test('buffered offline days upload consecutively after cumulative minimum play time', async t => {
  const f = await fixture(t, { minDayMs: 10000 });
  const alice = await f.login();
  const run = await f.run(alice.token);
  const path = `/v1/runs/${run.runId}/settlements`;
  const day1 = perfect(run.seed, run.state);
  const nextState = engine.replay(run.seed, run.state, day1).state;
  const day2 = perfect(run.seed, nextState);
  f.tick(10000);
  // Sequential progress remains mandatory even when enough time has elapsed.
  assert.equal((await f.request(path, day2, alice.token)).data.error.code, 'day_conflict');
  assert.equal((await f.request(path, day1, alice.token)).status, 200);
  // One day's elapsed time is still insufficient for a second settlement.
  assert.equal((await f.request(path, day2, alice.token)).data.error.code, 'day_too_fast');
  f.tick(10000);
  assert.equal((await f.request(path, day2, alice.token)).status, 200);

  const offlineRun = await f.run(alice.token);
  const offlinePath = `/v1/runs/${offlineRun.runId}/settlements`;
  const buffered1 = perfect(offlineRun.seed, offlineRun.state);
  const buffered2 = perfect(offlineRun.seed, engine.replay(offlineRun.seed, offlineRun.state, buffered1).state);
  f.tick(20000);
  assert.equal((await f.request(offlinePath, buffered1, alice.token)).status, 200);
  // No clock tick between these two uploads: both were played while offline.
  assert.equal((await f.request(offlinePath, buffered2, alice.token)).status, 200);
});

test('provider exchange sends official grant and never exposes provider secret or session key', async () => {
  let requested;
  const openid = await exchangeWechatCode('sample-code', { appId: 'sample-app', appSecret: 'private-secret', fetchImpl: async url => {
    requested = url;
    return { ok: true, text: async () => JSON.stringify({ openid: 'openid_player', session_key: 'must-discard' }) };
  } });
  assert.equal(requested.origin, 'https://api.weixin.qq.com');
  assert.equal(requested.searchParams.get('grant_type'), 'authorization_code');
  assert.equal(openid, 'openid_player');
  await assert.rejects(exchangeWechatCode('sample-code', { appId: 'app', appSecret: 'private-secret', fetchImpl: async url => { throw new Error(String(url)); } }), error => !String(error).includes('private-secret') && error.code === 'wechat_unavailable');
  await assert.rejects(exchangeWechatCode('sample-code', { appId: 'app', appSecret: 'secret', fetchImpl: async () => ({ ok: true, text: async () => '{"errcode":40029,"errmsg":"invalid code"}' }) }), error => error.status === 401);
});
