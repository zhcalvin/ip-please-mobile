'use strict';

const positive = (value) => Number.isFinite(value) && value > 0;

function safeBounds(info, width, height, orientation) {
  const full = { left: 0, top: 0, right: width, bottom: height };
  const safe = info.safeArea;
  if (!safe || !['left', 'top', 'right', 'bottom'].every((key) => Number.isFinite(safe[key])) || safe.right <= safe.left || safe.bottom <= safe.top) return full;
  let { left, top, right, bottom } = safe;
  // WeChat documents safeArea in portrait coordinates. Some clients already rotate it.
  const screenWidth = positive(info.screenWidth) ? info.screenWidth : width;
  const screenHeight = positive(info.screenHeight) ? info.screenHeight : height;
  const portraitWidth = Math.min(screenWidth, screenHeight), portraitHeight = Math.max(screenWidth, screenHeight);
  if (width > height && bottom > height && right <= portraitWidth && bottom <= portraitHeight) {
    const insets = { left: Math.max(0, left), top: Math.max(0, top), right: Math.max(0, portraitWidth - right), bottom: Math.max(0, portraitHeight - bottom) };
    if (orientation === 'landscape') {
      [left, top, right, bottom] = [insets.top, insets.right, width - insets.bottom, height - insets.left];
    } else if (orientation === 'landscapeReverse') {
      [left, top, right, bottom] = [insets.bottom, insets.left, width - insets.top, height - insets.right];
    } else {
      // Until native orientation is known, protect either notch side without narrowing to portrait width.
      left = Math.max(insets.top, insets.bottom); right = width - left;
      top = Math.max(insets.left, insets.right); bottom = height - top;
    }
  }
  left = Math.max(0, left); top = Math.max(0, top);
  right = Math.min(width, right); bottom = Math.min(height, bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : full;
}

// A narrow DOM adapter for the original Canvas game; no WebView or remote game code.
function createPlatform(wx, host = {}) {
  const display = wx.createCanvas(); // The first Mini Game canvas is the screen.
  const game = wx.createCanvas();
  const listeners = new Map();
  const key = (scope, event) => `${scope}:${event}`;
  const listen = (scope, event, fn) => {
    const k = key(scope, event);
    if (!listeners.has(k)) listeners.set(k, []);
    listeners.get(k).push(fn);
  };
  const dispatch = (scope, event, value = {}) => {
    for (const fn of listeners.get(key(scope, event)) || []) fn(value);
  };
  const requestFrame = host.requestAnimationFrame || (typeof requestAnimationFrame === 'function' && requestAnimationFrame);
  const cancelFrame = host.cancelAnimationFrame || (typeof cancelAnimationFrame === 'function' && cancelAnimationFrame);
  if (!requestFrame || !cancelFrame) throw new Error('微信基础库缺少 requestAnimationFrame');
  let viewport = { left: 0, top: 0, width: 640, height: 360 }, dpr = 1, orientation = null;
  let windowSize = { windowWidth: 640, windowHeight: 360 };
  function resize(event) {
    const info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
    const size = event && (event.size || event) || {};
    const width = positive(size.windowWidth) ? size.windowWidth : positive(info.windowWidth) ? info.windowWidth : windowSize.windowWidth;
    const height = positive(size.windowHeight) ? size.windowHeight : positive(info.windowHeight) ? info.windowHeight : windowSize.windowHeight;
    windowSize = { windowWidth: width, windowHeight: height };
    dpr = Math.max(1, Math.min(info.pixelRatio || 1, 3));
    display.width = Math.round(width * dpr); display.height = Math.round(height * dpr);
    const { left, top, right, bottom } = safeBounds(info, width, height, orientation);
    const scale = Math.min((right - left) / 640, (bottom - top) / 360);
    viewport = { left: left + (right - left - 640 * scale) / 2, top: top + (bottom - top - 360 * scale) / 2, width: 640 * scale, height: 360 * scale };
    dispatch('window', 'resize');
  }
  game.style = {};
  game.getBoundingClientRect = () => ({ ...viewport });
  game.addEventListener = (event, fn) => listen('canvas', event, fn);
  game.setAttribute = () => {};
  game.setPointerCapture = () => {};
  game.hasPointerCapture = () => false;
  game.releasePointerCapture = () => {};
  const mute = { textContent: '' };
  const root = { toggleAttribute() {}, lang: 'zh-CN' };
  const document = {
    hidden: false, title: '', documentElement: root,
    createElement: (tag) => { if (tag !== 'canvas') throw new Error(`Unsupported element: ${tag}`); return wx.createCanvas(); },
    getElementById: (id) => id === 'game' ? game : id === 'viewport' ? { getBoundingClientRect: () => viewport } : id === 'mute' ? mute : null,
    querySelectorAll: () => [],
    addEventListener: (event, fn) => listen('document', event, fn),
  };
  const window = {
    __IP_PLEASE_NATIVE__: true,
    location: { search: '' },
    addEventListener: (event, fn) => listen('window', event, fn),
  };
  // wx WebAudio has synchronous implementations of Promise-shaped lifecycle APIs,
  // and native node.connect does not consistently return its destination.
  if (wx.createWebAudioContext) window.AudioContext = function AudioContext() {
    let ac;
    try { ac = wx.createWebAudioContext(); } catch (error) { return silentAudio(); }
    const wrap = (node) => {
      const out = { _node: node };
      for (const prop of ['gain', 'buffer', 'loop']) Object.defineProperty(out, prop, { get: () => node[prop], set: (value) => { node[prop] = prop === 'buffer' && value && value._buffer ? value._buffer : value; } });
      out.connect = (target) => { node.connect(target._node || target); return target; };
      out.start = (...args) => node.start(...args);
      out.stop = (...args) => node.stop(...args);
      return out;
    };
    return {
      get currentTime() { return ac.currentTime; }, get state() { return ac.state; }, destination: ac.destination,
      createBuffer(channels, length, rate) {
        const b = ac.createBuffer(channels, length, rate);
        return { _buffer: b, copyToChannel: (samples, channel, offset = 0) => b.copyToChannel(samples, channel, offset) };
      },
      createGain: () => wrap(ac.createGain()),
      createBufferSource: () => wrap(ac.createBufferSource()),
      // Old clients may lack a compressor; a gain is a safe pass-through.
      createDynamicsCompressor: () => wrap(ac.createDynamicsCompressor ? ac.createDynamicsCompressor() : ac.createGain()),
      suspend: () => { try { return Promise.resolve(ac.suspend()); } catch (e) { return Promise.resolve(); } },
      resume: () => { try { return Promise.resolve(ac.resume()); } catch (e) { return Promise.resolve(); } },
    };
  };
  const localStorage = {
    getItem(k) { const value = wx.getStorageSync(k); return value === '' || value === undefined ? null : String(value); },
    setItem: (k, v) => wx.setStorageSync(k, String(v)),
    removeItem: (k) => wx.removeStorageSync(k),
  };
  let consume = () => false;
  const input = (event, scope, source) => (ev) => {
    if (consume(event, ev)) return;
    for (const touch of ev.changedTouches || []) dispatch(scope, event, {
      pointerId: touch.identifier, pointerType: 'touch', isPrimary: true, button: 0,
      clientX: touch.clientX === undefined ? touch.pageX : touch.clientX,
      clientY: touch.clientY === undefined ? touch.pageY : touch.clientY,
      preventDefault() {}, source,
    });
  };
  wx.onTouchStart(input('pointerdown', 'canvas'));
  wx.onTouchMove(input('pointermove', 'window'));
  wx.onTouchEnd(input('pointerup', 'window'));
  wx.onTouchCancel(input('pointercancel', 'window'));
  wx.onHide(() => { document.hidden = true; dispatch('document', 'visibilitychange'); });
  wx.onShow(() => { resize(); document.hidden = false; dispatch('document', 'visibilitychange'); });
  if (wx.onWindowResize) wx.onWindowResize(resize);
  if (wx.onDeviceOrientationChange) wx.onDeviceOrientationChange(({ value }) => {
    orientation = value;
    resize({ size: windowSize });
  });
  if (wx.onAudioInterruptionBegin) wx.onAudioInterruptionBegin(() => dispatch('window', 'audiointerruption', { paused: true }));
  if (wx.onAudioInterruptionEnd) wx.onAudioInterruptionEnd(() => dispatch('window', 'audiointerruption', { paused: false }));
  resize();
  return {
    window, document, localStorage, navigator: { language: (wx.getAppBaseInfo ? wx.getAppBaseInfo().language : 'zh-CN') || 'zh-CN' },
    Image: function Image() { return wx.createImage(); },
    requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame,
    display, game, setInputHandler: (fn) => { consume = fn; },
    point(touch) { return [(touch.clientX - viewport.left) * 640 / viewport.width, (touch.clientY - viewport.top) * 360 / viewport.height]; },
    present(drawOverlay) {
      const ctx = display.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#161313'; ctx.fillRect(0, 0, display.width, display.height);
      const scale = dpr * viewport.width / 640;
      ctx.setTransform(scale, 0, 0, scale, viewport.left * dpr, viewport.top * dpr);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(game, 0, 0, 640, 360);
      if (drawOverlay) drawOverlay(ctx);
    },
  };
}

function silentAudio() {
  const node = () => ({ gain: { value: 0 }, connect(target) { return target; }, start() {}, stop() {} });
  return { currentTime: 0, state: 'running', destination: node(), createGain: node, createBufferSource: node, createDynamicsCompressor: node,
    createBuffer: () => ({ copyToChannel() {} }), suspend: () => Promise.resolve(), resume: () => Promise.resolve() };
}

module.exports = { createPlatform };
