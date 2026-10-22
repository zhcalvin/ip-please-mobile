'use strict';

const GAME_CLUB_BOX = Object.freeze([188, 8, 268, 34]);

function createGameClub(wx, platform, canShow) {
  let button = null, visible = false, background = false, unavailable = false, previousLayout = '';
  function sync() {
    const show = !background && !unavailable && !!canShow();
    if (!show) {
      if (button && visible) { try { button.hide(); } catch (e) { /* native UI is optional */ } }
      visible = false; return;
    }
    if (!wx.createGameClubButton) { unavailable = true; return; }
    const bounds = platform.game.getBoundingClientRect(), scale = bounds.width / 640;
    const [x0, y0, x1, y1] = GAME_CLUB_BOX;
    const style = {
      left: bounds.left + x0 * scale, top: bounds.top + y0 * scale,
      width: (x1 - x0) * scale, height: (y1 - y0) * scale, lineHeight: (y1 - y0) * scale,
      fontSize: 12 * scale, textAlign: 'center', color: '#e4dfd4', backgroundColor: '#342e29',
      borderColor: '#78695d', borderWidth: Math.max(1, scale), borderRadius: 3 * scale,
    };
    try {
      if (!button) {
        button = wx.createGameClubButton({ type: 'text', text: '游戏圈', icon: 'green', style });
        if (!button || !button.show || !button.hide) throw new Error('Game club unavailable');
      }
      const layout = JSON.stringify(style);
      if (layout !== previousLayout) { Object.assign(button.style, style); previousLayout = layout; }
      if (!visible) button.show();
      visible = true;
    } catch (e) {
      try { if (button) button.hide(); } catch (error) { /* ignore optional control failure */ }
      visible = false; unavailable = true;
    }
  }
  wx.onHide(() => { background = true; sync(); });
  wx.onShow(() => { background = false; sync(); });
  if (wx.onWindowResize) wx.onWindowResize(sync);
  return {
    sync, get visible() { return visible; },
    contains(x, y) { const [x0, y0, x1, y1] = GAME_CLUB_BOX; return visible && x >= x0 && x <= x1 && y >= y0 && y <= y1; },
  };
}

module.exports = { createGameClub, GAME_CLUB_BOX };
