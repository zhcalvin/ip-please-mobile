'use strict';
// 绘图层：调色板、像素图元、像素字、精灵。坐标约定和 pp/base.py 一致（矩形用闭区间）。

const W = 640, H = 360;

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// —— 调色板：灰褐、低饱和；只有红章、绿章、Claude 橙是亮色 ——
const C = {
  INK: [22, 19, 19], OUTLINE: [34, 27, 25],
  GROUND: [93, 87, 78], GROUND_D: [80, 74, 67],
  WALL_D: [48, 45, 43],
  BOOTH_WALL: [52, 48, 44],
  COUNTER: [98, 86, 73], COUNTER_L: [124, 110, 93], COUNTER_D: [70, 61, 52],
  DESK: [68, 57, 50], DESK_D: [56, 47, 42], DESK_L: [84, 72, 63],
  PAPER: [226, 215, 196], PAPER_D: [200, 187, 167], PAPER_LINE: [216, 204, 184],
  PINK: [224, 198, 186], PINK_D: [196, 166, 156],
  SAGE: [208, 214, 190], SAGE_D: [172, 180, 152],
  XRAY_BG: [18, 40, 42], XRAY_FG: [70, 140, 136], XRAY_L: [150, 220, 210],
  TEXT: [74, 56, 48], TEXT_L: [128, 106, 92],
  NAVY: [42, 50, 76], NAVY_L: [60, 70, 100],
  RED: [180, 46, 40], RED_D: [120, 30, 28], RED_L: [222, 92, 76],
  GREEN: [84, 128, 70], GREEN_D: [56, 88, 48], GREEN_L: [122, 178, 98],
  METAL: [92, 90, 86], METAL_D: [60, 58, 56], METAL_L: [124, 122, 116],
  WHITE: [228, 223, 212], GREY: [150, 145, 136], GREY_D: [100, 94, 88],
  ORANGE: [220, 150, 70],
  CLAUDE: [204, 112, 80], CLAUDE_L: [232, 156, 116],
  LED: [214, 72, 52], SWEAT: [156, 186, 204],
  BOOK: [92, 64, 50], BOOK_L: [130, 100, 70], GOLD: [190, 160, 100],
  SKIN: [198, 152, 120],
};
const K = {};
for (const k in C) K[k] = rgb(C[k]);

// —— 当前画布 ——
let G = null;
function setCtx(ctx) { G = ctx; G.imageSmoothingEnabled = false; }

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function rect(x0, y0, x1, y1, col) {
  G.fillStyle = col;
  G.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

function outline(x0, y0, x1, y1, col, w = 1) {
  rect(x0, y0, x1, y0 + w - 1, col);
  rect(x0, y1 - w + 1, x1, y1, col);
  rect(x0, y0, x0 + w - 1, y1, col);
  rect(x1 - w + 1, y0, x1, y1, col);
}

function pt(x, y, col) { G.fillStyle = col; G.fillRect(x, y, 1, 1); }

function line(x0, y0, x1, y1, col) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  if (y0 === y1) return rect(Math.min(x0, x1), y0, Math.max(x0, x1), y0, col);
  if (x0 === x1) return rect(x0, Math.min(y0, y1), x0, Math.max(y0, y1), col);
  G.fillStyle = col;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    G.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function pattern(pat, x, y, colors, k = 1) {
  for (let j = 0; j < pat.length; j++) {
    const row = pat[j];
    for (let i = 0; i < row.length; i++) {
      const c = colors[row[i]];
      if (c) { G.fillStyle = c; G.fillRect(x + i * k, y + j * k, k, k); }
    }
  }
}

const SPARK_13 = [
  '......X......', '...X..X..X...', '....X.X.X....', '.X...XXX...X.', '..XX.XXX.XX..', '....XXXXX....',
  'XXXXXXXXXXXXX', '....XXXXX....', '..XX.XXX.XX..', '.X...XXX...X.', '....X.X.X....', '...X..X..X...',
  '......X......',
];
const SPARK_7 = ['...X...', '.X.X.X.', '..XXX..', 'XXXXXXX', '..XXX..', '.X.X.X.', '...X...'];

function spark(cx, cy, col, big = true, k = 1) {
  const pat = big ? SPARK_13 : SPARK_7;
  const r = Math.floor(pat.length / 2) * k;
  pattern(pat, cx - r, cy - r, { X: col }, k);
}

const CURSOR_PX = [
  'X.........', 'XX........', 'XWX.......', 'XWWX......', 'XWWWX.....', 'XWWWWX....', 'XWWWWWX...',
  'XWWWWWWX..', 'XWWWWWWWX.', 'XWWWWXXXXX', 'XWWXWX....', 'XWX.XWX...', 'XX...XWX..', '......XX..',
];
const HAND_PX = [
  '....XX......', '...XWWX.....', '...XWWX.....', '...XWWXXX...', '...XWWXWWXX.', '.XXXWWXWWXWX',
  'XWWXWWWWWXWX', 'XWWWWWWWWWWX', '.XWWWWWWWWWX', '..XWWWWWWWX.', '...XWWWWWX..', '...XXXXXXX..',
];

function drawCursor(x, y, mode) {
  if (mode === 'hand') return pattern(HAND_PX, x - 5, y - 1, { X: K.INK, W: K.WHITE });
  pattern(CURSOR_PX, x, y, { X: K.INK, W: K.WHITE });
}

// —— 像素字：字形图集（白字），按 (字号, 颜色, 字符串) 缓存上好色的小画布 ——
let FONT_IMG = null, ATLAS_IMG = null, BG_IMG = null, WIN_IMG = null;
const FM = window.ASSETS.font;
const PL = 2, PT = 4;
const textCache = new Map();

function glyph(size, ch) { return FM[size][ch]; }

function tw(s, size = 12) {
  let w = 0;
  for (const ch of s) {
    const g = FM[size][ch];
    w += g ? g[6] : size;
  }
  return w;
}

function textCanvas(s, size, col) {
  const key = size + '|' + col + '|' + s;
  let c = textCache.get(key);
  if (c) return c;
  if (textCache.size > 1500) textCache.clear();
  const w = tw(s, size) + PL * 2 + 2, h = size + PT + 6;
  const [cv, g] = makeCanvas(Math.max(1, w), h);
  let x = PL;
  for (const ch of s) {
    const gl = FM[size][ch];
    if (!gl) { x += size; continue; }
    if (gl[2] > 0) g.drawImage(FONT_IMG, gl[0], gl[1], gl[2], gl[3], x + gl[4], PT + gl[5], gl[2], gl[3]);
    x += gl[6];
  }
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = col;
  g.fillRect(0, 0, cv.width, cv.height);
  textCache.set(key, cv);
  return cv;
}

// anchor: 'la' 左对齐，'ma' 居中，'ra' 右对齐；y 是字形的视觉顶边
function txt(x, y, s, size = 12, col = K.WHITE, anchor = 'la', n = null) {
  s = String(s);
  if (!s) return;
  const c = textCanvas(s, size, col);
  let w = tw(s, size);
  if (anchor === 'ma') x = Math.round(x - w / 2);
  else if (anchor === 'ra') x = x - w;
  if (n !== null) {
    if (n <= 0) return;
    const part = tw([...s].slice(0, n).join(''), size);
    G.drawImage(c, 0, 0, PL + part, c.height, x - PL, y - PT, PL + part, c.height);
    return;
  }
  G.drawImage(c, x - PL, y - PT);
}

// 放大 k 倍的像素字（整块像素）
function bigText(x, y, s, size, k, col, shadow = null, align = 'center') {
  const w = tw(s, size) * k;
  if (align === 'center') x = Math.round(x - w / 2);
  else if (align === 'right') x -= w;
  const draw1 = (cc, dx, dy) => {
    const c = textCanvas(s, size, cc);
    G.drawImage(c, 0, 0, c.width, c.height, dx - PL * k, dy - PT * k, c.width * k, c.height * k);
  };
  if (shadow) draw1(shadow, x + k, y + k);
  draw1(col, x, y);
  return [w, size * k];
}

// 逐字折行（英文按单词折）
function wrap(s, size, width) {
  if (LANG === 'en') return s.split('\n').flatMap((p) => wrapWords(p, size, width));
  const lines = [];
  let cur = '';
  for (const ch of s) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    if (cur && tw(cur + ch, size) > width) { lines.push(cur); cur = ch.trim(); } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

function wrapWords(s, size, width) {
  const lines = [];
  let cur = '';
  for (const wd of s.split(' ')) {
    const cand = (cur + ' ' + wd).trim();
    if (tw(cand, size) > width && cur) { lines.push(cur); cur = wd; } else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines;
}

// —— 精灵 ——
const SPR = window.ASSETS.sprites;

// 英文模式下有 `key:en` 的（印章、对齐部圆印）自动换成英文版
const sprite = (key) => (LANG === 'en' && SPR[key + ':en']) || SPR[key];

function spr(key, x, y) {
  const s = sprite(key);
  if (!s) return false;
  G.drawImage(ATLAS_IMG, s[0], s[1], s[2], s[3], x + s[4], y + s[5], s[2], s[3]);
  return true;
}

// 整屏背景；英文版再贴上横幅、路牌、章程书的英文补丁
function drawBg() {
  G.drawImage(BG_IMG, 0, 0);
  if (LANG === 'en') for (let i = 0; SPR['bg:en:' + i]; i++) spr('bg:en:' + i, 0, 0);
}

// 把一块区域往某个颜色压暗（等同 pp.base.darken）
function darken(alpha, col = C.INK, box = null) {
  G.fillStyle = rgba(col, alpha);
  if (box) G.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  else G.fillRect(0, 0, W, H);
}

function loadImages() {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  const A = window.ASSET_IMAGES;
  return Promise.all([load(A.font), load(A.atlas), load(A.bg), load(A.win)]).then(([f, a, b, w]) => {
    FONT_IMG = f; ATLAS_IMG = a; BG_IMG = b; WIN_IMG = w;
  });
}

// —— 缓动 ——
const clamp = (u) => Math.max(0, Math.min(1, u));
const seg = (t, t0, t1) => (t1 > t0 ? clamp((t - t0) / (t1 - t0)) : +(t >= t1));
const smooth = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) ** 3;
const lerp = (a, b, u) => a + (b - a) * u;
const lerp2 = (p, q, u) => [Math.round(lerp(p[0], q[0], u)), Math.round(lerp(p[1], q[1], u))];
const inBox = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const center = (b) => [Math.floor((b[0] + b[2]) / 2), Math.floor((b[1] + b[3]) / 2)];

function edgePoint(box, toward) {
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const dx = toward[0] - cx, dy = toward[1] - cy;
  if (!dx && !dy) return [Math.round(cx), Math.round(cy)];
  const sx = dx ? (x1 - x0) / 2 / Math.abs(dx) : Infinity;
  const sy = dy ? (y1 - y0) / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy) + 0.02;
  return [Math.round(cx + dx * s), Math.round(cy + dy * s)];
}

// —— 室外小人（脚底中心为 x, y） ——
function tinyPerson(x, y, coat, hat = null, step = 0, skin = K.SKIN) {
  rect(x - 3, y + 1, x + 3, y + 1, K.GROUND_D);
  rect(x - 2, y - 3, x - 1, y - (step ? 1 : 0), K.OUTLINE);
  rect(x + 1, y - 3, x + 2, y - (step ? 0 : 1), K.OUTLINE);
  rect(x - 2, y - 8, x + 2, y - 4, coat);
  rect(x - 1, y - 11, x + 1, y - 9, skin);
  if (hat) rect(x - 1, y - 11, x + 1, y - 11, hat);
}
