import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../sfx.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../main.js', import.meta.url), 'utf8');

function audio() {
  const contexts = [], timers = [];
  class Context {
    constructor() {
      this.state = 'suspended'; this.currentTime = 0; this.destination = {};
      this.edges = []; this.sources = []; this.gains = []; this.buffers = [];
      this.resumes = 0; this.suspends = 0; contexts.push(this);
    }
    node(value = {}) { return Object.assign(value, { connect: (target) => { this.edges.push([value, target]); } }); }
    createDynamicsCompressor() { return this.node(); }
    createGain() { const gain = this.node({ gain: { value: 1 } }); this.gains.push(gain); return gain; }
    createBufferSource() {
      const src = this.node({ loop: false, started: false, stopped: false,
        start(when = 0) { this.started = true; this.when = when; }, stop() { this.stopped = true; } });
      this.sources.push(src); return src;
    }
    createBuffer(channels, length, sampleRate) {
      const buffer = { length, sampleRate, samples: null, copyToChannel(samples) { this.samples = Float32Array.from(samples); } };
      this.buffers.push(buffer); return buffer;
    }
    resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
    suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
  }
  const context = vm.createContext({ window: { AudioContext: Context }, console,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; } });
  vm.runInContext(source + '\nglobalThis.audio = SFX;', context);
  return {
    api: context.audio, contexts,
    flushMusic() {
      for (;;) {
        const index = timers.findIndex((timer) => timer.delay === 0);
        if (index === -1) break;
        timers.splice(index, 1)[0].fn();
      }
    },
  };
}

test('first gesture resumes a new context and connects a complete graph when connect returns void', () => {
  const { api, contexts } = audio();
  api.setPaused(false); api.music('title');
  assert.equal(contexts.length, 0, 'no context or autoplay is created before the player gesture');
  api.init();
  const ctx = contexts[0], src = api.play('bell');
  assert.equal(ctx.resumes, 1); assert.equal(ctx.state, 'running');
  assert.equal(src.started, true);
  assert.ok(ctx.edges.some(([, target]) => target === ctx.destination));
  assert.ok(ctx.edges.some(([node]) => node === src));
  assert.ok(src.buffer.samples.some((sample) => Math.abs(sample) > 0.01), 'bell contains audible PCM');
  ctx.state = 'interrupted'; api.init();
  assert.equal(ctx.resumes, 2, 'a later gesture retries interrupted audio, not only suspended audio');
});

test('background score is non-silent, loops once, and survives scene, mute and pause changes', () => {
  const session = audio(), { api, contexts } = session;
  api.music('booth'); api.init(); session.flushMusic();
  const ctx = contexts[0], music = ctx.sources.find((src) => src.loop);
  assert.ok(music && music.started);
  assert.ok(music.buffer.length > music.buffer.sampleRate * 10);
  let power = 0, peak = 0;
  for (const sample of music.buffer.samples) { assert.ok(Number.isFinite(sample)); power += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  assert.ok(Math.sqrt(power / music.buffer.length) > 0.01);
  assert.ok(peak <= 0.61, 'the synthesized loop is not clipped');
  assert.ok(Math.abs(music.buffer.samples[0]) < 0.001 && Math.abs(music.buffer.samples.at(-1)) < 0.001);
  for (const scene of ['title', 'daycard', 'news', 'booth', 'summary', 'end']) api.music(scene);
  api.init(); session.flushMusic();
  assert.equal(ctx.sources.filter((src) => src.loop).length, 1, 'scene changes never stack score loops');
  api.toggleMute(); assert.equal(ctx.gains[0].gain.value, 0);
  assert.equal(api.play('bell'), null);
  api.setPaused(true); assert.equal(ctx.state, 'suspended');
  api.toggleMute(); assert.equal(ctx.gains[0].gain.value, 0.9);
  assert.equal(ctx.state, 'suspended', 'unmuting does not resume background playback');
  api.setPaused(false); session.flushMusic();
  assert.equal(ctx.state, 'running');
  assert.equal(ctx.sources.filter((src) => src.loop).length, 1);
});

test('ambient created while muted becomes audible after unmute without a stuck zero-gain bus', () => {
  const session = audio(), { api, contexts } = session;
  api.toggleMute(); api.ambient(true); api.init();
  const ctx = contexts[0], ambient = ctx.sources.find((src) => src.loop);
  assert.ok(ambient && ambient.started);
  assert.equal(ctx.gains[0].gain.value, 0);
  const ambientGain = ctx.edges.find(([node]) => node === ambient)[1];
  assert.equal(ambientGain.gain.value, 0.8);
  api.toggleMute(); session.flushMusic();
  assert.equal(ctx.gains[0].gain.value, 0.9); assert.equal(ambientGain.gain.value, 0.8);
  api.ambient(false); assert.equal(ambient.stopped, true);
});

test('paused initialization waits for foreground before creating the score loop', () => {
  const session = audio(), { api, contexts } = session;
  api.setPaused(true); api.music('booth'); api.init(); session.flushMusic();
  const ctx = contexts[0];
  assert.equal(ctx.resumes, 0); assert.equal(ctx.sources.filter((src) => src.loop).length, 0);
  api.setPaused(false); session.flushMusic();
  assert.equal(ctx.resumes, 1); assert.equal(ctx.sources.filter((src) => src.loop).length, 1);
});

test('scene transitions select the continuous score instead of overlapping title and ending one-shots', () => {
  const played = [], music = [];
  const context = vm.createContext({ window: { addEventListener() {} }, document: { hidden: false },
    now: 0, scene: 'boot', sceneT0: 0, lastKey: -1, SFX: { ambient() {}, music: (scene) => music.push(scene), play: (name) => played.push(name), paper() {} },
    startDay() {}, initSummary() {}, console });
  vm.runInContext(main, context);
  for (const name of ['title', 'daycard', 'news', 'booth', 'summary', 'end']) vm.runInContext(`go('${name}')`, context);
  assert.deepEqual(music, ['title', 'daycard', 'news', 'booth', 'summary', 'end']);
  assert.ok(!played.includes('title') && !played.includes('sad') && !played.includes('end'));
  assert.ok(played.includes('day_hit') && played.includes('whoosh'));
});
