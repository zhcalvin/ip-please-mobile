import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['assets.js', 'en.js', 'i18n.js', 'gfx.js', 'docs.js', 'data.js', 'booth.js', 'events.js', 'screens.js', 'main.js'];
const sources = files.map(file => readFileSync(path.join(root, file), 'utf8'));
function game() {
  const text = [], sound = [];
  const drawing = new Proxy({}, { get: () => () => {} });
  const canvas = { style: {}, setAttribute() {}, getContext: () => drawing, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }) };
  const element = { style: {}, textContent: '', setAttribute() {}, getBoundingClientRect: () => ({ width: 640, height: 360 }) };
  const context = vm.createContext({ console, navigator: { language: 'zh-CN' }, Intl, Date, Math,
    document: { documentElement: { toggleAttribute() {} }, createElement: () => ({ ...canvas }), getElementById: id => id === 'game' ? canvas : element, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    SFX: new Proxy({ play: (...args) => sound.push(args), muted: false }, { get: (target, key) => key in target ? target[key] : () => {} }),
    addEventListener() {}, location: { search: '' }, URLSearchParams, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    testText: text, testCanvas: canvas,
  });
  context.window = context;
  sources.forEach((source, i) => vm.runInContext(source, context, { filename: files[i] }));
  vm.runInContext(`newGame();chooseLang('zh');S.day=4;now=10;startDay();canvasEl=testCanvas;
    setCtx(testCanvas.getContext('2d'));txt=(...args)=>testText.push(args);bigText=()=>{};`, context);
  return { run: code => vm.runInContext(code, context), text, sound };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('desk bell and tool buttons remain >=44 CSS pixels on the smallest landscape iPhone', () => {
  const g = game(), boxes = plain(g.run('[SPEAKER,RULE_BTN,XRAY_BTN,INSPECT_BTN]'));
  const scale = Math.min(568 / 640, 320 / 360);
  for (const [left, top, right, bottom] of boxes) {
    assert.ok((right - left) * scale >= 44);
    assert.ok((bottom - top) * scale >= 44);
    assert.ok(left >= 0 && top >= 0 && right < 640 && bottom < 360);
  }
  assert.ok(boxes[0][3] < 347, 'bell must leave the date row free');
  assert.ok(boxes[0][1] > 283, 'bell must leave the visible counter documents free');
  assert.ok(boxes[1][2] < boxes[2][0] && boxes[2][2] < boxes[3][0]);
});

test('large bell hit reaches next entrant without stealing visible documents or quiz/detain taps', () => {
  const g = game();
  g.run(`globalThis.calls=[];callNext=()=>calls.push('next');quiz=()=>calls.push('quiz');detain=()=>calls.push('detain');
    const e=newEntrant(day2Fixed().brown,true);B.ent=e;handDocs(e);dragStart=d=>calls.push(d.key);
    boothDown(...center(SPEAKER));boothDown(35,273);boothDown(...center(QUIZ_BTN));boothDown(...center(DETAIN_BTN));`);
  assert.deepEqual(plain(g.run('calls')), ['next', 'pp', 'quiz', 'detain']);
});

test('tool captions use readable 12px bright labels in Chinese and English within each button', () => {
  const g = game();
  for (const lang of ['zh', 'en']) {
    g.text.length = 0; g.run(`LANG='${lang}';drawButtons()`);
    for (const label of lang === 'zh' ? ['章程', 'X光', '检查'] : ['CHARTER', 'X-RAY', 'CHECK']) {
      const call = g.text.find(args => args[2] === label);
      assert.ok(call, label); assert.equal(call[3], 12); assert.equal(call[4], g.run('K.WHITE'));
      const boxes = plain(g.run('[RULE_BTN,XRAY_BTN,INSPECT_BTN]'));
      const box = boxes.find(([x0, , x1]) => call[0] >= x0 && call[0] <= x1);
      assert.ok(g.run(`tw(${JSON.stringify(label)},12)`) <= box[2] - box[0] - 4);
    }
  }
});

test('wrapped dialogue stays beside the bell and preserves original spoken-clue hit detection', () => {
  const g = game();
  g.run(`const e=newEntrant(day2Fixed().brown,true);B.ent=e;handDocs(e);
    say('C','请把你随身携带的所有证件拿出来，我们需要逐项检查。');say('E',e.spec.tell.say);`);
  const lines = plain(g.run('lineBoxes()'));
  assert.ok(lines.some(line => line.lines.length > 1), 'long dialogue should wrap');
  for (const { box, lines: content, size } of lines) {
    assert.ok(box[0] > g.run('SPEAKER[2]') && box[2] <= 218);
    assert.ok(box[1] >= 286 && box[3] <= 340);
    for (const text of content) assert.ok(g.run(`tw(${JSON.stringify(text)},${size})`) <= 134);
  }
  assert.equal(g.run(`const clue=lineBoxes().find(line=>line.ln.who==='E');fieldAt(...center(clue.box)).ln.text`), 'Good morning，sir。');
  g.run('setInspect(true);inspectClick(...center(clue.box))');
  assert.equal(g.run('B.ent.suspect'), true);
});

test('three recent English messages remain available when the last sentence wraps', () => {
  const g = game();
  g.run(`LANG='en';say('C','口袋里是什么？');say('E','……是我的猫。');say('C','你的猫会自动换 IP？');`);
  assert.equal(g.run('lineBoxes().length'), 3);
  assert.deepEqual(plain(g.run('lineBoxes().map(entry=>entry.ln.text)')), plain(g.run('B.lines.map(entry=>entry.text)')));
});

test('language startup omits the visible tribute footer and the bell caption is localized', () => {
  const g = game();g.text.length = 0;g.run('drawLangPick()');
  assert.ok(!g.text.some(args => /致敬|tribute|copyright|©/i.test(args[2])));
  g.text.length = 0;g.run('drawBoothLower()');
  assert.ok(g.text.some(args => args[2] === '下一位' && args[3] === 12));
  assert.equal(g.run("LANG='en';T('下一位')"), 'NEXT');
});

test('successful next call plays the bell cue and a busy counter never rings it', () => {
  const g = game();g.run('callNext()');
  assert.equal(g.sound.filter(args => args[0] === 'bell').length, 1);
  g.run('callNext()');
  assert.equal(g.sound.filter(args => args[0] === 'bell').length, 1);
});

test('all renamed title and bell hint glyphs are packaged at every supported size', () => {
  const g = game();
  for (const size of [8, 10, 12]) for (const ch of '揪起你的盖头来铃铛') assert.ok(g.run(`ASSETS.font[${size}][${JSON.stringify(ch)}]`), `${ch} at ${size}px`);
});
