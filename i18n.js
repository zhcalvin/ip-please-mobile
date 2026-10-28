'use strict';
// 语言：开局选中文 / English（选语言画面也在这个文件末尾）。中文是原文，英文译文在 en.js 里，以中文原句为键。
//   T('中文')           英文模式下查表；中文模式原样返回
//   T('模板 {0}', x)    先翻模板，再把每个参数也翻一遍填进去
// 英文模式下查不到的中文会在控制台提示一次（也可以跑 node tools/check_en.js 一次查全）。

const LANG_KEY = 'ip-please-lang';
const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
let LANG = initialLang();

function initialLang() {
  try {
    const l = localStorage.getItem(LANG_KEY);
    if (l === 'zh' || l === 'en') return l;
  } catch (e) { /* 隐私模式等 */ }
  return /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en';
}

function T(s, ...args) {
  if (LANG === 'en') s = enText(s);
  return args.length ? s.replace(/\{(\d)\}/g, (_, i) => T(String(args[i]))) : s;
}

const untranslated = new Set();
function enText(s) {
  if (Object.prototype.hasOwnProperty.call(EN, s)) return EN[s];
  if (s.includes(' · ')) return s.split(' · ').map(enText).join(' · ');   // “中国 · 浙江 · 电信”逐段翻
  if (CJK.test(s) && !untranslated.has(s)) { untranslated.add(s); console.warn('[i18n] 缺英文译文：', s); }
  return s;
}

// 台词停留时长按字数算；英文字母的阅读量大约半个汉字
function readLen(s) {
  const chars = [...s];
  return LANG === 'en' ? chars.reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0) : chars.length;
}

function setLang(l) {
  LANG = l;
  try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* 同上 */ }
  applyDomLang();
}

// 页面上的几个 HTML 按钮和提示（不在画布里）
function applyDomLang() {
  const root = document.documentElement;
  root.lang = LANG === 'en' ? 'en' : 'zh-CN';
  document.title = T('IP, PLEASE · 请出示你的 IP');
  for (const el of document.querySelectorAll('#full, #rotate div, #rotate small, #rotate button')) {
    if (el.dataset.zh === undefined) el.dataset.zh = el.textContent;
    el.textContent = T(el.dataset.zh);
  }
  const cv = document.getElementById('game');
  if (cv) cv.setAttribute('aria-label', T('IP, PLEASE 游戏画面'));
  updateMuteLabel();
}

// ———————————————————— 开局：选语言 ————————————————————
// 选语言本身也是一次入境检查：看一眼玩家自己设备的时区和语言，对不上就开个玩笑（只在本地读，不上传）。

const LANG_CARDS = { zh: [146, 128, 310, 216], en: [330, 128, 494, 216] };
const GAG_BOX = [120, 236, 520, 294];
let PICK = null;

const DEVICE = (() => {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* 老浏览器 */ }
  const off = -new Date().getTimezoneOffset() / 60;
  return { tz: tz || `UTC${off >= 0 ? '+' : ''}${off}`, lang: navigator.language || '?', utc8: off === 8 };
})();

function langGag(l) {
  const d = DEVICE;
  if (l === 'en' && d.utc8) {
    return { sub: `TZ: ${d.tz}   VS   LANG: English`, quip: '“Hello, I am 美国人。”', note: 'Approved anyway. §12: we judge the region, not the language.' };
  }
  if (l === 'zh' && !d.utc8 && !/^zh/i.test(d.lang)) {
    return { sub: `时区 TZ: ${d.tz}   VS   语言 LANG: 中文`, quip: '“……我在学中文。”', note: "(\"…I'm learning Chinese.\") 准予入境。" };
  }
  return null;
}

function langClick(x, y) {
  if (PICK) { if (now > PICK.t0 + 0.5) go('intro'); return; }
  const l = ['zh', 'en'].find((k) => inBox(x, y, LANG_CARDS[k]));
  if (!l) return;
  chooseLang(l);
  PICK = { lang: l, t0: now, gag: langGag(l), buzzed: false };
  SFX.play('stamp_approve', 1, 0.03);
}

function updateLangPick() {
  if (!PICK) return;
  if (PICK.gag && !PICK.buzzed && now > PICK.t0 + 0.45) { PICK.buzzed = true; SFX.play('discrepancy'); }
  if (now > PICK.t0 + (PICK.gag ? 3.4 : 1.0)) go('intro');
}

function drawLangCard(l) {
  const box = LANG_CARDS[l], [x0, y0, x1, y1] = box;
  const hover = !PICK && ptr.mouse && inBox(ptr.x, ptr.y, box);
  const up = hover ? 2 : 0, top = y0 - up, bot = y1 - up, cx = (x0 + x1) >> 1;
  rect(x0 + 3, y0 + 3, x1 + 3, y1 + 3, K.INK);
  rect(x0, top, x1, bot, l === 'zh' ? 'rgb(118,32,36)' : K.NAVY);
  outline(x0 + 4, top + 4, x1 - 4, bot - 4, hover ? K.CLAUDE_L : K.GOLD);
  txt(cx, top + 11, l === 'zh' ? '简体中文' : 'LANGUAGE', 8, K.GOLD, 'ma');
  if (l === 'zh') bigText(cx, top + 26, '中文', 12, 3, K.GOLD);
  else bigText(cx, top + 32, 'ENGLISH', 12, 2, K.GOLD);
  txt(cx, bot - 18, l === 'zh' ? 'zh-CN' : 'en-US', 8, K.GOLD, 'ma');
  txt(cx, y1 + 7, l === 'zh' ? '原汁原味 · 梗最多' : 'For REAL Americans', 8, K.GREY, 'ma');
  if (!PICK) return;
  darken(PICK.lang === l ? 0.6 : 0.7, C.INK, [x0, top, x1 + 1, bot + 1]);
  if (PICK.lang !== l) return;
  const s = sprite('stamp:approve');
  G.drawImage(ATLAS_IMG, s[0], s[1], s[2], s[3], cx - s[2], ((top + bot) >> 1) - s[3] + 6, s[2] * 2, s[3] * 2);
}

function drawLangPick() {
  drawBg();
  darken(0.86);
  spr('title_emblem', 298, 12);
  bigText(W / 2, 64, 'IP, PLEASE', 12, 3, K.WHITE, K.INK);
  txt(W / 2, 106, '请出示你的语言 · LANGUAGE, PLEASE', 10, K.CLAUDE_L, 'ma');
  drawLangCard('zh');
  drawLangCard('en');
  const gag = PICK && PICK.gag && now > PICK.t0 + 0.45;
  if (gag) {
    const [x0, y0] = GAG_BOX, cx = (GAG_BOX[0] + GAG_BOX[2]) >> 1;
    rect(...GAG_BOX, K.INK); outline(...GAG_BOX, K.RED);
    txt(cx, y0 + 6, '信息不符  DISCREPANCY', 12, K.RED_L, 'ma');
    txt(cx, y0 + 22, PICK.gag.sub, 10, K.WHITE, 'ma');
    txt(cx, y0 + 34, PICK.gag.quip, 10, K.CLAUDE_L, 'ma');
    txt(cx, y0 + 47, PICK.gag.note, 8, K.GREY, 'ma');
  } else {
    txt(W / 2, 246, `你的设备 YOUR DEVICE    时区 TZ: ${DEVICE.tz}    语言 LANG: ${DEVICE.lang}`, 8, K.GREY, 'ma');
    txt(W / 2, 258, '* 切换语言不会改变你的 IP 归属 · Switching language does not change your IP', 8, K.GREY_D, 'ma');
  }
  txt(W / 2, 302, '建议横屏、打开声音 · 鼠标或手指拖动证件 · 全程约 30 分钟', 8, K.GREY, 'ma');
  txt(W / 2, 313, 'Landscape + sound on · Drag papers with mouse or finger · About 30 min', 8, K.GREY, 'ma');
}
