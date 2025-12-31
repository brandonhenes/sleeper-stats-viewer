import Database from "better-sqlite3";
import path from "path";

// SQLite database for caching Sleeper data
const DB_PATH = path.join(process.cwd(), "sleeper.db");
const db = new Database(DB_PATH);

// Enable WAL mode and busy timeout for concurrent access
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// Run migrations on startup
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
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
    group_id TEXT,
    raw_json TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rosters (
    league_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    roster_id INTEGER NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    fpts REAL DEFAULT 0,
    fpts_against REAL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS league_users (
    league_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    team_name TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (league_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS sync_jobs (
    job_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    status TEXT NOT NULL,
    step TEXT,
    detail TEXT,
    leagues_total INTEGER DEFAULT 0,
    leagues_done INTEGER DEFAULT 0,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS h2h_season (
    league_id TEXT NOT NULL,
    my_owner_id TEXT NOT NULL,
    opp_owner_id TEXT NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    ties INTEGER DEFAULT 0,
    pf REAL DEFAULT 0,
    pa REAL DEFAULT 0,
    games INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (league_id, my_owner_id, opp_owner_id)
  );

  CREATE TABLE IF NOT EXISTS group_overrides (
    league_id TEXT PRIMARY KEY,
    forced_group_id TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leagues_season ON leagues(season);
  CREATE INDEX IF NOT EXISTS idx_leagues_group ON leagues(group_id);
  CREATE INDEX IF NOT EXISTS idx_rosters_owner ON rosters(owner_id);
  CREATE INDEX IF NOT EXISTS idx_user_leagues_user ON user_leagues(user_id);
  CREATE INDEX IF NOT EXISTS idx_league_users_user ON league_users(user_id);
  CREATE INDEX IF NOT EXISTS idx_sync_jobs_username ON sync_jobs(username);
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
    INSERT INTO leagues (league_id, name, season, sport, status, total_rosters, previous_league_id, group_id, raw_json, updated_at)
    VALUES (@league_id, @name, @season, @sport, @status, @total_rosters, @previous_league_id, @group_id, @raw_json, @updated_at)
    ON CONFLICT(league_id) DO UPDATE SET
      name = excluded.name,
      season = excluded.season,
      sport = excluded.sport,
      status = excluded.status,
      total_rosters = excluded.total_rosters,
      previous_league_id = excluded.previous_league_id,
      group_id = excluded.group_id,
      raw_json = excluded.raw_json,
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

  getLeagueById: db.prepare(`SELECT * FROM leagues WHERE league_id = ?`),

  getAllLeaguesMap: db.prepare(`SELECT league_id, previous_league_id FROM leagues`),

  updateLeagueGroupId: db.prepare(`UPDATE leagues SET group_id = @group_id WHERE league_id = @league_id`),

  getLeaguesByGroupId: db.prepare(`
    SELECT l.*, r.wins, r.losses, r.ties, r.fpts, r.fpts_against
    FROM leagues l
    LEFT JOIN rosters r ON l.league_id = r.league_id AND r.owner_id = @owner_id
    WHERE l.group_id = @group_id
    ORDER BY l.season DESC
  `),

  upsertRoster: db.prepare(`
    INSERT INTO rosters (league_id, owner_id, roster_id, wins, losses, ties, fpts, fpts_against, updated_at)
    VALUES (@league_id, @owner_id, @roster_id, @wins, @losses, @ties, @fpts, @fpts_against, @updated_at)
    ON CONFLICT(league_id, owner_id) DO UPDATE SET
      roster_id = excluded.roster_id,
      wins = excluded.wins,
      losses = excluded.losses,
      ties = excluded.ties,
      fpts = excluded.fpts,
      fpts_against = excluded.fpts_against,
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

  // Sync job statements
  upsertSyncJob: db.prepare(`
    INSERT INTO sync_jobs (job_id, username, status, step, detail, leagues_total, leagues_done, started_at, updated_at, error)
    VALUES (@job_id, @username, @status, @step, @detail, @leagues_total, @leagues_done, @started_at, @updated_at, @error)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      step = excluded.step,
      detail = excluded.detail,
      leagues_total = excluded.leagues_total,
      leagues_done = excluded.leagues_done,
      updated_at = excluded.updated_at,
      error = excluded.error
  `),

  getSyncJob: db.prepare(`SELECT * FROM sync_jobs WHERE job_id = ?`),

  getLatestSyncJobForUser: db.prepare(`
    SELECT * FROM sync_jobs WHERE username = ? COLLATE NOCASE ORDER BY started_at DESC LIMIT 1
  `),

  getRunningJobForUser: db.prepare(`
    SELECT * FROM sync_jobs WHERE username = ? COLLATE NOCASE AND status = 'running' LIMIT 1
  `),

  // League users statements
  upsertLeagueUser: db.prepare(`
    INSERT INTO league_users (league_id, user_id, display_name, team_name, updated_at)
    VALUES (@league_id, @user_id, @display_name, @team_name, @updated_at)
    ON CONFLICT(league_id, user_id) DO UPDATE SET
      display_name = excluded.display_name,
      team_name = excluded.team_name,
      updated_at = excluded.updated_at
  `),

  getLeagueUsers: db.prepare(`SELECT * FROM league_users WHERE league_id = ?`),

  // H2H statements
  upsertH2hSeason: db.prepare(`
    INSERT INTO h2h_season (league_id, my_owner_id, opp_owner_id, wins, losses, ties, pf, pa, games, updated_at)
    VALUES (@league_id, @my_owner_id, @opp_owner_id, @wins, @losses, @ties, @pf, @pa, @games, @updated_at)
    ON CONFLICT(league_id, my_owner_id, opp_owner_id) DO UPDATE SET
      wins = excluded.wins,
      losses = excluded.losses,
      ties = excluded.ties,
      pf = excluded.pf,
      pa = excluded.pa,
      games = excluded.games,
      updated_at = excluded.updated_at
  `),

  getH2hForLeague: db.prepare(`
    SELECT * FROM h2h_season WHERE league_id = ? AND my_owner_id = ?
  `),

  // Group overrides
  getGroupOverride: db.prepare(`SELECT forced_group_id FROM group_overrides WHERE league_id = ?`),
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
  group_id: string | null;
  raw_json: string | null;
  updated_at: number;
}

export interface CachedRoster {
  league_id: string;
  owner_id: string;
  roster_id: number;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_against: number;
  updated_at: number;
}

export interface SyncJob {
  job_id: string;
  username: string;
  status: "running" | "done" | "error";
  step: string | null;
  detail: string | null;
  leagues_total: number;
  leagues_done: number;
  started_at: number;
  updated_at: number;
  error: string | null;
}

export interface LeagueUser {
  league_id: string;
  user_id: string;
  display_name: string | null;
  team_name: string | null;
  updated_at: number;
}

export interface H2hRecord {
  league_id: string;
  my_owner_id: string;
  opp_owner_id: string;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  pa: number;
  games: number;
  updated_at: number;
}

// 12 hours in milliseconds
const STALE_THRESHOLD = 12 * 60 * 60 * 1000;

export const cache = {
  db, // expose db for transactions

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
    previous_league_id?: string | null;
    group_id?: string | null;
    raw_json?: string;
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
      group_id: league.group_id || null,
      raw_json: league.raw_json || null,
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

  getLeagueById(leagueId: string): CachedLeague | undefined {
    return stmts.getLeagueById.get(leagueId) as CachedLeague | undefined;
  },

  getAllLeaguesMap(): { league_id: string; previous_league_id: string | null }[] {
    return stmts.getAllLeaguesMap.all() as { league_id: string; previous_league_id: string | null }[];
  },

  updateLeagueGroupId(leagueId: string, groupId: string) {
    stmts.updateLeagueGroupId.run({ league_id: leagueId, group_id: groupId });
  },

  getLeaguesByGroupId(groupId: string, ownerId: string): (CachedLeague & { wins: number; losses: number; ties: number })[] {
    return stmts.getLeaguesByGroupId.all({ group_id: groupId, owner_id: ownerId }) as any[];
  },

  upsertRoster(roster: {
    league_id: string;
    owner_id: string;
    roster_id: number;
    wins: number;
    losses: number;
    ties: number;
    fpts?: number;
    fpts_against?: number;
  }) {
    stmts.upsertRoster.run({
      ...roster,
      fpts: roster.fpts || 0,
      fpts_against: roster.fpts_against || 0,
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

  // Sync job methods
  upsertSyncJob(job: SyncJob) {
    stmts.upsertSyncJob.run({
      ...job,
      step: job.step || null,
      detail: job.detail || null,
      error: job.error || null,
    });
  },

  getSyncJob(jobId: string): SyncJob | undefined {
    return stmts.getSyncJob.get(jobId) as SyncJob | undefined;
  },

  getLatestSyncJobForUser(username: string): SyncJob | undefined {
    return stmts.getLatestSyncJobForUser.get(username) as SyncJob | undefined;
  },

  getRunningJobForUser(username: string): SyncJob | undefined {
    return stmts.getRunningJobForUser.get(username) as SyncJob | undefined;
  },

  // League users methods
  upsertLeagueUser(leagueUser: { league_id: string; user_id: string; display_name?: string | null; team_name?: string | null }) {
    stmts.upsertLeagueUser.run({
      ...leagueUser,
      display_name: leagueUser.display_name || null,
      team_name: leagueUser.team_name || null,
      updated_at: Date.now(),
    });
  },

  getLeagueUsers(leagueId: string): LeagueUser[] {
    return stmts.getLeagueUsers.all(leagueId) as LeagueUser[];
  },

  // H2H methods
  upsertH2hSeason(record: Omit<H2hRecord, "updated_at">) {
    stmts.upsertH2hSeason.run({ ...record, updated_at: Date.now() });
  },

  getH2hForLeague(leagueId: string, myOwnerId: string): H2hRecord[] {
    return stmts.getH2hForLeague.all(leagueId, myOwnerId) as H2hRecord[];
  },

  // Group override
  getGroupOverride(leagueId: string): string | undefined {
    const result = stmts.getGroupOverride.get(leagueId) as { forced_group_id: string } | undefined;
    return result?.forced_group_id;
  },
};

export default cache;
