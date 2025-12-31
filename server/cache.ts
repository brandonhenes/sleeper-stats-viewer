import Database from "better-sqlite3";
import path from "path";

// SQLite database for caching Sleeper data
const DB_PATH = path.join(process.cwd(), "sleeper.db");
const db = new Database(DB_PATH);

// Run migrations on startup
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leagues (
    league_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    season INTEGER NOT NULL,
    sport TEXT NOT NULL,
    status TEXT NOT NULL,
    total_rosters INTEGER,
    previous_league_id TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rosters (
    league_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    roster_id INTEGER NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (league_id, owner_id)
  );

  CREATE TABLE IF NOT EXISTS roster_players (
    league_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (league_id, owner_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS user_leagues (
    user_id TEXT NOT NULL,
    league_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, league_id)
  );

  CREATE INDEX IF NOT EXISTS idx_leagues_season ON leagues(season);
  CREATE INDEX IF NOT EXISTS idx_rosters_owner ON rosters(owner_id);
  CREATE INDEX IF NOT EXISTS idx_user_leagues_user ON user_leagues(user_id);
`);

// Prepare statements for performance
const stmts = {
  upsertUser: db.prepare(`
    INSERT INTO users (user_id, username, display_name, avatar, updated_at)
    VALUES (@user_id, @username, @display_name, @avatar, @updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      avatar = excluded.avatar,
      updated_at = excluded.updated_at
  `),

  getUserByUsername: db.prepare(`
    SELECT * FROM users WHERE username = ? COLLATE NOCASE
  `),

  getUserById: db.prepare(`
    SELECT * FROM users WHERE user_id = ?
  `),

  upsertLeague: db.prepare(`
    INSERT INTO leagues (league_id, name, season, sport, status, total_rosters, previous_league_id, updated_at)
    VALUES (@league_id, @name, @season, @sport, @status, @total_rosters, @previous_league_id, @updated_at)
    ON CONFLICT(league_id) DO UPDATE SET
      name = excluded.name,
      season = excluded.season,
      sport = excluded.sport,
      status = excluded.status,
      total_rosters = excluded.total_rosters,
      previous_league_id = excluded.previous_league_id,
      updated_at = excluded.updated_at
  `),

  upsertUserLeague: db.prepare(`
    INSERT INTO user_leagues (user_id, league_id, updated_at)
    VALUES (@user_id, @league_id, @updated_at)
    ON CONFLICT(user_id, league_id) DO UPDATE SET
      updated_at = excluded.updated_at
  `),

  getLeaguesForUser: db.prepare(`
    SELECT l.* FROM leagues l
    INNER JOIN user_leagues ul ON l.league_id = ul.league_id
    WHERE ul.user_id = ?
    ORDER BY l.name ASC, l.season DESC
  `),

  upsertRoster: db.prepare(`
    INSERT INTO rosters (league_id, owner_id, roster_id, wins, losses, ties, updated_at)
    VALUES (@league_id, @owner_id, @roster_id, @wins, @losses, @ties, @updated_at)
    ON CONFLICT(league_id, owner_id) DO UPDATE SET
      roster_id = excluded.roster_id,
      wins = excluded.wins,
      losses = excluded.losses,
      ties = excluded.ties,
      updated_at = excluded.updated_at
  `),

  getRosterForUserInLeague: db.prepare(`
    SELECT * FROM rosters WHERE league_id = ? AND owner_id = ?
  `),

  getRostersForUser: db.prepare(`
    SELECT r.* FROM rosters r
    INNER JOIN user_leagues ul ON r.league_id = ul.league_id
    WHERE r.owner_id = ? AND ul.user_id = ?
  `),

  deleteRosterPlayers: db.prepare(`
    DELETE FROM roster_players WHERE league_id = ? AND owner_id = ?
  `),

  insertRosterPlayer: db.prepare(`
    INSERT INTO roster_players (league_id, owner_id, player_id, updated_at)
    VALUES (@league_id, @owner_id, @player_id, @updated_at)
  `),

  getLastSyncTime: db.prepare(`
    SELECT MAX(updated_at) as last_sync FROM user_leagues WHERE user_id = ?
  `),
};

export interface CachedUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  updated_at: number;
}

export interface CachedLeague {
  league_id: string;
  name: string;
  season: number;
  sport: string;
  status: string;
  total_rosters: number | null;
  previous_league_id: string | null;
  updated_at: number;
}

export interface CachedRoster {
  league_id: string;
  owner_id: string;
  roster_id: number;
  wins: number;
  losses: number;
  ties: number;
  updated_at: number;
}

// 12 hours in milliseconds
const STALE_THRESHOLD = 12 * 60 * 60 * 1000;

export const cache = {
  upsertUser(user: { user_id: string; username: string; display_name: string; avatar?: string | null }) {
    stmts.upsertUser.run({
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      avatar: user.avatar || null,
      updated_at: Date.now(),
    });
  },

  getUserByUsername(username: string): CachedUser | undefined {
    return stmts.getUserByUsername.get(username) as CachedUser | undefined;
  },

  getUserById(userId: string): CachedUser | undefined {
    return stmts.getUserById.get(userId) as CachedUser | undefined;
  },

  upsertLeague(userId: string, league: {
    league_id: string;
    name: string;
    season: string | number;
    sport: string;
    status: string;
    total_rosters?: number;
    previous_league_id?: string;
  }) {
    const now = Date.now();
    stmts.upsertLeague.run({
      league_id: league.league_id,
      name: league.name,
      season: typeof league.season === "string" ? parseInt(league.season, 10) : league.season,
      sport: league.sport,
      status: league.status,
      total_rosters: league.total_rosters || null,
      previous_league_id: league.previous_league_id || null,
      updated_at: now,
    });
    stmts.upsertUserLeague.run({
      user_id: userId,
      league_id: league.league_id,
      updated_at: now,
    });
  },

  getLeaguesForUser(userId: string): CachedLeague[] {
    return stmts.getLeaguesForUser.all(userId) as CachedLeague[];
  },

  upsertRoster(roster: {
    league_id: string;
    owner_id: string;
    roster_id: number;
    wins: number;
    losses: number;
    ties: number;
  }) {
    stmts.upsertRoster.run({
      ...roster,
      updated_at: Date.now(),
    });
  },

  getRosterForUserInLeague(leagueId: string, ownerId: string): CachedRoster | undefined {
    return stmts.getRosterForUserInLeague.get(leagueId, ownerId) as CachedRoster | undefined;
  },

  getRostersForUser(userId: string): CachedRoster[] {
    return stmts.getRostersForUser.all(userId, userId) as CachedRoster[];
  },

  updateRosterPlayers(leagueId: string, ownerId: string, playerIds: string[]) {
    const now = Date.now();
    stmts.deleteRosterPlayers.run(leagueId, ownerId);
    for (const playerId of playerIds) {
      stmts.insertRosterPlayer.run({
        league_id: leagueId,
        owner_id: ownerId,
        player_id: playerId,
        updated_at: now,
      });
    }
  },

  getLastSyncTime(userId: string): number | null {
    const result = stmts.getLastSyncTime.get(userId) as { last_sync: number | null } | undefined;
    return result?.last_sync || null;
  },

  isDataStale(userId: string): boolean {
    const lastSync = this.getLastSyncTime(userId);
    if (!lastSync) return true;
    return Date.now() - lastSync > STALE_THRESHOLD;
  },
};

export default cache;
