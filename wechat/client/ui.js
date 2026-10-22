'use strict';

function createUI(platform, ranking, game, share = null) {
  let open = false, busy = false, page = 0, sharing = false;
  const button = (ctx, box, label, accent = false) => {
    ctx.fillStyle = accent ? '#783124' : '#342e29'; ctx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    ctx.strokeStyle = accent ? '#e89c74' : '#78695d'; ctx.strokeRect(box[0] + 0.5, box[1] + 0.5, box[2] - box[0] - 1, box[3] - box[1] - 1);
    text(ctx, label, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, 11, '#e4dfd4', 'center');
  };
  const text = (ctx, value, x, y, size = 12, color = '#e4dfd4', align = 'left') => {
    ctx.font = `${size}px sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.fillText(String(value), x, y);
  };
  const clip = (value, limit = 15) => { const chars = [...String(value)]; return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : chars.join(''); };
  const hit = (x, y, box) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const access = [8, 8, 96, 34], sound = [104, 8, 180, 34];
  const shareEntry = [60, 318, 244, 346], shareSend = [326, 320, 510, 350], shareCancel = [130, 320, 314, 350];
  const close = [552, 18, 620, 46], refresh = [452, 18, 540, 46];
  const prev = [430, 309, 510, 337], next = [520, 309, 620, 337];
  const canAccess = () => ['title', 'summary', 'end', 'over'].includes(game.scene());
  function draw(ctx) {
    if (sharing && share) {
      ctx.fillStyle = 'rgba(35,27,49,0.96)'; ctx.fillRect(0, 0, 640, 360);
      if (share.canvas) ctx.drawImage(share.canvas, 130, 8, 380, 304);
      else {
        const snapshot = share.snapshot;
        ctx.fillStyle = '#f7f0ff'; ctx.fillRect(130, 8, 380, 304);
        text(ctx, '今日下班战报', 320, 90, 24, '#514566', 'center');
        text(ctx, `DAY ${snapshot.day} · ${snapshot.balance} Token`, 320, 160, 22, '#d76291', 'center');
        text(ctx, '当前选项预览 · 点击继续后结算', 320, 240, 12, '#514566', 'center');
      }
      button(ctx, shareCancel, '返回结算'); button(ctx, shareSend, share.exporting ? '正在准备…' : '✦ 转发给好友', true);
      return;
    }
    if (!open && !busy) {
      if (canAccess()) {
        button(ctx, access, '全国排行榜', true); button(ctx, sound, game.muted() ? '声音：关' : '声音：开');
        if (share && game.scene() === 'summary') {
          ctx.fillStyle = '#e9e1ff'; ctx.fillRect(shareEntry[0], shareEntry[1], shareEntry[2] - shareEntry[0], shareEntry[3] - shareEntry[1]);
          text(ctx, '✦ 今日战报 · 转发', 152, 332, 12, '#65476e', 'center');
        }
        if (game.scene() === 'title') text(ctx, clip(ranking.state.status, 42), 320, 337, 10, '#b6a99c', 'center');
      }
      return;
    }
    ctx.fillStyle = 'rgba(22,19,19,0.98)'; ctx.fillRect(0, 0, 640, 360);
    if (busy) {
      text(ctx, '正在连接全国排行…', 320, 154, 20, '#e89c74', 'center');
      text(ctx, '连接成功后开始挑战；服务不可用时自动进入练习模式', 320, 190, 12, '#b6a99c', 'center');
      return;
    }
    const state = ranking.state;
    text(ctx, '全国 Token 排行榜', 20, 32, 20, '#e89c74');
    button(ctx, refresh, state.loading ? '刷新中…' : '刷新'); button(ctx, close, '返回');
    text(ctx, '按每日结算后的最高剩余 Token 排名 · 每人保留最佳成绩', 20, 62, 11, '#b6a99c');
    ctx.fillStyle = '#342e29'; ctx.fillRect(20, 78, 600, 22);
    text(ctx, '名次', 34, 89, 11); text(ctx, '审查员', 100, 89, 11); text(ctx, '最高结余', 460, 89, 11, '#e4dfd4', 'right'); text(ctx, '结算日', 578, 89, 11, '#e4dfd4', 'right');
    const rows = state.entries.slice(page * 10, page * 10 + 10);
    if (!rows.length) text(ctx, state.loading ? '正在加载…' : '还没有成绩，来成为第一位审查员吧', 320, 178, 14, '#b6a99c', 'center');
    rows.forEach((row, index) => {
      const y = 112 + index * 17;
      if (index % 2 === 0) { ctx.fillStyle = '#211c19'; ctx.fillRect(20, y - 8, 600, 17); }
      const mine = state.me && row.playerId === state.me.playerId;
      const color = mine ? '#e89c74' : '#e4dfd4';
      text(ctx, row.rank, 42, y, 12, color, 'center');
      text(ctx, clip(row.name || '审查员', 23), 100, y, 12, color);
      text(ctx, `${row.score} token`, 460, y, 12, color, 'right');
      text(ctx, `DAY ${row.day}`, 578, y, 11, '#b6a99c', 'right');
    });
    const me = state.me;
    text(ctx, me ? `我的最佳：第 ${me.rank} 名 · ${me.score} token · DAY ${me.day}` : '我的最佳：尚无已验证成绩，从头开始可参加排行', 20, 290, 12, '#e89c74');
    const status = state.error || (ranking.pendingCount ? `本机有 ${ranking.pendingCount} 天成绩等待联网提交` : '成绩由服务器按对局记录重新计算');
    text(ctx, clip(status, 42), 20, 318, 10, state.error ? '#de8b7c' : '#b6a99c');
    button(ctx, prev, '上一页'); button(ctx, next, `下一页 ${page + 1}/2`);
    text(ctx, '全国榜仅使用匿名审查员编号，不读取微信昵称、头像或位置', 20, 347, 10, '#968f88');
  }
  const repaint = () => platform.present(draw);
  function show() { open = true; page = 0; game.pause(true); repaint(); void ranking.refresh(); }
  platform.setInputHandler((event, ev) => {
    if (busy) return true;
    const touch = (ev.changedTouches || [])[0];
    if (!touch) return open || sharing;
    const [x, y] = platform.point({ clientX: touch.clientX === undefined ? touch.pageX : touch.clientX, clientY: touch.clientY === undefined ? touch.pageY : touch.clientY });
    if (game.nativeControlHit && game.nativeControlHit(x, y)) return true;
    if (sharing) {
      if (event === 'pointerdown' && !share.exporting) {
        if (hit(x, y, shareCancel)) { sharing = false; game.pause(false); repaint(); }
        else if (hit(x, y, shareSend)) void share.send();
      }
      return true;
    }
    if (open) {
      if (event === 'pointerdown') {
        if (hit(x, y, close)) { open = false; game.pause(false); repaint(); }
        else if (hit(x, y, refresh)) void ranking.refresh();
        else if (hit(x, y, prev)) { page = Math.max(0, page - 1); repaint(); }
        else if (hit(x, y, next)) { page = Math.min(1, page + 1); repaint(); }
      }
      return true;
    }
    if (event === 'pointerdown' && canAccess()) {
      if (share && game.scene() === 'summary' && hit(x, y, shareEntry)) {
        if (share.show(game.summary()) !== false) { sharing = true; game.pause(true); repaint(); }
        return true;
      }
      if (hit(x, y, access)) { show(); return true; }
      if (hit(x, y, sound)) { game.toggleMute(); repaint(); return true; }
    }
    return false;
  });
  return { draw, repaint, show, get open() { return open || sharing; }, setBusy(value) { busy = value; game.pause(value); repaint(); } };
}

module.exports = { createUI };
