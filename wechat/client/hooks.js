// This file is appended inside the generated shared game scope, after main.js.
// It deliberately does not change the original browser/Android/iOS game scripts.
const { createRanking } = require('./client/ranking');
const { createUI } = require('./client/ui');
const { createShare } = require('./client/share');
const { createGameClub } = require('./client/gameclub');
const { daySeed, withSeed } = require('./client/seed');
let wechatUI = null, gameClub = null, dayTranscript = [], rushChoices = null;
const ranking = createRanking(wx, config, () => { if (wechatUI && (wechatUI.open || gamePaused)) wechatUI.repaint(); });
const sharing = createShare(wx, () => { if (wechatUI) wechatUI.repaint(); });
wechatUI = createUI(platform, ranking, {
  scene: () => scene, muted: () => SFX.muted, toggleMute,
  summary: () => ({ day: S.day, balance: sumBalance(), correct: SUM.correct, total: SUM.total }),
  nativeControlHit: (x, y) => gameClub && gameClub.contains(x, y),
  pause: (value) => { setNativePaused(value); if (gameClub) gameClub.sync(); },
}, sharing);
gameClub = createGameClub(wx, platform, () => ['title', 'summary', 'end', 'over'].includes(scene) && !gamePaused && !wechatUI.open);

const originalBuildQueue = buildQueue;
buildQueue = (day) => ranking.active && !ranking.active.finished
  ? withSeed(daySeed(ranking.active.seed, day), () => originalBuildQueue(day))
  : originalBuildQueue(day);

const originalStartDay = startDay;
startDay = () => { dayTranscript = []; rushChoices = null; return originalStartDay(); };
const originalFinish = finish;
finish = (e, decision) => {
  if (B.ent === e && !e.noJudge) dayTranscript.push({ type: 'decision', decision, exposed: !!e.exposed });
  return originalFinish(e, decision);
};
const originalStartRush = startRush;
startRush = () => { rushChoices = RUSH.map(() => null); return originalStartRush(); };
const originalRushPick = rushPick;
rushPick = (choice) => {
  if (B.event && B.event.type === 'rush' && !B.event.lock && B.ent && rushChoices) rushChoices[B.event.i] = choice;
  return originalRushPick(choice);
};
const originalRushEnd = rushEnd;
rushEnd = () => { dayTranscript.push({ type: 'rush', choices: rushChoices || RUSH.map(() => null) }); return originalRushEnd(); };
const originalUpdateClones = updateClones;
updateClones = () => {
  const ev = B.event, done = ev.done;
  originalUpdateClones();
  if (!done && ev.done) dayTranscript.push({ type: 'clones', hits: ev.hits, passed: ev.passed });
};

const originalSummaryClick = summaryClick;
summaryClick = (x, y) => {
  const submit = st() >= 1.2 && inBox(x, y, CONTINUE_BTN);
  const payload = submit ? {
    day: S.day, events: dayTranscript.slice(), spending: SUM.rows.filter(([k]) => SUM.on[k]).map(([k]) => k),
    sawNote: !!S.flags.sawNote, claimedBalance: sumBalance(),
  } : null;
  originalSummaryClick(x, y);
  if (payload) {
    const finished = scene === 'end' || scene === 'over';
    ranking.settle(payload, finished ? null : S, finished);
  }
};
const originalAfterAuthor = afterAuthor;
afterAuthor = (decision) => {
  originalAfterAuthor(decision);
  if (decision !== 'approve') ranking.settle({ day: S.day, events: dayTranscript.slice(), spending: [], sawNote: !!S.flags.sawNote, claimedBalance: S.savings, ending: 'deny' }, null, true);
};

async function startWechatGame(continuing, callback) {
  if (continuing) ranking.resume(continuing);
  else {
    wechatUI.setBusy(true);
    await ranking.start();
    wechatUI.setBusy(false);
  }
  callback();
  if (ranking.state.error && wx.showToast) wx.showToast({ title: '暂以练习模式开始，不影响游戏', icon: 'none', duration: 2500 });
}
const originalTitleClick = titleClick;
titleClick = (x, y) => {
  if (st() < 1.6) return;
  const save = loadSave();
  if (save && !inBox(x, y, CONTINUE_TITLE) && !inBox(x, y, NEWGAME_TITLE)) return;
  void startWechatGame(save && inBox(x, y, CONTINUE_TITLE) ? save : null, () => originalTitleClick(x, y));
};
const originalSceneClick = sceneClick;
sceneClick = (x, y) => {
  if ((scene === 'end' || scene === 'over') && st() > 1.5 && inBox(x, y, RESTART_BTN)) {
    void startWechatGame(null, () => originalSceneClick(x, y)); return;
  }
  return originalSceneClick(x, y);
};
const originalRender = render;
render = () => { originalRender(); platform.present(wechatUI.draw); gameClub.sync(); };
window.addEventListener('resize', () => platform.present(wechatUI.draw));
window.addEventListener('audiointerruption', ({ paused }) => SFX.setPaused(paused || gamePaused));
wx.onShow(() => { wechatUI.repaint(); void ranking.flush(); });
if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(({ isConnected }) => { if (isConnected) void ranking.flush(); });
boot();
// Also retry persisted results on launch, without requiring a new game.
void ranking.flush();
return { ranking, ui: wechatUI, platform, getScene: () => scene, getState: () => JSON.parse(JSON.stringify(S)) };
