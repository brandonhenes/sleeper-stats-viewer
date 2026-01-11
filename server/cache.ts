import { pool, dbInitError, getStorageMode, db } from "./db";
import { eq, and, sql, desc, ilike, max, inArray } from "drizzle-orm";
import * as schema from "@shared/schema";

export { getStorageMode as storageMode };

function isDbAvailable(): boolean {
  return db !== null && getStorageMode() === "postgres";
}

function getDb() {
  if (!db) {
    const errorMsg = dbInitError?.message || "Database not initialized";
    throw new Error(`Database unavailable: ${errorMsg}`);
  }
  return db;
}

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

export interface CachedTrade {
  transaction_id: string;
  league_id: string;
  status: string;
  created_at: number;
  roster_ids: string | null;
  adds: string | null;
  drops: string | null;
  draft_picks: string | null;
  waiver_budget: string | null;
  updated_at: number;
}

export interface TradeAsset {
  id: number;
  trade_id: string;
  league_id: string;
  season: number;
  created_at_ms: number;
  roster_id: number;
  counterparty_roster_ids: string | null;
  asset_type: string;
  asset_key: string;
  asset_name: string | null;
  direction: string;
  updated_at: number;
}

export interface CachedPlayer {
  player_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  status: string | null;
  age: number | null;
  years_exp: number | null;
  updated_at: number;
}

const STALE_THRESHOLD = 12 * 60 * 60 * 1000;

export const TTL = {
  ROSTERS: 15 * 60 * 1000,
  TRADES: 6 * 60 * 60 * 1000,
  DRAFT_CAPITAL: 6 * 60 * 60 * 1000,
  USERS: 15 * 60 * 1000,
  EXPOSURE: 24 * 60 * 60 * 1000,
};

export const cache = {
  async upsertUser(user: { user_id: string; username: string; display_name: string; avatar?: string | null }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.users)
      .values({
        user_id: user.user_id,
        username: user.username,
        display_name: user.display_name,
        avatar: user.avatar || null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: schema.users.user_id,
        set: {
          username: user.username,
          display_name: user.display_name,
          avatar: user.avatar || null,
          updated_at: now,
        },
      });
  },

  async getUserByUsername(username: string): Promise<CachedUser | undefined> {
    const result = await getDb().select().from(schema.users).where(ilike(schema.users.username, username)).limit(1);
    return result[0] as CachedUser | undefined;
  },

  async getUserById(userId: string): Promise<CachedUser | undefined> {
    const result = await getDb().select().from(schema.users).where(eq(schema.users.user_id, userId)).limit(1);
    return result[0] as CachedUser | undefined;
  },

  async upsertLeague(userId: string, league: {
    league_id: string;
    name: string;
    season: string | number;
    sport: string;
    status: string;
    total_rosters?: number;
    previous_league_id?: string | null;
    group_id?: string | null;
    raw_json?: string;
  }): Promise<void> {
    const now = Date.now();
    const season = typeof league.season === "string" ? parseInt(league.season, 10) : league.season;
    
    await getDb().insert(schema.leagues)
      .values({
        league_id: league.league_id,
        name: league.name,
        season,
        sport: league.sport,
        status: league.status,
        total_rosters: league.total_rosters || null,
        previous_league_id: league.previous_league_id || null,
        group_id: league.group_id || null,
        raw_json: league.raw_json || null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: schema.leagues.league_id,
        set: {
          name: league.name,
          season,
          sport: league.sport,
          status: league.status,
          total_rosters: league.total_rosters || null,
          previous_league_id: league.previous_league_id || null,
          group_id: league.group_id || null,
          raw_json: league.raw_json || null,
          updated_at: now,
        },
      });

    await getDb().insert(schema.user_leagues)
      .values({
        user_id: userId,
        league_id: league.league_id,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.user_leagues.user_id, schema.user_leagues.league_id],
        set: { updated_at: now },
      });
  },

  async getLeaguesForUser(userId: string): Promise<CachedLeague[]> {
    const result = await getDb()
      .select({
        league_id: schema.leagues.league_id,
        name: schema.leagues.name,
        season: schema.leagues.season,
        sport: schema.leagues.sport,
        status: schema.leagues.status,
        total_rosters: schema.leagues.total_rosters,
        previous_league_id: schema.leagues.previous_league_id,
        group_id: schema.leagues.group_id,
        raw_json: schema.leagues.raw_json,
        updated_at: schema.leagues.updated_at,
      })
      .from(schema.leagues)
      .innerJoin(schema.user_leagues, eq(schema.leagues.league_id, schema.user_leagues.league_id))
      .where(eq(schema.user_leagues.user_id, userId))
      .orderBy(schema.leagues.name, desc(schema.leagues.season));
    return result as CachedLeague[];
  },

  async getLeagueById(leagueId: string): Promise<CachedLeague | undefined> {
    const result = await getDb().select().from(schema.leagues).where(eq(schema.leagues.league_id, leagueId)).limit(1);
    return result[0] as CachedLeague | undefined;
  },

  async getAllLeaguesMap(): Promise<{ league_id: string; previous_league_id: string | null }[]> {
    const result = await getDb().select({
      league_id: schema.leagues.league_id,
      previous_league_id: schema.leagues.previous_league_id,
    }).from(schema.leagues);
    return result;
  },

  async updateLeagueGroupId(leagueId: string, groupId: string): Promise<void> {
    await getDb().update(schema.leagues).set({ group_id: groupId }).where(eq(schema.leagues.league_id, leagueId));
  },

  async getLeaguesByGroupId(groupId: string, ownerId: string): Promise<(CachedLeague & { wins: number; losses: number; ties: number })[]> {
    const result = await getDb()
      .select({
        league_id: schema.leagues.league_id,
        name: schema.leagues.name,
        season: schema.leagues.season,
        sport: schema.leagues.sport,
        status: schema.leagues.status,
        total_rosters: schema.leagues.total_rosters,
        previous_league_id: schema.leagues.previous_league_id,
        group_id: schema.leagues.group_id,
        raw_json: schema.leagues.raw_json,
        updated_at: schema.leagues.updated_at,
        wins: schema.rosters.wins,
        losses: schema.rosters.losses,
        ties: schema.rosters.ties,
      })
      .from(schema.leagues)
      .leftJoin(
        schema.rosters,
        and(eq(schema.leagues.league_id, schema.rosters.league_id), eq(schema.rosters.owner_id, ownerId))
      )
      .where(eq(schema.leagues.group_id, groupId))
      .orderBy(desc(schema.leagues.season));
    return result as any[];
  },

  async upsertRoster(roster: {
    league_id: string;
    owner_id: string;
    roster_id: number;
    wins: number;
    losses: number;
    ties: number;
    fpts?: number;
    fpts_against?: number;
  }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.rosters)
      .values({
        league_id: roster.league_id,
        owner_id: roster.owner_id,
        roster_id: roster.roster_id,
        wins: roster.wins,
        losses: roster.losses,
        ties: roster.ties,
        fpts: roster.fpts || 0,
        fpts_against: roster.fpts_against || 0,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.rosters.league_id, schema.rosters.owner_id],
        set: {
          roster_id: roster.roster_id,
          wins: roster.wins,
          losses: roster.losses,
          ties: roster.ties,
          fpts: roster.fpts || 0,
          fpts_against: roster.fpts_against || 0,
          updated_at: now,
        },
      });
  },

  async getRosterForUserInLeague(leagueId: string, ownerId: string): Promise<CachedRoster | undefined> {
    const result = await getDb().select().from(schema.rosters)
      .where(and(eq(schema.rosters.league_id, leagueId), eq(schema.rosters.owner_id, ownerId)))
      .limit(1);
    return result[0] as CachedRoster | undefined;
  },

  async getRostersForUser(userId: string): Promise<CachedRoster[]> {
    const result = await getDb()
      .select({
        league_id: schema.rosters.league_id,
        owner_id: schema.rosters.owner_id,
        roster_id: schema.rosters.roster_id,
        wins: schema.rosters.wins,
        losses: schema.rosters.losses,
        ties: schema.rosters.ties,
        fpts: schema.rosters.fpts,
        fpts_against: schema.rosters.fpts_against,
        updated_at: schema.rosters.updated_at,
      })
      .from(schema.rosters)
      .innerJoin(schema.user_leagues, eq(schema.rosters.league_id, schema.user_leagues.league_id))
      .where(and(eq(schema.rosters.owner_id, userId), eq(schema.user_leagues.user_id, userId)));
    return result as CachedRoster[];
  },

  async getRostersForLeague(leagueId: string): Promise<CachedRoster[]> {
    const result = await getDb().select().from(schema.rosters)
      .where(eq(schema.rosters.league_id, leagueId));
    return result as CachedRoster[];
  },

  async updateRosterPlayers(leagueId: string, ownerId: string, playerIds: string[]): Promise<void> {
    const now = Date.now();
    await getDb().delete(schema.roster_players)
      .where(and(eq(schema.roster_players.league_id, leagueId), eq(schema.roster_players.owner_id, ownerId)));
    
    if (playerIds.length > 0) {
      const values = playerIds.map(playerId => ({
        league_id: leagueId,
        owner_id: ownerId,
        player_id: playerId,
        updated_at: now,
      }));
      await getDb().insert(schema.roster_players).values(values);
    }
  },

  async getLastSyncTime(userId: string): Promise<number | null> {
    const result = await getDb().select({ last_sync: max(schema.user_leagues.updated_at) })
      .from(schema.user_leagues)
      .where(eq(schema.user_leagues.user_id, userId));
    return result[0]?.last_sync || null;
  },

  async isDataStale(userId: string): Promise<boolean> {
    const lastSync = await this.getLastSyncTime(userId);
    if (!lastSync) return true;
    return Date.now() - lastSync > STALE_THRESHOLD;
  },

  async upsertSyncJob(job: SyncJob): Promise<void> {
    await getDb().insert(schema.sync_jobs)
      .values({
        job_id: job.job_id,
        username: job.username,
        status: job.status,
        step: job.step || null,
        detail: job.detail || null,
        leagues_total: job.leagues_total,
        leagues_done: job.leagues_done,
        started_at: job.started_at,
        updated_at: job.updated_at,
        error: job.error || null,
      })
      .onConflictDoUpdate({
        target: schema.sync_jobs.job_id,
        set: {
          status: job.status,
          step: job.step || null,
          detail: job.detail || null,
          leagues_total: job.leagues_total,
          leagues_done: job.leagues_done,
          updated_at: job.updated_at,
          error: job.error || null,
        },
      });
  },

  async getSyncJob(jobId: string): Promise<SyncJob | undefined> {
    const result = await getDb().select().from(schema.sync_jobs).where(eq(schema.sync_jobs.job_id, jobId)).limit(1);
    return result[0] as SyncJob | undefined;
  },

  async getLatestSyncJobForUser(username: string): Promise<SyncJob | undefined> {
    const result = await getDb().select().from(schema.sync_jobs)
      .where(ilike(schema.sync_jobs.username, username))
      .orderBy(desc(schema.sync_jobs.started_at))
      .limit(1);
    return result[0] as SyncJob | undefined;
  },

  async getRunningJobForUser(username: string): Promise<SyncJob | undefined> {
    const result = await getDb().select().from(schema.sync_jobs)
      .where(and(ilike(schema.sync_jobs.username, username), eq(schema.sync_jobs.status, "running")))
      .limit(1);
    return result[0] as SyncJob | undefined;
  },

  async upsertLeagueUser(leagueUser: { league_id: string; user_id: string; display_name?: string | null; team_name?: string | null }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.league_users)
      .values({
        league_id: leagueUser.league_id,
        user_id: leagueUser.user_id,
        display_name: leagueUser.display_name || null,
        team_name: leagueUser.team_name || null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.league_users.league_id, schema.league_users.user_id],
        set: {
          display_name: leagueUser.display_name || null,
          team_name: leagueUser.team_name || null,
          updated_at: now,
        },
      });
  },

  async getLeagueUsers(leagueId: string): Promise<LeagueUser[]> {
    const result = await getDb().select().from(schema.league_users).where(eq(schema.league_users.league_id, leagueId));
    return result as LeagueUser[];
  },

  async upsertH2hSeason(record: Omit<H2hRecord, "updated_at">): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.h2h_season)
      .values({ ...record, updated_at: now })
      .onConflictDoUpdate({
        target: [schema.h2h_season.league_id, schema.h2h_season.my_owner_id, schema.h2h_season.opp_owner_id],
        set: {
          wins: record.wins,
          losses: record.losses,
          ties: record.ties,
          pf: record.pf,
          pa: record.pa,
          games: record.games,
          updated_at: now,
        },
      });
  },

  async getH2hForLeague(leagueId: string, myOwnerId: string): Promise<H2hRecord[]> {
    const result = await getDb().select().from(schema.h2h_season)
      .where(and(eq(schema.h2h_season.league_id, leagueId), eq(schema.h2h_season.my_owner_id, myOwnerId)));
    return result as H2hRecord[];
  },

  async getGroupOverride(leagueId: string): Promise<string | undefined> {
    const result = await getDb().select().from(schema.group_overrides).where(eq(schema.group_overrides.league_id, leagueId)).limit(1);
    return result[0]?.forced_group_id;
  },

  async upsertTrade(trade: {
    transaction_id: string;
    league_id: string;
    status: string;
    created_at: number;
    roster_ids?: string | null;
    adds?: string | null;
    drops?: string | null;
    draft_picks?: string | null;
    waiver_budget?: string | null;
  }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.trades)
      .values({
        transaction_id: trade.transaction_id,
        league_id: trade.league_id,
        status: trade.status,
        created_at: trade.created_at,
        roster_ids: trade.roster_ids || null,
        adds: trade.adds || null,
        drops: trade.drops || null,
        draft_picks: trade.draft_picks || null,
        waiver_budget: trade.waiver_budget || null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: schema.trades.transaction_id,
        set: {
          status: trade.status,
          roster_ids: trade.roster_ids || null,
          adds: trade.adds || null,
          drops: trade.drops || null,
          draft_picks: trade.draft_picks || null,
          waiver_budget: trade.waiver_budget || null,
          updated_at: now,
        },
      });
  },

  async getTradesForLeague(leagueId: string): Promise<CachedTrade[]> {
    const result = await getDb().select().from(schema.trades)
      .where(eq(schema.trades.league_id, leagueId))
      .orderBy(desc(schema.trades.created_at));
    return result as CachedTrade[];
  },

  async upsertPlayer(player: {
    player_id: string;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    team?: string | null;
    status?: string | null;
    age?: number | null;
    years_exp?: number | null;
  }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.players_master)
      .values({
        player_id: player.player_id,
        full_name: player.full_name || null,
        first_name: player.first_name || null,
        last_name: player.last_name || null,
        position: player.position || null,
        team: player.team || null,
        status: player.status || null,
        age: player.age || null,
        years_exp: player.years_exp || null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: schema.players_master.player_id,
        set: {
          full_name: player.full_name || null,
          first_name: player.first_name || null,
          last_name: player.last_name || null,
          position: player.position || null,
          team: player.team || null,
          status: player.status || null,
          age: player.age || null,
          years_exp: player.years_exp || null,
          updated_at: now,
        },
      });
  },

  async getPlayer(playerId: string): Promise<CachedPlayer | undefined> {
    const result = await getDb().select().from(schema.players_master).where(eq(schema.players_master.player_id, playerId)).limit(1);
    return result[0] as CachedPlayer | undefined;
  },

  async getAllPlayers(): Promise<CachedPlayer[]> {
    const result = await getDb().select().from(schema.players_master);
    return result as CachedPlayer[];
  },

  async getPlayersLastUpdated(): Promise<number | null> {
    const result = await getDb().select({ last_updated: max(schema.players_master.updated_at) }).from(schema.players_master);
    return result[0]?.last_updated || null;
  },

  async getPlayerCount(): Promise<number> {
    const result = await getDb().select({ count: sql<number>`count(*)` }).from(schema.players_master);
    return Number(result[0]?.count) || 0;
  },

  async bulkUpsertPlayers(players: Array<{
    player_id: string;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    team?: string | null;
    status?: string | null;
    age?: number | null;
    years_exp?: number | null;
  }>): Promise<void> {
    const now = Date.now();
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < players.length; i += BATCH_SIZE) {
      const batch = players.slice(i, i + BATCH_SIZE);
      const values = batch.map(player => ({
        player_id: player.player_id,
        full_name: player.full_name || null,
        first_name: player.first_name || null,
        last_name: player.last_name || null,
        position: player.position || null,
        team: player.team || null,
        status: player.status || null,
        age: player.age || null,
        years_exp: player.years_exp || null,
        updated_at: now,
      }));
      
      await getDb().insert(schema.players_master)
        .values(values)
        .onConflictDoUpdate({
          target: schema.players_master.player_id,
          set: {
            full_name: sql`EXCLUDED.full_name`,
            first_name: sql`EXCLUDED.first_name`,
            last_name: sql`EXCLUDED.last_name`,
            position: sql`EXCLUDED.position`,
            team: sql`EXCLUDED.team`,
            status: sql`EXCLUDED.status`,
            age: sql`EXCLUDED.age`,
            years_exp: sql`EXCLUDED.years_exp`,
            updated_at: sql`EXCLUDED.updated_at`,
          },
        });
    }
  },

  async getRosterPlayersForUserInLeague(leagueId: string, ownerId: string): Promise<{ player_id: string }[]> {
    const result = await getDb().select({ player_id: schema.roster_players.player_id })
      .from(schema.roster_players)
      .where(and(eq(schema.roster_players.league_id, leagueId), eq(schema.roster_players.owner_id, ownerId)));
    return result;
  },

  async getAllRosterPlayersForLeague(leagueId: string): Promise<{ owner_id: string; player_id: string }[]> {
    const result = await getDb().select({ 
      owner_id: schema.roster_players.owner_id,
      player_id: schema.roster_players.player_id 
    })
      .from(schema.roster_players)
      .where(eq(schema.roster_players.league_id, leagueId));
    return result;
  },

  async getAllRosterPlayersWithRosterId(leagueId: string): Promise<{ roster_id: number; owner_id: string; player_id: string }[]> {
    const result = await getDb().select({ 
      roster_id: schema.rosters.roster_id,
      owner_id: schema.roster_players.owner_id,
      player_id: schema.roster_players.player_id 
    })
      .from(schema.roster_players)
      .innerJoin(
        schema.rosters,
        and(
          eq(schema.roster_players.league_id, schema.rosters.league_id),
          eq(schema.roster_players.owner_id, schema.rosters.owner_id)
        )
      )
      .where(eq(schema.roster_players.league_id, leagueId));
    return result;
  },

  async getPlayersByIds(playerIds: string[]): Promise<CachedPlayer[]> {
    if (playerIds.length === 0) return [];
    const result = await getDb().select().from(schema.players_master)
      .where(inArray(schema.players_master.player_id, playerIds));
    return result as CachedPlayer[];
  },

  // Trade Assets methods
  async upsertTradeAssets(assets: Array<{
    trade_id: string;
    league_id: string;
    season: number;
    created_at_ms: number;
    roster_id: number;
    counterparty_roster_ids: string | null;
    asset_type: string;
    asset_key: string;
    asset_name: string | null;
    direction: string;
  }>): Promise<void> {
    if (assets.length === 0) return;
    const now = Date.now();
    
    for (const asset of assets) {
      await getDb().insert(schema.trade_assets)
        .values({
          trade_id: asset.trade_id,
          league_id: asset.league_id,
          season: asset.season,
          created_at_ms: asset.created_at_ms,
          roster_id: asset.roster_id,
          counterparty_roster_ids: asset.counterparty_roster_ids,
          asset_type: asset.asset_type,
          asset_key: asset.asset_key,
          asset_name: asset.asset_name,
          direction: asset.direction,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: [schema.trade_assets.trade_id, schema.trade_assets.roster_id, schema.trade_assets.asset_key, schema.trade_assets.direction],
          set: {
            asset_name: sql`EXCLUDED.asset_name`,
            counterparty_roster_ids: sql`EXCLUDED.counterparty_roster_ids`,
            updated_at: sql`EXCLUDED.updated_at`,
          },
        });
    }
  },

  async getTradeAssetsForLeague(leagueId: string): Promise<TradeAsset[]> {
    const result = await getDb().select().from(schema.trade_assets)
      .where(eq(schema.trade_assets.league_id, leagueId))
      .orderBy(desc(schema.trade_assets.created_at_ms));
    return result as TradeAsset[];
  },

  async getTradeAssetsForRoster(leagueId: string, rosterId: number): Promise<TradeAsset[]> {
    const result = await getDb().select().from(schema.trade_assets)
      .where(and(
        eq(schema.trade_assets.league_id, leagueId),
        eq(schema.trade_assets.roster_id, rosterId)
      ))
      .orderBy(desc(schema.trade_assets.created_at_ms));
    return result as TradeAsset[];
  },

  async getAllTradeAssets(): Promise<TradeAsset[]> {
    const result = await getDb().select().from(schema.trade_assets)
      .orderBy(desc(schema.trade_assets.created_at_ms));
    return result as TradeAsset[];
  },

  async getTradeAssetCountsFiltered(opts: { minTimestamp?: number; leagueIds?: string[]; season?: number }): Promise<{ total: number; players: number; picks: number }> {
    const conditions: ReturnType<typeof sql>[] = [];
    if (opts.minTimestamp) {
      conditions.push(sql`${schema.trade_assets.created_at_ms} >= ${opts.minTimestamp}`);
    }
    if (opts.leagueIds && opts.leagueIds.length > 0) {
      conditions.push(inArray(schema.trade_assets.league_id, opts.leagueIds));
    }
    if (opts.season) {
      conditions.push(eq(schema.trade_assets.season, opts.season));
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    const total = await getDb().select({ count: sql<number>`count(*)` }).from(schema.trade_assets).where(whereClause);
    const players = await getDb().select({ count: sql<number>`count(*)` }).from(schema.trade_assets)
      .where(whereClause ? and(whereClause, eq(schema.trade_assets.asset_type, 'player')) : eq(schema.trade_assets.asset_type, 'player'));
    const picks = await getDb().select({ count: sql<number>`count(*)` }).from(schema.trade_assets)
      .where(whereClause ? and(whereClause, eq(schema.trade_assets.asset_type, 'pick')) : eq(schema.trade_assets.asset_type, 'pick'));
    return {
      total: Number(total[0]?.count) || 0,
      players: Number(players[0]?.count) || 0,
      picks: Number(picks[0]?.count) || 0,
    };
  },

  async getTradeAssetCounts(): Promise<{ total: number; players: number; picks: number }> {
    return this.getTradeAssetCountsFiltered({});
  },

  async getMostTradedPlayersFiltered(limit: number = 20, opts: { minTimestamp?: number; leagueIds?: string[]; season?: number }): Promise<{ player_id: string; player_name: string | null; trade_count: number }[]> {
    const conditions: ReturnType<typeof sql>[] = [eq(schema.trade_assets.asset_type, 'player')];
    if (opts.minTimestamp) {
      conditions.push(sql`${schema.trade_assets.created_at_ms} >= ${opts.minTimestamp}`);
    }
    if (opts.leagueIds && opts.leagueIds.length > 0) {
      conditions.push(inArray(schema.trade_assets.league_id, opts.leagueIds));
    }
    if (opts.season) {
      conditions.push(eq(schema.trade_assets.season, opts.season));
    }
    
    const result = await getDb().select({
      player_id: schema.trade_assets.asset_key,
      player_name: schema.trade_assets.asset_name,
      trade_count: sql<number>`count(distinct ${schema.trade_assets.trade_id})`,
    })
      .from(schema.trade_assets)
      .where(and(...conditions))
      .groupBy(schema.trade_assets.asset_key, schema.trade_assets.asset_name)
      .orderBy(desc(sql`count(distinct ${schema.trade_assets.trade_id})`))
      .limit(limit);
    return result.map(r => ({
      player_id: r.player_id,
      player_name: r.player_name,
      trade_count: Number(r.trade_count),
    }));
  },

  async getMostTradedPlayers(limit: number = 20): Promise<{ player_id: string; player_name: string | null; trade_count: number }[]> {
    return this.getMostTradedPlayersFiltered(limit, {});
  },

  async getMostTradedPicksFiltered(limit: number = 20, opts: { minTimestamp?: number; leagueIds?: string[]; season?: number }): Promise<{ pick_type: string; trade_count: number }[]> {
    const conditions: ReturnType<typeof sql>[] = [eq(schema.trade_assets.asset_type, 'pick')];
    if (opts.minTimestamp) {
      conditions.push(sql`${schema.trade_assets.created_at_ms} >= ${opts.minTimestamp}`);
    }
    if (opts.leagueIds && opts.leagueIds.length > 0) {
      conditions.push(inArray(schema.trade_assets.league_id, opts.leagueIds));
    }
    if (opts.season) {
      conditions.push(eq(schema.trade_assets.season, opts.season));
    }
    
    const result = await getDb().select({
      pick_type: schema.trade_assets.asset_key,
      trade_count: sql<number>`count(distinct ${schema.trade_assets.trade_id})`,
    })
      .from(schema.trade_assets)
      .where(and(...conditions))
      .groupBy(schema.trade_assets.asset_key)
      .orderBy(desc(sql`count(distinct ${schema.trade_assets.trade_id})`))
      .limit(limit);
    return result.map(r => ({
      pick_type: r.pick_type,
      trade_count: Number(r.trade_count),
    }));
  },

  async getMostTradedPicks(limit: number = 20): Promise<{ pick_type: string; trade_count: number }[]> {
    return this.getMostTradedPicksFiltered(limit, {});
  },

  async getTradesFilteredBySeason(opts: { minTimestamp?: number; leagueIds?: string[] }): Promise<{ season: number; trade_count: number; player_count: number; pick_count: number }[]> {
    const conditions: ReturnType<typeof sql>[] = [];
    if (opts.minTimestamp) {
      conditions.push(sql`${schema.trade_assets.created_at_ms} >= ${opts.minTimestamp}`);
    }
    if (opts.leagueIds && opts.leagueIds.length > 0) {
      conditions.push(inArray(schema.trade_assets.league_id, opts.leagueIds));
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    const result = await getDb().select({
      season: schema.trade_assets.season,
      trade_count: sql<number>`count(distinct ${schema.trade_assets.trade_id})`,
      player_count: sql<number>`count(case when ${schema.trade_assets.asset_type} = 'player' then 1 end)`,
      pick_count: sql<number>`count(case when ${schema.trade_assets.asset_type} = 'pick' then 1 end)`,
    })
      .from(schema.trade_assets)
      .where(whereClause)
      .groupBy(schema.trade_assets.season)
      .orderBy(desc(schema.trade_assets.season));
    return result.map(r => ({
      season: r.season,
      trade_count: Number(r.trade_count),
      player_count: Number(r.player_count),
      pick_count: Number(r.pick_count),
    }));
  },

  async getTradesBySeason(): Promise<{ season: number; trade_count: number; player_count: number; pick_count: number }[]> {
    return this.getTradesFilteredBySeason({});
  },

  async getActiveLeagueIds(userId: string): Promise<string[]> {
    const leagues = await this.getLeaguesForUser(userId);
    const currentSeason = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const groups = new Map<string, { league_id: string; season: number }>();
    
    for (const league of leagues) {
      const groupId = league.group_id || league.league_id;
      const existing = groups.get(groupId);
      if (!existing || league.season > existing.season) {
        groups.set(groupId, { league_id: league.league_id, season: league.season });
      }
    }
    
    return Array.from(groups.values())
      .filter(g => g.season === currentSeason)
      .map(g => g.league_id);
  },

  async getTradeAssetsForLeagues(leagueIds: string[], opts?: { season?: number }): Promise<TradeAsset[]> {
    if (leagueIds.length === 0) return [];
    
    const conditions = [inArray(schema.trade_assets.league_id, leagueIds)];
    if (opts?.season) {
      conditions.push(eq(schema.trade_assets.season, opts.season));
    }
    
    const result = await getDb().select().from(schema.trade_assets)
      .where(and(...conditions))
      .orderBy(desc(schema.trade_assets.created_at_ms));
    return result as TradeAsset[];
  },

  async getLeagueIdsForGroup(groupId: string): Promise<{ league_id: string; season: number }[]> {
    const result = await getDb().select({
      league_id: schema.leagues.league_id,
      season: schema.leagues.season,
    })
      .from(schema.leagues)
      .where(eq(schema.leagues.group_id, groupId))
      .orderBy(desc(schema.leagues.season));
    return result;
  },

  async clearTradeAssetsForLeague(leagueId: string): Promise<void> {
    await getDb().delete(schema.trade_assets).where(eq(schema.trade_assets.league_id, leagueId));
  },

  async resolveLatestLeagueId(leagueIdOrGroupId: string): Promise<string | null> {
    const league = await this.getLeagueById(leagueIdOrGroupId);
    if (!league) return null;
    
    const groupId = league.group_id || league.league_id;
    const leaguesInGroup = await this.getLeagueIdsForGroup(groupId);
    
    if (leaguesInGroup.length === 0) {
      return league.league_id;
    }
    
    return leaguesInGroup[0].league_id;
  },

  async getRostersLastUpdated(leagueId: string): Promise<number | null> {
    const result = await getDb().select({ updated_at: max(schema.rosters.updated_at) })
      .from(schema.rosters)
      .where(eq(schema.rosters.league_id, leagueId));
    return result[0]?.updated_at ?? null;
  },

  async getTradesLastUpdated(leagueId: string): Promise<number | null> {
    const result = await getDb().select({ updated_at: max(schema.trades.updated_at) })
      .from(schema.trades)
      .where(eq(schema.trades.league_id, leagueId));
    return result[0]?.updated_at ?? null;
  },

  isRostersStale(lastUpdated: number | null): boolean {
    if (!lastUpdated) return true;
    return Date.now() - lastUpdated > TTL.ROSTERS;
  },

  isTradesStale(lastUpdated: number | null): boolean {
    if (!lastUpdated) return true;
    return Date.now() - lastUpdated > TTL.TRADES;
  },

  async getLeagueStaleness(leagueId: string): Promise<{
    rosters_updated_at: number | null;
    rosters_stale: boolean;
    trades_updated_at: number | null;
    trades_stale: boolean;
  }> {
    const rostersUpdated = await this.getRostersLastUpdated(leagueId);
    const tradesUpdated = await this.getTradesLastUpdated(leagueId);
    
    return {
      rosters_updated_at: rostersUpdated,
      rosters_stale: this.isRostersStale(rostersUpdated),
      trades_updated_at: tradesUpdated,
      trades_stale: this.isTradesStale(tradesUpdated),
    };
  },

  // Exposure profile methods for trade targeting
  async getExposureProfile(username: string): Promise<{
    username: string;
    season: number;
    active_league_count: number;
    exposure_json: Record<string, { count: number; pct: number; pos: string | null }>;
    last_synced_at: number;
  } | null> {
    const result = await getDb().select()
      .from(schema.user_exposure_summary)
      .where(ilike(schema.user_exposure_summary.username, username))
      .limit(1);
    if (!result[0]) return null;
    return {
      username: result[0].username,
      season: result[0].season,
      active_league_count: result[0].active_league_count,
      exposure_json: result[0].exposure_json as Record<string, { count: number; pct: number; pos: string | null }>,
      last_synced_at: result[0].last_synced_at,
    };
  },

  async upsertExposureProfile(data: {
    username: string;
    season: number;
    active_league_count: number;
    exposure_json: Record<string, { count: number; pct: number; pos: string | null }>;
  }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.user_exposure_summary)
      .values({
        username: data.username.toLowerCase(),
        season: data.season,
        active_league_count: data.active_league_count,
        exposure_json: data.exposure_json,
        last_synced_at: now,
      })
      .onConflictDoUpdate({
        target: schema.user_exposure_summary.username,
        set: {
          season: data.season,
          active_league_count: data.active_league_count,
          exposure_json: data.exposure_json,
          last_synced_at: now,
        },
      });
  },

  isExposureStale(lastSyncedAt: number | null): boolean {
    if (!lastSyncedAt) return true;
    return Date.now() - lastSyncedAt > TTL.EXPOSURE;
  },

  // League season summary methods for year-by-year finish tracking
  async getSeasonSummaries(leagueIds: string[], userId: string): Promise<Array<{
    league_id: string;
    user_id: string;
    season: number;
    roster_id: number | null;
    finish_place: number | null;
    regular_rank: number | null;
    playoff_finish: string | null;
    source: string | null;
    wins: number;
    losses: number;
    ties: number;
    pf: number | null;
    pa: number | null;
  }>> {
    if (leagueIds.length === 0) return [];
    const result = await getDb().select()
      .from(schema.league_season_summary)
      .where(and(
        inArray(schema.league_season_summary.league_id, leagueIds),
        eq(schema.league_season_summary.user_id, userId)
      ));
    return result.map(r => ({
      league_id: r.league_id,
      user_id: r.user_id,
      season: r.season,
      roster_id: r.roster_id,
      finish_place: r.finish_place,
      regular_rank: r.regular_rank,
      playoff_finish: r.playoff_finish,
      source: r.source,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pf: r.pf,
      pa: r.pa,
    }));
  },

  async upsertSeasonSummary(data: {
    league_id: string;
    user_id: string;
    season: number;
    roster_id?: number | null;
    finish_place?: number | null;
    regular_rank?: number | null;
    playoff_finish?: string | null;
    source?: string | null;
    wins: number;
    losses: number;
    ties: number;
    pf?: number | null;
    pa?: number | null;
  }): Promise<void> {
    const now = Date.now();
    await getDb().insert(schema.league_season_summary)
      .values({
        league_id: data.league_id,
        user_id: data.user_id,
        season: data.season,
        roster_id: data.roster_id ?? null,
        finish_place: data.finish_place ?? null,
        regular_rank: data.regular_rank ?? null,
        playoff_finish: data.playoff_finish ?? null,
        source: data.source ?? null,
        wins: data.wins,
        losses: data.losses,
        ties: data.ties,
        pf: data.pf ?? null,
        pa: data.pa ?? null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [schema.league_season_summary.league_id, schema.league_season_summary.user_id],
        set: {
          season: data.season,
          roster_id: data.roster_id ?? null,
          finish_place: data.finish_place ?? null,
          regular_rank: data.regular_rank ?? null,
          playoff_finish: data.playoff_finish ?? null,
          source: data.source ?? null,
          wins: data.wins,
          losses: data.losses,
          ties: data.ties,
          pf: data.pf ?? null,
          pa: data.pa ?? null,
          updated_at: now,
        },
      });
  },

  async testConnection(): Promise<{ ok: boolean; mode: string }> {
    if (!isDbAvailable()) {
      return { ok: true, mode: "no-db" };
    }
    await getDb().execute(sql`SELECT 1`);
    return { ok: true, mode: "postgres" };
  },

  isDbAvailable,
};

export default cache;
