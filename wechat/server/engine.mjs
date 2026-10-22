import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import seedTools from '../shared/seed.js';

const FILES = ['assets.js', 'gfx.js', 'en.js', 'i18n.js', 'docs.js', 'data.js', 'booth.js', 'events.js', 'screens.js'];
export const RULES_VERSION = 'ip-please-settled-v1';

// Only trusted, deployed game scripts enter this VM. Requests are data, never source.
const BRIDGE = new vm.Script(`
  const originalBuildQueue = buildQueue;
  buildQueue = (day) => seedTools.withSeed(seedTools.daySeed(input.seed, day), () => originalBuildQueue(day), Math);
  later = () => {}; // Animation callbacks have no effect on scoring.
  function go(name) { scene = name; }
  newGame();
  if (input.state) Object.assign(S, input.state);
  startDay();
  function queueInfo() {
    return B.queue.map(s => s.type ? {type:s.type} : {
      type:'decision',person:s.person,ok:s.ok,
      canExpose:S.day >= 2 && !!(s.quiz === 'cn' || (s.quiz && s.quiz.first !== undefined)),
      note:!!s.onPlace && Object.values(s.onPlace).includes('note'),
      requeue:s.then === 'jorji5',author:!!s.author
    });
  }
  function replay() {
    let noteAvailable = !!S.flags.sawNote;
    if (S.flags.sawNote && !input.payload.sawNote) throw new Error('note_flag_regression');
    for (const event of input.payload.events) {
      const spec = B.queue[B.idx++];
      if (!spec) throw new Error('too_many_events');
      if (spec.type) {
        if (event.type !== spec.type) throw new Error('event_order');
        if (spec.type === 'rush') {
          if (!Array.isArray(event.choices) || event.choices.length !== RUSH.length) throw new Error('rush_length');
          let wrong = false;
          for (let i=0;i<RUSH.length;i++) {
            const choice=event.choices[i];
            if (choice !== null && choice !== 'approve' && choice !== 'deny') throw new Error('rush_choice');
            if (choice === RUSH[i].ok) B.pay += 2;
            else if (choice !== null) wrong = true;
          }
          B.total += RUSH.length;
          if (wrong) cite([]);
        } else if (spec.type === 'clones') {
          if (!Number.isInteger(event.hits) || !Number.isInteger(event.passed) || event.hits < 0 || event.passed < 0 || event.hits + event.passed !== 10) throw new Error('clone_count');
          B.bonus += event.hits;
          if (event.passed) cite([]);
        } else throw new Error('unknown_event');
        continue;
      }
      if (event.type !== 'decision') throw new Error('event_order');
      const decision=event.decision;
      if (!['approve','deny','detain'].includes(decision) || (S.day === 1 && decision === 'detain')) throw new Error('decision');
      const canExpose = S.day >= 2 && (spec.quiz === 'cn' || (spec.quiz && spec.quiz.first !== undefined));
      if (typeof event.exposed !== 'boolean' || (event.exposed && !canExpose)) throw new Error('invalid_exposure');
      if (spec.onPlace && Object.values(spec.onPlace).includes('note')) noteAvailable = true;
      // The note precedes the only bribe-bearing character on a later day.
      if (noteAvailable && input.payload.sawNote) S.flags.sawNote = true;
      const e = {spec,exposed:event.exposed};
      B.ent=e;
      finish(e,decision); // Original judge, citations, Jorji requeue and ending.
    }
    if (B.idx !== B.queue.length) throw new Error('incomplete_day');
    if (input.payload.sawNote && !noteAvailable) throw new Error('unavailable_note');
    S.flags.sawNote = input.payload.sawNote;
    if (S.flags.ending === 'deny') {
      if (input.payload.ending !== 'deny' || input.payload.spending.length) throw new Error('ending');
      if (input.payload.claimedBalance !== S.savings) throw new Error('balance_mismatch');
      return {state:S,balance:S.savings,finished:true,nextDay:null,settled:false,ledger:ledger()};
    }
    if (input.payload.ending !== undefined) throw new Error('ending');
    initSummary();
    const allowed = SUM.rows.map(row => row[0]);
    SUM.on = {};
    for (const key of input.payload.spending) {
      if (!allowed.includes(key)) throw new Error('spending_key');
      SUM.on[key]=true;
    }
    if (SUM.on.extra && !SUM.on.data) throw new Error('extra_requires_data');
    const balance=sumBalance();
    const beforeSpending=SUM.start+SUM.pay+SUM.bonus+SUM.bribe-SUM.fines-5;
    if (!SUM.final && input.payload.spending.length && balance < 0 && balance < beforeSpending) throw new Error('unaffordable_spending');
    if (balance !== input.payload.claimedBalance) throw new Error('balance_mismatch');
    if (!SUM.final) S.family=familyAfter();
    S.savings=balance;
    const finished=SUM.final || balance < 0;
    const nextDay=finished ? null : S.day+1;
    if (!finished) S.day=nextDay;
    return {state:S,balance,finished,nextDay,settled:true,ledger:ledger()};
  }
  function ledger() {return {pay:B.pay,bonus:B.bonus,bribe:B.bribe,fines:B.fines,cites:B.cites,correct:B.correct,total:B.total};}
  JSON.stringify(input.payload ? replay() : {state:S,queue:queueInfo(),rush:RUSH.map(r=>r.ok)});
`, { filename: 'trusted-ranking-replay.js' });

export function createEngine(sourceDir) {
  const scripts = FILES.map(file => new vm.Script(readFileSync(resolve(sourceDir, file), 'utf8'), { filename: file }));
  function evaluate(input) {
    const context = vm.createContext({
      input: JSON.parse(JSON.stringify(input)), seedTools,
      navigator: { language: 'zh-CN' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      console: { warn() {}, log() {} },
      SFX: new Proxy({}, { get: () => () => {} }),
      document: { createElement: () => ({ getContext: () => ({}) }) },
    }, { codeGeneration: { strings: false, wasm: false } });
    context.window = context;
    for (const script of scripts) script.runInContext(context, { timeout: 500 });
    return JSON.parse(BRIDGE.runInContext(context, { timeout: 500 }));
  }
  return {
    initialState(seed) { return evaluate({ seed }).state; },
    // Exposed for server tests only, never through an HTTP endpoint.
    inspect(seed, state) { return evaluate({ seed, state }); },
    replay(seed, state, payload) { return evaluate({ seed, state, payload }); },
  };
}
