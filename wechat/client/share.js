'use strict';

const { GAME_NAME } = require('./branding');

const CARD_WIDTH = 500, CARD_HEIGHT = 400;
const PALETTE = { ink: '#514566', lavender: '#e9e1ff', pink: '#ffd7e8', cyan: '#bdeef2', paper: '#fffcff', coral: '#d76291' };

function snapshotSummary(value) {
  const result = {};
  for (const key of ['day', 'balance', 'correct', 'total']) {
    if (!value || !Number.isSafeInteger(value[key])) throw new Error('战报数据暂不可用');
    result[key] = value[key];
  }
  if (result.day < 1 || result.day > 6 || result.total < 0 || result.correct < 0 || result.correct > result.total) throw new Error('战报数据暂不可用');
  return Object.freeze(result);
}

function shareMetadata(snapshot, imageUrl) {
  return {
    title: `${GAME_NAME}｜DAY ${snapshot.day} 结余 ${snapshot.balance} Token`,
    query: 'from=daily-report',
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function drawShareCard(ctx, snapshot) {
  const { ink, lavender, pink, cyan, paper, coral } = PALETTE;
  const round = (x, y, w, h, r, fill, stroke) => {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  };
  const ellipse = (x, y, rx, ry, fill, stroke) => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  };
  const label = (value, x, y, size, color = ink, align = 'left', bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(String(value), x, y);
  };
  const star = (x, y, radius, color) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 4, r = i % 2 ? radius * 0.28 : radius;
      if (i) ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r); else ctx.moveTo(x, y - r);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  };
  ctx.fillStyle = lavender; ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ellipse(12, 66, 118, 140, pink); ellipse(487, 365, 140, 100, cyan);
  round(17, 17, 466, 366, 23, paper, ink);
  round(31, 31, 438, 64, 16, pink);
  label(GAME_NAME, 52, 58, 27, ink, 'left', true);
  label('今日下班战报', 52, 80, 12, coral);
  round(361, 45, 92, 31, 12, paper); label(`DAY ${snapshot.day}`, 407, 61, 17, ink, 'center', true);
  star(457, 113, 10, coral); star(46, 330, 9, '#8dcbd1'); star(218, 126, 7, '#ad99d8');

  // Original chibi auditor: lavender hair, oversized cap and a tiny stamp.
  ellipse(135, 310, 83, 12, '#eee9f5');
  round(91, 258, 89, 48, 18, '#a79bd3', ink);
  round(102, 295, 24, 18, 8, ink); round(147, 295, 24, 18, 8, ink);
  ellipse(135, 205, 73, 76, '#b5a4e2', ink);
  ellipse(135, 214, 60, 57, '#ffe7db', ink);
  ctx.beginPath(); ctx.moveTo(77, 195); ctx.lineTo(89, 156); ctx.lineTo(174, 153); ctx.lineTo(195, 199); ctx.lineTo(159, 180); ctx.lineTo(145, 204); ctx.lineTo(129, 179); ctx.lineTo(113, 199); ctx.lineTo(103, 179); ctx.closePath(); ctx.fillStyle = '#b5a4e2'; ctx.fill();
  round(67, 134, 136, 31, 14, ink); round(87, 111, 96, 42, 14, '#8073ad', ink);
  star(135, 132, 12, cyan);
  ellipse(111, 217, 8, 13, ink); ellipse(160, 217, 8, 13, ink);
  ellipse(113, 212, 2.5, 4, paper); ellipse(162, 212, 2.5, 4, paper);
  ellipse(96, 237, 11, 5, pink); ellipse(175, 237, 11, 5, pink);
  ctx.beginPath(); ctx.moveTo(127, 238); ctx.quadraticCurveTo(136, 249, 145, 238); ctx.strokeStyle = ink; ctx.lineWidth = 2.5; ctx.stroke();
  round(117, 262, 40, 31, 7, paper, ink); star(137, 277, 8, coral);
  ellipse(92, 273, 12, 13, '#ffe7db', ink); ellipse(179, 273, 12, 13, '#ffe7db', ink);
  round(172, 255, 29, 11, 4, cyan, ink); round(180, 241, 13, 17, 4, ink);
  label('今天也辛苦啦！', 136, 334, 14, coral, 'center', true);

  label('扣除所选开销后的结余', 327, 136, 14, ink, 'center');
  label(snapshot.balance, 327, 187, 45, coral, 'center', true);
  label('TOKEN', 327, 226, 15, '#8b7aa8', 'center', true);
  round(239, 253, 180, 56, 14, lavender);
  label(`今日审查 ${snapshot.total} 位`, 329, 271, 14, ink, 'center');
  label(`正确判断 ${snapshot.correct} 位`, 329, 292, 14, ink, 'center');
  label('一起来当边境审查员', 327, 333, 15, ink, 'center', true);
  label('当前选项预览 · 点击继续后结算', 250, 363, 11, '#8b7aa8', 'center');
}

function createShare(wx, changed = () => {}) {
  let snapshot = null, canvas = null, exporting = false;
  // The native menu share should use the same display name as the in-game card.
  try {
    if (wx.onShareAppMessage) wx.onShareAppMessage(() => ({ title: GAME_NAME, query: 'from=menu' }));
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
  } catch (e) { /* Older clients can continue playing without a custom share menu. */ }
  const notify = (title) => { if (wx.showToast) wx.showToast({ title, icon: 'none', duration: 2400 }); };
  function show(value) {
    try { snapshot = snapshotSummary(value); } catch (e) { notify(e.message); return false; }
    canvas = null;
    try { canvas = wx.createCanvas(); canvas.width = CARD_WIDTH; canvas.height = CARD_HEIGHT; drawShareCard(canvas.getContext('2d'), snapshot); }
    catch (e) { canvas = null; }
    changed(); return true;
  }
  async function send() {
    if (!snapshot || exporting) return false;
    if (!wx.shareAppMessage) { notify('当前微信版本暂不支持转发'); return false; }
    const captured = snapshot;
    exporting = true; changed();
    let imageUrl;
    const options = { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT, destWidth: CARD_WIDTH, destHeight: CARD_HEIGHT, fileType: 'png' };
    try {
      if (canvas && canvas.toTempFilePathSync) imageUrl = canvas.toTempFilePathSync(options);
      else if (canvas && canvas.toTempFilePath) imageUrl = await new Promise((resolve, reject) => canvas.toTempFilePath({ ...options, success: (result) => resolve(result.tempFilePath), fail: reject }));
    } catch (e) { /* Export failure still permits a text-only manual share. */ }
    try {
      if (!imageUrl) notify('图片暂不可用，改用文字转发');
      wx.shareAppMessage(shareMetadata(captured, imageUrl));
      return true; // API invoked; this does not claim the message was sent.
    } catch (e) { notify('转发暂不可用，可稍后重试'); return false; }
    finally { exporting = false; changed(); }
  }
  return { show, send, get snapshot() { return snapshot; }, get canvas() { return canvas; }, get exporting() { return exporting; } };
}

module.exports = { createShare, drawShareCard, snapshotSummary, shareMetadata, CARD_WIDTH, CARD_HEIGHT };
