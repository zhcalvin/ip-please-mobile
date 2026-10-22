import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createShare, snapshotSummary, shareMetadata, CARD_WIDTH, CARD_HEIGHT } = require('../client/share.js');
const { createUI } = require('../client/ui.js');
const { createGameClub, GAME_CLUB_BOX } = require('../client/gameclub.js');
const { GAME_NAME } = require('../client/branding.js');

function mockContext() {
  const text = [], images = [];
  return new Proxy({ text, images, fillText: (...args) => text.push(args), drawImage: (...args) => images.push(args) }, { get: (target, key) => key in target ? target[key] : () => {} });
}
function mockWx() {
  const messages = [], exports = [], toasts = [], callbacks = {}, ctx = mockContext();
  const canvas = { width: 0, height: 0, getContext: () => ctx, toTempFilePathSync: (options) => { exports.push(options); return 'wxfile://daily-report.png'; } };
  const wx = { createCanvas: () => canvas, shareAppMessage: (message) => messages.push(message), showToast: (value) => toasts.push(value.title) };
  for (const name of ['Hide', 'Show', 'WindowResize']) wx[`on${name}`] = (fn) => { (callbacks[name] ||= []).push(fn); };
  return { wx, messages, exports, toasts, canvas, ctx, emit: (name) => (callbacks[name] || []).forEach((fn) => fn()) };
}
const summary = { day: 4, balance: 37, correct: 10, total: 15 };

test('share snapshot includes only exact current summary data and immutable metadata', () => {
  const source = { ...summary, playerId: 'private-player', runId: 'private-run', token: 'private-auth' };
  const snapshot = snapshotSummary(source);
  source.balance = 900;
  assert.equal(snapshot.balance, 37); assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(Object.keys(snapshot), ['day', 'balance', 'correct', 'total']);
  const metadata = shareMetadata(snapshot, 'wxfile://daily-report.png');
  assert.equal(GAME_NAME, '揪起你的盖头来');
  assert.equal(metadata.title, '揪起你的盖头来｜DAY 4 结余 37 Token');
  assert.equal(metadata.query, 'from=daily-report');
  assert.equal(metadata.imageUrl, 'wxfile://daily-report.png');
  assert.ok(!JSON.stringify(metadata).includes('private'));
  assert.throws(() => snapshotSummary({ ...summary, day: 7 }));
  assert.throws(() => snapshotSummary({ ...summary, balance: Infinity }));
});

test('card renders current selected balance and exports 5:4 only after explicit send', async () => {
  const mock = mockWx();
  let menuOptions, menuShare;
  mock.wx.showShareMenu = (options) => { menuOptions = options; };
  mock.wx.onShareAppMessage = (listener) => { menuShare = listener; };
  const sharing = createShare(mock.wx);
  assert.deepEqual(menuOptions, { menus: ['shareAppMessage'] });
  assert.deepEqual(menuShare(), { title: '揪起你的盖头来', query: 'from=menu' });
  sharing.show(summary);
  assert.equal(mock.messages.length, 0); assert.equal(mock.exports.length, 0);
  assert.equal(mock.canvas.width, CARD_WIDTH); assert.equal(mock.canvas.height, CARD_HEIGHT);
  assert.equal(CARD_WIDTH / CARD_HEIGHT, 5 / 4);
  assert.ok(mock.ctx.text.some(([text]) => text === '37'));
  assert.ok(mock.ctx.text.some(([text]) => text === '揪起你的盖头来'));
  assert.ok(!mock.ctx.text.some(([text]) => /IP,? PLEASE/i.test(text)));
  assert.ok(mock.ctx.text.some(([text]) => text.includes('当前选项预览')));
  assert.equal(await sharing.send(), true);
  assert.equal(mock.messages.length, 1); assert.equal(mock.exports.length, 1);
  assert.deepEqual(mock.exports[0], { x: 0, y: 0, width: 500, height: 400, destWidth: 500, destHeight: 400, fileType: 'png' });
  assert.equal('success' in mock.messages[0], false, 'a share invocation must not claim successful delivery');
});

test('async export cannot double-share and uses the tapped preview snapshot', async () => {
  const mock = mockWx(); delete mock.canvas.toTempFilePathSync;
  let finish;
  mock.canvas.toTempFilePath = (options) => { finish = options.success; };
  const sharing = createShare(mock.wx); sharing.show({ ...summary, balance: -2 });
  const first = sharing.send(); assert.equal(sharing.exporting, true);
  assert.equal(await sharing.send(), false); assert.equal(mock.messages.length, 0);
  finish({ tempFilePath: 'wxfile://async.png' });
  assert.equal(await first, true); assert.equal(sharing.exporting, false);
  assert.match(mock.messages[0].title, /结余 -2 Token/); assert.equal(mock.messages[0].imageUrl, 'wxfile://async.png');
});

test('image export and unsupported share API fail gracefully without blocking summary', async () => {
  const mock = mockWx(); mock.canvas.toTempFilePathSync = () => { throw new Error('native export error'); };
  const sharing = createShare(mock.wx); sharing.show(summary);
  assert.equal(await sharing.send(), true); assert.equal(mock.messages[0].imageUrl, undefined);
  assert.ok(mock.toasts.some((title) => title.includes('文字转发')));
  mock.wx.shareAppMessage = () => { throw new Error('not available'); };
  assert.equal(await sharing.send(), false); assert.equal(sharing.exporting, false);
  delete mock.wx.shareAppMessage;
  assert.equal(await sharing.send(), false);
  assert.equal(sharing.show({ ...summary, correct: 100 }), false);
});

test('daily report entry is manual, leaves continue untouched, and pauses only its own preview', async () => {
  const mock = mockWx(), screen = mockContext();
  let input, paused = false, balance = 37, ui;
  const platform = { setInputHandler: (fn) => { input = fn; }, point: (touch) => [touch.clientX, touch.clientY], present: (draw) => draw(screen) };
  const ranking = { state: { status: '', entries: [] }, refresh() {} };
  const sharing = createShare(mock.wx, () => { if (ui) ui.repaint(); });
  ui = createUI(platform, ranking, { scene: () => 'summary', muted: () => false, toggleMute() {}, pause: (value) => { paused = value; }, summary: () => ({ ...summary, balance }) }, sharing);
  const tap = (x, y) => input('pointerdown', { changedTouches: [{ clientX: x, clientY: y }] });
  ui.repaint(); assert.equal(mock.messages.length, 0); assert.equal(paused, false);
  assert.equal(tap(500, 330), false, 'normal continue coordinates must reach the original game');
  balance = 21; assert.equal(tap(152, 332), true); assert.equal(paused, true); assert.equal(ui.open, true);
  assert.equal(sharing.snapshot.balance, 21); assert.equal(mock.messages.length, 0);
  assert.equal(tap(220, 334), true); assert.equal(paused, false); assert.equal(ui.open, false);
  balance = 9; tap(152, 332); assert.equal(sharing.snapshot.balance, 9);
  tap(400, 334); await Promise.resolve();
  assert.equal(mock.messages.length, 1); assert.equal(mock.messages[0].title, '揪起你的盖头来｜DAY 4 结余 9 Token');
  tap(220, 334); assert.equal(paused, false);
});

test('native game club maps viewport CSS coordinates and hides for gameplay, overlay and background', () => {
  const mock = mockWx(); let allowed = false, shows = 0, hides = 0, options;
  let bounds = { left: 20, top: 12, width: 760, height: 427.5 };
  const native = { style: {}, show: () => shows++, hide: () => hides++ };
  mock.wx.createGameClubButton = (value) => { options = value; return native; };
  const club = createGameClub(mock.wx, { game: { getBoundingClientRect: () => bounds } }, () => allowed);
  club.sync(); assert.equal(options, undefined);
  allowed = true; club.sync(); assert.equal(club.visible, true); assert.equal(shows, 1);
  assert.equal(options.text, '游戏圈'); assert.equal(options.type, 'text'); assert.equal(options.openlink, undefined);
  assert.equal(native.style.left, 20 + 188 * 1.1875); assert.equal(native.style.top, 12 + 8 * 1.1875);
  assert.equal(native.style.width, 80 * 1.1875); assert.equal(native.style.height, 26 * 1.1875);
  assert.equal(club.contains(200, 20), true); assert.equal(club.contains(152, 332), false);
  allowed = false; club.sync(); assert.equal(club.visible, false); assert.equal(hides, 1);
  allowed = true; club.sync(); mock.emit('Hide'); assert.equal(club.visible, false);
  mock.emit('Show'); assert.equal(club.visible, true);
  bounds = { left: 0, top: 0, width: 640, height: 360 }; mock.emit('WindowResize'); assert.equal(native.style.left, 188);
  assert.ok(GAME_CLUB_BOX[0] > 180, 'native club follows the existing sound control');
  assert.ok(GAME_CLUB_BOX[2] < 280, 'native club must not cover the centered summary heading');
});

test('unsupported or unavailable official game club remains optional', () => {
  const mock = mockWx(), platform = { game: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640 }) } };
  const missing = createGameClub(mock.wx, platform, () => true); assert.doesNotThrow(() => missing.sync()); assert.equal(missing.visible, false);
  mock.wx.createGameClubButton = () => { throw new Error('account capability unavailable'); };
  const unavailable = createGameClub(mock.wx, platform, () => true); assert.doesNotThrow(() => unavailable.sync()); assert.equal(unavailable.visible, false);
});
