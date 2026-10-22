import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');

export function createStore(path, { maxPlayers = 100000, maxRuns = 200000 } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA busy_timeout=3000;
    PRAGMA wal_autocheckpoint=256;
    PRAGMA max_page_count=131072;
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id,created_at);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS login_codes (
      code_hash TEXT PRIMARY KEY, used_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), seed TEXT NOT NULL,
      rules_version TEXT NOT NULL, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 6),
      state TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS runs_player ON runs(player_id,created_at);
    CREATE INDEX IF NOT EXISTS runs_updated ON runs(updated_at);
    CREATE TABLE IF NOT EXISTS settlements (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, day INTEGER NOT NULL,
      payload_hash TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(run_id,day)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bests (
      player_id TEXT PRIMARY KEY REFERENCES players(id), score INTEGER NOT NULL CHECK(score>=0),
      day INTEGER NOT NULL, achieved_at INTEGER NOT NULL, run_id TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS bests_order ON bests(score DESC,achieved_at,player_id);
  `);
  const statements = new Map();
  const sql = text => {
    if (!statements.has(text)) statements.set(text, db.prepare(text));
    return statements.get(text);
  };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function best(playerId) {
    const row = sql(`SELECT b.*,p.name,
      (SELECT COUNT(*)+1 FROM bests a WHERE a.score>b.score OR
        (a.score=b.score AND (a.achieved_at<b.achieved_at OR (a.achieved_at=b.achieved_at AND a.player_id<b.player_id)))) AS rank
      FROM bests b JOIN players p ON p.id=b.player_id WHERE b.player_id=?`).get(playerId);
    return entry(row);
  }
  function entry(row, rank) {
    return row ? { rank: rank ?? row.rank, playerId: row.player_id, name: row.name,
      score: row.score, day: row.day, achievedAt: new Date(row.achieved_at).toISOString() } : null;
  }
  return {
    close: () => db.close(),
    login(identityHash, codeHash, now, ttlMs) {
      return transaction(() => {
        sql('DELETE FROM sessions WHERE expires_at<=?').run(now);
        sql('DELETE FROM login_codes WHERE used_at<?').run(now - 10 * 60 * 1000);
        if (sql('SELECT 1 FROM login_codes WHERE code_hash=?').get(codeHash)) return { error: 'code_used' };
        let player = sql('SELECT id,name FROM players WHERE identity_hash=?').get(identityHash);
        if (!player) {
          if (sql('SELECT COUNT(*) AS n FROM players').get().n >= maxPlayers) return { error: 'capacity' };
          const id = randomUUID();
          const name = `审查员 ${id.slice(0, 8).toUpperCase()}`;
          sql('INSERT INTO players(id,identity_hash,name,created_at) VALUES(?,?,?,?)').run(id, identityHash, name, now);
          player = { id, name };
        }
        sql('INSERT INTO login_codes(code_hash,used_at) VALUES(?,?)').run(codeHash, now);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = now + ttlMs;
        sql('INSERT INTO sessions(token_hash,player_id,expires_at,created_at) VALUES(?,?,?,?)').run(digest(token), player.id, expiresAt, now);
        sql('DELETE FROM sessions WHERE player_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE player_id=? ORDER BY created_at DESC,rowid DESC LIMIT 5)').run(player.id, player.id);
        return { token, player, expiresAt: new Date(expiresAt).toISOString() };
      });
    },
    session(token, now) {
      return sql('SELECT p.id,p.name FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), now);
    },
    newRun(playerId, seed, state, rulesVersion, now) {
      return transaction(() => {
        // Expiring run transcripts bounds disk growth without deleting personal records.
        sql('DELETE FROM runs WHERE updated_at<?').run(now - 30 * 86400000);
        if (sql('SELECT COUNT(*) AS n FROM runs').get().n >= maxRuns) return { error: 'capacity' };
        if (sql('SELECT COUNT(*) AS n FROM runs WHERE player_id=? AND created_at>?').get(playerId, now - 86400000).n >= 30) return { error: 'run_limit' };
        const id = randomUUID();
        sql('INSERT INTO runs(id,player_id,seed,rules_version,day,state,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?)')
          .run(id, playerId, seed, rulesVersion, JSON.stringify(state), now, now);
        return { runId: id, seed, rulesVersion, day: 1, state };
      });
    },
    run(id) { return sql('SELECT * FROM runs WHERE id=?').get(id); },
    settlement(id, day) { return sql('SELECT payload_hash,result FROM settlements WHERE run_id=? AND day=?').get(id, day); },
    settle(run, payload, payloadHash, replay, now) {
      return transaction(() => {
        if (replay.settled && replay.balance >= 0) {
          sql(`INSERT INTO bests(player_id,score,day,achieved_at,run_id) VALUES(?,?,?,?,?)
            ON CONFLICT(player_id) DO UPDATE SET score=excluded.score,day=excluded.day,
            achieved_at=excluded.achieved_at,run_id=excluded.run_id WHERE excluded.score>bests.score`)
            .run(run.player_id, replay.balance, payload.day, now, run.id);
        }
        const result = { accepted: true, day: payload.day, balance: replay.balance,
          best: best(run.player_id), nextDay: replay.nextDay, finished: replay.finished };
        sql('UPDATE runs SET day=?,state=?,finished=?,updated_at=? WHERE id=?')
          .run(replay.nextDay ?? payload.day, JSON.stringify(replay.state), replay.finished ? 1 : 0, now, run.id);
        sql('INSERT INTO settlements(run_id,day,payload_hash,result) VALUES(?,?,?,?)')
          .run(run.id, payload.day, payloadHash, JSON.stringify(result));
        return result;
      });
    },
    leaderboard(limit, playerId) {
      const rows = sql('SELECT b.*,p.name FROM bests b JOIN players p ON p.id=b.player_id ORDER BY b.score DESC,b.achieved_at,b.player_id LIMIT ?').all(limit);
      return { entries: rows.map((row, i) => entry(row, i + 1)), ...(playerId ? { me: best(playerId) } : {}) };
    },
  };
}
