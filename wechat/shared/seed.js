'use strict';

// Stable across browser/WeChat/Node. Only queue generation uses this PRNG.
function createRandom(seed) {
  let state = 2166136261;
  for (let i = 0; i < String(seed).length; i++) {
    state ^= String(seed).charCodeAt(i);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function daySeed(seed, day) { return `${seed}:day:${day}`; }

function withSeed(seed, callback, math = Math) {
  const previous = math.random;
  math.random = createRandom(seed);
  try { return callback(); } finally { math.random = previous; }
}

module.exports = { createRandom, daySeed, withSeed };
