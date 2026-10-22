import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../server/engine.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { createRanking, KEY } = require('../client/ranking.js');
const { createPlatform } = require('../client/platform.js');
const { createUI } = require('../client/ui.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const read = (value) => JSON.parse(JSON.stringify(value));

function mockWx(storage = new Map(), handler) {
  const callbacks = {}, requests = [], canvases = [], frames = new Map(), texts = [];
  let frameId = 0;
  const wx = {
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: (key) => storage.delete(key),
    getWindowInfo: () => ({ windowWidth: 800, windowHeight: 450, pixelRatio: 2, safeArea: { left: 20, top: 0, right: 780, bottom: 450 } }),
    getAppBaseInfo: () => ({ language: 'zh-CN' }),
    createCanvas() {
      const context = new Proxy({ fillText: (...args) => texts.push(args), measureText: (s) => ({ width: s.length * 7 }) }, { get: (target, key) => key in target ? target[key] : () => {} });
      const canvas = { width: 640, height: 360, getContext: () => context };
      canvases.push(canvas); return canvas;
    },
    createImage() { return { set src(value) { queueMicrotask(() => this.onload && this.onload()); } }; },
    login: ({ success }) => success({ code: 'real-wx-code' }),
    request(options) {
      requests.push(options);
      const response = handler ? handler(options) : defaultHandler(options);
      if (response === null) options.fail({ errMsg: 'offline' });
      else options.success({ statusCode: 200, data: response });
    },
    showToast() {},
  };
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize', 'AudioInterruptionBegin', 'AudioInterruptionEnd']) wx[`on${name}`] = (callback) => { (callbacks[name] ||= []).push(callback); };
  return { wx, callbacks, requests, canvases, storage, texts,
    emit: (name, value) => (callbacks[name] || []).forEach((fn) => fn(value)),
    host: { requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: (id) => frames.delete(id) },
    frame(ts) { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(ts)); },
    get frames() { return frames.size; },
  };
}
function defaultHandler(options) {
  if (options.url.endsWith('/auth/wechat')) return { token: 'test-session', player: { id: 'player-1', name: '审查员001' }, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  if (options.url.endsWith('/v1/runs')) return { runId: 'run-1', seed: 'server-random-seed', rulesVersion: 'test-v1', day: 1 };
  if (options.url.includes('/settlements')) return { accepted: true, day: options.data.day, balance: options.data.claimedBalance, best: options.data.claimedBalance };
  return { entries: [], me: null };
}
const config = { apiBase: 'https://api.example.test/' };

test('authenticates with wx.login before creating ranked run; API URLs are rooted', async () => {
  const mock = mockWx(), ranking = createRanking(mock.wx, config);
  assert.equal(await ranking.start(), true);
  assert.equal(ranking.active.seed, 'server-random-seed');
  assert.equal(mock.requests[0].data.code, 'real-wx-code');
  assert.equal(mock.requests[1].url, 'https://api.example.test/v1/runs');
  assert.equal(mock.requests[1].header.Authorization, 'Bearer test-session');
});

test('offline play cannot create a ranked run and public board works without auth', async () => {
  const mock = mockWx(new Map(), (options) => options.url.includes('leaderboard') ? { entries: [{ rank: 1, score: 40 }], me: null } : null);
  const ranking = createRanking(mock.wx, config);
  assert.equal(await ranking.start(), false); assert.equal(ranking.active, null);
  await ranking.refresh(); assert.equal(ranking.state.entries[0].score, 40);
  const board = mock.requests.find((it) => it.url.includes('leaderboard'));
  assert.equal(board.header.Authorization, undefined);
});

test('a hanging wx.login never delays public top 20', async () => {
  const mock = mockWx(new Map(), () => ({ entries: [{ rank: 1, score: 32 }], me: null }));
  mock.wx.login = () => {};
  const ranking = createRanking(mock.wx, config);
  await ranking.refresh();
  assert.equal(ranking.state.loading, false); assert.equal(ranking.state.entries[0].score, 32);
});

test('expired bearer falls back to public leaderboard while reauthentication is pending', async () => {
  const mock = mockWx();
  const ranking = createRanking(mock.wx, config); await ranking.start();
  mock.wx.login = () => {};
  mock.wx.request = (options) => options.header.Authorization
    ? options.success({ statusCode: 401, data: { error: { message: 'Expired' } } })
    : options.success({ statusCode: 200, data: { entries: [{ rank: 1, score: 33 }] } });
  await ranking.refresh(); assert.equal(ranking.state.entries[0].score, 33);
});

test('persists failed settlements, resumes only exact owned day save, retries idempotently', async () => {
  let offline = false;
  const mock = mockWx(new Map(), (options) => offline && options.url.includes('settlements') ? null : defaultHandler(options));
  const ranking = createRanking(mock.wx, config);
  await ranking.start(); offline = true;
  const save = { day: 2, savings: 12, family: {} }, payload = { day: 1, events: [{ type: 'decision', decision: 'approve', exposed: false }], spending: ['data'], sawNote: false, claimedBalance: 12 };
  assert.equal(ranking.settle(payload, save, false), true);
  assert.equal(ranking.settle(payload, save, false), false);
  await ranking.flush(); assert.equal(ranking.pendingCount, 1);
  const restored = createRanking(mock.wx, config);
  assert.equal(restored.resume({ ...save, savings: 99 }), false);
  assert.equal(restored.resume(save), true);
  offline = false; await restored.flush(); assert.equal(restored.pendingCount, 0);
  const sent = mock.requests.filter((it) => it.url.includes('settlements'));
  assert.deepEqual(sent.at(-1).data, payload);
  assert.equal(mock.storage.get(KEY).run.save, JSON.stringify(save));
});

test('a server-rejected transcript invalidates ranked continuation and remains practice', async () => {
  const mock = mockWx(); const original = mock.wx.request;
  mock.wx.request = (options) => options.url.includes('settlements') ? options.success({ statusCode: 409, data: { error: { message: 'Sequence mismatch' } } }) : original(options);
  const ranking = createRanking(mock.wx, config); await ranking.start();
  const save = { day: 2, savings: 1 };
  ranking.settle({ day: 1, events: [], spending: [], sawNote: false, claimedBalance: 1 }, save, false);
  await ranking.flush();
  assert.equal(ranking.active, null); assert.equal(ranking.resume(save), false);
  assert.equal(mock.storage.get(KEY).pending[0].rejected, 'Sequence mismatch');
});

test('temporary day_too_fast rejection retains owned run and pending payload until a later retry', async () => {
  const mock = mockWx(), original = mock.wx.request;
  let permitted = false, attempts = 0;
  mock.wx.request = (options) => {
    if (!options.url.includes('settlements')) return original(options);
    attempts++;
    if (!permitted) options.success({ statusCode: 409, data: { error: { code: 'day_too_fast', message: '结算过快，请稍后重试。' } } });
    else original(options);
  };
  const ranking = createRanking(mock.wx, config); await ranking.start();
  const save = { day: 2, savings: 7 };
  const payload = { day: 1, events: [], spending: ['data', 'heat'], sawNote: false, claimedBalance: 7 };
  ranking.settle(payload, save, false); await ranking.flush(); await tick();
  assert.equal(attempts, 1, 'no automatic retry loop on temporary rejection');
  assert.equal(ranking.pendingCount, 1); assert.equal(ranking.active.runId, 'run-1');
  assert.equal(mock.storage.get(KEY).run.invalid, undefined);
  assert.equal(mock.storage.get(KEY).pending[0].rejected, undefined);
  assert.deepEqual(mock.storage.get(KEY).pending[0].payload, payload);
  const restored = createRanking(mock.wx, config);
  assert.equal(restored.resume(save), true, 'temporary timing restriction preserves ranked resume');
  await restored.flush(); permitted = true; await restored.flush();
  assert.equal(restored.pendingCount, 0); assert.equal(restored.active.runId, 'run-1');
  assert.equal(mock.storage.get(KEY).run.invalid, undefined);
});

test('WeChat native screen, touch coordinates, storage and background are adapted', () => {
  const mock = mockWx(), platform = createPlatform(mock.wx, mock.host);
  assert.equal(platform.display, mock.canvases[0]); assert.equal(platform.game, mock.canvases[1]);
  platform.localStorage.setItem('save', '{"day":2}'); assert.equal(platform.localStorage.getItem('save'), '{"day":2}');
  let point, visibility;
  platform.game.addEventListener('pointerdown', (ev) => { point = platform.point(ev); });
  platform.document.addEventListener('visibilitychange', () => { visibility = platform.document.hidden; });
  mock.emit('TouchStart', { changedTouches: [{ identifier: 1, clientX: 400, clientY: 225 }] });
  assert.deepEqual(point, [320, 180]);
  mock.emit('Hide'); assert.equal(visibility, true); mock.emit('Show'); assert.equal(visibility, false);
});

test('WebAudio adapter normalizes native void connect and sync lifecycle, preserving PCM', async () => {
  const mock = mockWx(); let pcmOffset = null, assigned = null;
  const nativeBuffer = { copyToChannel: (samples, ch, offset) => { pcmOffset = offset; } };
  const nativeNode = () => ({ gain: { value: 1 }, connect() {}, start() {}, stop() {}, set buffer(value) { assigned = value; } });
  mock.wx.createWebAudioContext = () => ({ state: 'running', currentTime: 0, destination: {}, createGain: nativeNode, createBufferSource: nativeNode, createBuffer: () => nativeBuffer, suspend() {}, resume() {} });
  const ac = new (createPlatform(mock.wx, mock.host).window.AudioContext)();
  const source = ac.createBufferSource(), gain = ac.createGain();
  source.connect(gain).connect(ac.createDynamicsCompressor()).connect(ac.destination);
  const buffer = ac.createBuffer(1, 10, 44100); buffer.copyToChannel(new Float32Array(10), 0); source.buffer = buffer;
  assert.equal(pcmOffset, 0); assert.equal(assigned, nativeBuffer);
  await ac.suspend(); await ac.resume();
});

test('leaderboard displays top 20 with pagination and my best while pausing gameplay', async () => {
  const mock = mockWx(), platform = createPlatform(mock.wx, mock.host);
  const ranking = createRanking(mock.wx, config);
  ranking.state.entries = Array.from({ length: 20 }, (_, i) => ({ rank: i + 1, name: `PLAYER-${i + 1}`, playerId: `p${i}`, score: 100 - i, day: 5 }));
  ranking.state.me = { rank: 55, score: 12, day: 4 };
  ranking.refresh = async () => {};
  let paused;
  const ui = createUI(platform, ranking, { scene: () => 'summary', pause: (value) => { paused = value; }, muted: () => false, toggleMute() {} });
  ui.show(); assert.equal(paused, true);
  assert.ok(mock.texts.some(([s]) => s.includes('第 55 名')));
  // 640 logical x 360 => layout left20/top11.25, scale1.1875.
  mock.emit('TouchStart', { changedTouches: [{ identifier: 1, clientX: 20 + 560 * 1.1875, clientY: 11.25 + 320 * 1.1875 }] });
  assert.ok(mock.texts.some(([s]) => s === 'PLAYER-20'));
});

let built = false;
function loadGame(mock) {
  if (!built) { execFileSync(process.execPath, ['wechat/tools/build.mjs'], { cwd: root }); built = true; }
  const filename = path.join(root, 'wechat/minigame/generated/game-bundle.js');
  // Test-only access added in memory. The distributable does not expose gameplay setters.
  const source = fs.readFileSync(filename, 'utf8').replace('return { ranking, ui: wechatUI, platform,', `return { test: {
    get S() { return S; }, get B() { return B; }, get SUM() { return SUM; },
    get now() { return now; }, set now(value) { now = value; }, get sceneT0() { return sceneT0; },
    go, chooseLang, buildQueue, startDay, newEntrant, finish, summaryClick, startRush, rushPick, rushEnd, updateClones, startClones, runTimers,
    setScene(value) { scene = value; }, setDay(value) { S.day = value; },
    forceTime(value) { now = value; }, constants: { CONTINUE_BTN, RUSH }, titleClick,
  }, ranking, ui: wechatUI, platform,`);
  const context = { module: { exports: {} }, require: createRequire(filename), console, setTimeout: () => 0, clearTimeout() {}, URLSearchParams, Promise, Math: Object.create(Math), Intl, Date };
  vm.runInNewContext(source, context, { filename });
  return context.module.exports(mock.wx, config, mock.host);
}

test('generated game boots without DOM/WebView and retains deterministic six-day gameplay', async () => {
  const mock = mockWx(), runtime = loadGame(mock); await tick();
  assert.equal(runtime.getScene(), 'boot'); assert.ok(mock.frames > 0);
  runtime.test.chooseLang('zh'); runtime.test.go('title'); runtime.test.forceTime(3);
  runtime.test.titleClick(320, 300);
  assert.equal(runtime.getScene(), 'title'); // Await server run before starting.
  await tick(); assert.equal(runtime.getScene(), 'daycard'); assert.ok(runtime.ranking.active);
  for (let day = 1; day <= 6; day++) {
    const first = runtime.test.buildQueue(day), second = runtime.test.buildQueue(day);
    assert.ok(first.length >= 5); assert.deepEqual(read(first), read(second));
  }
  runtime.test.go('booth'); mock.frame(0); mock.frame(17);
  assert.equal(runtime.test.B.queue.length, 6);
  mock.emit('Hide'); assert.equal(mock.frames, 0); mock.emit('Show'); assert.ok(mock.frames > 0);
  // All original assets are local files rather than unsupported data URLs.
  const generated = fs.readFileSync(path.join(root, 'wechat/minigame/generated/game-bundle.js'), 'utf8');
  assert.ok(!generated.includes('data:image/png;base64,'));
  for (const name of ['LICENSE', 'OFL-fusion-pixel.txt']) {
    assert.equal(fs.readFileSync(path.join(root, 'wechat/minigame/generated', name), 'utf8'), fs.readFileSync(path.join(root, name), 'utf8'), `distributed ${name} must preserve the original license notice`);
  }
});

test('hooks capture ordinary, rush and clones decisions and complete exact daily settlement', async () => {
  const mock = mockWx(), runtime = loadGame(mock); await tick();
  runtime.test.chooseLang('zh'); await runtime.ranking.start(); runtime.test.go('booth');
  const spec = runtime.test.B.queue[0], entrant = runtime.test.newEntrant(spec, true);
  runtime.test.B.ent = entrant; runtime.test.finish(entrant, spec.ok[0]);
  runtime.test.go('summary'); runtime.test.forceTime(runtime.test.sceneT0 + 3);
  runtime.test.summaryClick(500, 330); await runtime.ranking.flush();
  const settlement = mock.requests.find((it) => it.url.includes('/settlements'));
  assert.equal(settlement.data.day, 1);
  assert.deepEqual(read(settlement.data.events), [{ type: 'decision', decision: spec.ok[0], exposed: false }]);
  assert.equal(settlement.data.claimedBalance, runtime.getState().savings);
  assert.equal(runtime.ranking.active.nextDay, 2);
  runtime.test.setDay(4); runtime.test.go('booth'); runtime.test.startRush();
  const ev = runtime.test.B.event;
  ev.i = 0; ev.lock = false; runtime.test.B.ent = runtime.test.newEntrant(runtime.test.B.queue[0], true);
  runtime.test.rushPick('deny'); runtime.test.rushEnd();
  runtime.test.go('summary'); runtime.test.forceTime(runtime.test.sceneT0 + 3);
  // Separate run not submitted here; test direct branch rendering and hook invocation.
  runtime.test.setDay(5); runtime.test.go('booth'); runtime.test.startClones();
  runtime.test.B.event.items.forEach((it) => { it.state = 'hit'; }); runtime.test.B.event.hits = 10;
  runtime.test.updateClones(); assert.equal(runtime.test.B.event.done, true);
});

for (const ending of ['approve', 'deny']) test(`all six days produce server-verified transcripts, household spending and ${ending} ending`, async () => {
  const engine = createEngine(root), seed = 'server-random-seed';
  let serverState = engine.initialState(seed), serverFinished = false;
  const accepted = [];
  const mock = mockWx(new Map(), (options) => {
    if (!options.url.includes('/settlements')) return defaultHandler(options);
    const result = engine.replay(seed, serverState, read(options.data));
    serverState = result.state; serverFinished = result.finished; accepted.push(read(options.data));
    return { accepted: true, day: options.data.day, balance: result.balance, best: result.balance, finished: result.finished, nextDay: result.nextDay };
  });
  const runtime = loadGame(mock); await tick(); runtime.test.chooseLang('zh'); await runtime.ranking.start();
  for (let day = 1; day <= 6; day++) {
    assert.equal(runtime.getState().day, day);
    runtime.test.go('booth'); const B = runtime.test.B;
    while (B.idx < B.queue.length) {
      const spec = B.queue[B.idx++];
      B.timers = [];
      if (spec.type === 'rush') {
        runtime.test.startRush(); const event = B.event;
        runtime.test.constants.RUSH.forEach((item, index) => {
          event.i = index; event.lock = false; B.ent = runtime.test.newEntrant(B.queue[0], true);
          runtime.test.rushPick(item.ok);
        });
        B.ent = null; runtime.test.rushEnd();
      } else if (spec.type === 'clones') {
        runtime.test.startClones(); B.event.items.forEach((item) => { item.state = 'hit'; }); B.event.hits = 10;
        runtime.test.updateClones(); runtime.test.forceTime(runtime.test.now + 2); runtime.test.runTimers();
      } else {
        if (spec.onPlace && Object.values(spec.onPlace).includes('note')) runtime.test.S.flags.sawNote = true;
        const entrant = runtime.test.newEntrant(spec, true);
        entrant.exposed = day >= 2 && !!(spec.quiz === 'cn' || spec.quiz && spec.quiz.first !== undefined);
        B.ent = entrant;
        const decision = spec.author ? ending : spec.then === 'jorji5' ? 'deny' : entrant.exposed && spec.ok.includes('detain') ? 'detain' : spec.ok[0];
        runtime.test.finish(entrant, decision);
      }
    }
    if (!(day === 6 && ending === 'deny')) {
      runtime.test.go('summary'); runtime.test.forceTime(runtime.test.sceneT0 + 3);
      runtime.test.summaryClick(500, 330);
    }
    await runtime.ranking.flush();
    assert.equal(runtime.ranking.pendingCount, 0);
    assert.equal(accepted.length, day);
    const actual = read(runtime.getState()); actual.flags.sawNote = !!actual.flags.sawNote;
    const expected = read(serverState); delete actual.tut; delete expected.tut;
    assert.deepEqual(actual, expected);
  }
  assert.equal(serverFinished, true);
  assert.equal(runtime.ranking.active.finished, true);
  assert.ok(accepted[3].events.some((event) => event.type === 'rush'));
  assert.ok(accepted[4].events.some((event) => event.type === 'clones'));
  assert.ok(accepted[5].events.length >= 6, 'Day 6 Jorji must be requeued after rejection');
  assert.equal(accepted[5].ending, ending === 'deny' ? 'deny' : undefined);
});
