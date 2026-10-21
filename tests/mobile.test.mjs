import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webFiles, root } from '../tools/mobile.mjs';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');

function game() {
  const frames = new Map();
  const captures = new Set();
  let nextFrame = 0;
  const canvas = {
    style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
    setPointerCapture: (id) => captures.add(id), hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const context = vm.createContext({
    console, URLSearchParams, window: { addEventListener() {}, location: { search: '' } },
    document: { hidden: false, getElementById: () => ({ getBoundingClientRect: () => ({ width: 700, height: 350 }) }) },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
    canvasEl: canvas, W: 640, H: 360, now: 0, scene: 'boot', sceneT0: 0,
    ptr: { x: 0, y: 0, down: false }, drag: null,
    SFX: { init() {}, setPaused(value) { context.audioPaused = value; } },
  });
  vm.runInContext(mainSource, context);
  vm.runInContext('update = () => {}; render = () => {}; sceneClick = () => {}; gameReady = true;', context);
  return {
    context, run: (code) => vm.runInContext(code, context),
    frame(ts) {
      assert.equal(frames.size, 1, 'exactly one animation loop');
      const [id, fn] = frames.entries().next().value;
      frames.delete(id); fn(ts);
    },
    frames, captures,
  };
}

test('background time does not advance game timers, and resume starts one loop', () => {
  const g = game();
  g.run('syncGamePause()');
  g.frame(1000); g.frame(1100);
  assert.equal(g.context.now, 0.1);
  g.run('setNativePaused(true)');
  assert.equal(g.frames.size, 0);
  assert.equal(g.context.audioPaused, true);
  g.run('setNativePaused(false); setNativePaused(false)');
  g.frame(61000); g.frame(61100);
  assert.equal(g.context.now, 0.2);
  assert.equal(g.context.audioPaused, false);
});

test('native resume cannot override document visibility or a hidden page', () => {
  const g = game();
  g.run('document.hidden = true; setNativePaused(false)');
  assert.equal(g.frames.size, 0);
  g.run('document.hidden = false; pageHidden = true; syncGamePause()');
  assert.equal(g.frames.size, 0);
  g.run('pageHidden = false; syncGamePause()');
  g.frame(1000);
  assert.equal(g.context.now, 0);
});

test('a second finger cannot move or release the active document drag', () => {
  const g = game();
  g.run(`onDown({ pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 20, pointerType: 'touch', preventDefault() {} });
    onDown({ pointerId: 2, isPrimary: false });
    onMove({ pointerId: 2, isPrimary: false, clientX: 600, clientY: 300 });
    onUp({ pointerId: 2, clientX: 600, clientY: 300 });`);
  assert.equal(g.context.ptr.down, true);
  assert.equal(g.context.ptr.x, 10);
  assert.equal(g.run('activePointerId'), 1);
  g.run('onUp({ pointerId: 1, clientX: 20, clientY: 30 })');
  assert.equal(g.context.ptr.down, false);
});

test('interrupted touches restore documents without issuing gameplay actions', () => {
  const g = game();
  g.run(`activePointerId = 1; ptr.down = true; canvasEl.setPointerCapture(1);
    drag = { d: { big: false, x: 4, y: 5 }, prev: { big: true, x: 230, y: 140 } };
    globalThis.paper = drag.d;
    dragEnd = () => { throw new Error('cancel must not return or stamp a document'); };
    cancelInput({ pointerId: 2 });`);
  assert.ok(g.context.drag);
  g.run('setNativePaused(true)');
  assert.equal(g.context.paper.x, 230);
  assert.equal(g.context.paper.big, true);
  assert.equal(g.context.drag, null);
  assert.equal(g.context.ptr.down, false);
  assert.equal(g.captures.size, 0);
});

test('canvas fits available safe area rather than the full window', () => {
  const g = game();
  g.run('fit()');
  assert.equal(g.context.canvasEl.style.width, '622px');
  assert.equal(g.context.canvasEl.style.height, '350px');
});

test('offline bundle includes every script and both licenses without tooling or remote files', async () => {
  const files = await webFiles();
  assert.ok(files.includes('assets.js'));
  assert.ok(files.includes('main.js'));
  assert.ok(files.includes('LICENSE'));
  assert.ok(files.includes('OFL-fusion-pixel.txt'));
  for (const name of files) {
    assert.match(name, /^[\w.-]+$/);
    assert.ok((await readFile(`${root}/${name}`)).length > 0);
  }
});
