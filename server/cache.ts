import { pool } from "./db";
import { eq, and, sql, desc, ilike, max } from "drizzle-orm";
import { db } from "./db";
import * as schema from "@shared/schema";

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

export const cache = {
  async upsertUser(user: { user_id: string; username: string; display_name: string; avatar?: string | null }): Promise<void> {
    const now = Date.now();
    await db.insert(schema.users)
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
    const result = await db.select().from(schema.users).where(ilike(schema.users.username, username)).limit(1);
    return result[0] as CachedUser | undefined;
  },

  async getUserById(userId: string): Promise<CachedUser | undefined> {
    const result = await db.select().from(schema.users).where(eq(schema.users.user_id, userId)).limit(1);
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
    
    await db.insert(schema.leagues)
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

    await db.insert(schema.user_leagues)
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
    const result = await db
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
    const result = await db.select().from(schema.leagues).where(eq(schema.leagues.league_id, leagueId)).limit(1);
    return result[0] as CachedLeague | undefined;
  },

  async getAllLeaguesMap(): Promise<{ league_id: string; previous_league_id: string | null }[]> {
    const result = await db.select({
      league_id: schema.leagues.league_id,
      previous_league_id: schema.leagues.previous_league_id,
    }).from(schema.leagues);
    return result;
  },

  async updateLeagueGroupId(leagueId: string, groupId: string): Promise<void> {
    await db.update(schema.leagues).set({ group_id: groupId }).where(eq(schema.leagues.league_id, leagueId));
  },

  async getLeaguesByGroupId(groupId: string, ownerId: string): Promise<(CachedLeague & { wins: number; losses: number; ties: number })[]> {
    const result = await db
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
    await db.insert(schema.rosters)
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
    const result = await db.select().from(schema.rosters)
      .where(and(eq(schema.rosters.league_id, leagueId), eq(schema.rosters.owner_id, ownerId)))
      .limit(1);
    return result[0] as CachedRoster | undefined;
  },

  async getRostersForUser(userId: string): Promise<CachedRoster[]> {
    const result = await db
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
    const result = await db.select().from(schema.rosters)
      .where(eq(schema.rosters.league_id, leagueId));
    return result as CachedRoster[];
  },

  async updateRosterPlayers(leagueId: string, ownerId: string, playerIds: string[]): Promise<void> {
    const now = Date.now();
    await db.delete(schema.roster_players)
      .where(and(eq(schema.roster_players.league_id, leagueId), eq(schema.roster_players.owner_id, ownerId)));
    
    if (playerIds.length > 0) {
      const values = playerIds.map(playerId => ({
        league_id: leagueId,
        owner_id: ownerId,
        player_id: playerId,
        updated_at: now,
      }));
      await db.insert(schema.roster_players).values(values);
    }
  },

  async getLastSyncTime(userId: string): Promise<number | null> {
    const result = await db.select({ last_sync: max(schema.user_leagues.updated_at) })
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
    await db.insert(schema.sync_jobs)
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
    const result = await db.select().from(schema.sync_jobs).where(eq(schema.sync_jobs.job_id, jobId)).limit(1);
    return result[0] as SyncJob | undefined;
  },

  async getLatestSyncJobForUser(username: string): Promise<SyncJob | undefined> {
    const result = await db.select().from(schema.sync_jobs)
      .where(ilike(schema.sync_jobs.username, username))
      .orderBy(desc(schema.sync_jobs.started_at))
      .limit(1);
    return result[0] as SyncJob | undefined;
  },

  async getRunningJobForUser(username: string): Promise<SyncJob | undefined> {
    const result = await db.select().from(schema.sync_jobs)
      .where(and(ilike(schema.sync_jobs.username, username), eq(schema.sync_jobs.status, "running")))
      .limit(1);
    return result[0] as SyncJob | undefined;
  },

  async upsertLeagueUser(leagueUser: { league_id: string; user_id: string; display_name?: string | null; team_name?: string | null }): Promise<void> {
    const now = Date.now();
    await db.insert(schema.league_users)
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
    const result = await db.select().from(schema.league_users).where(eq(schema.league_users.league_id, leagueId));
    return result as LeagueUser[];
  },

  async upsertH2hSeason(record: Omit<H2hRecord, "updated_at">): Promise<void> {
    const now = Date.now();
    await db.insert(schema.h2h_season)
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
    const result = await db.select().from(schema.h2h_season)
      .where(and(eq(schema.h2h_season.league_id, leagueId), eq(schema.h2h_season.my_owner_id, myOwnerId)));
    return result as H2hRecord[];
  },

  async getGroupOverride(leagueId: string): Promise<string | undefined> {
    const result = await db.select().from(schema.group_overrides).where(eq(schema.group_overrides.league_id, leagueId)).limit(1);
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
    await db.insert(schema.trades)
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
    const result = await db.select().from(schema.trades)
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
    await db.insert(schema.players_master)
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
    const result = await db.select().from(schema.players_master).where(eq(schema.players_master.player_id, playerId)).limit(1);
    return result[0] as CachedPlayer | undefined;
  },

  async getAllPlayers(): Promise<CachedPlayer[]> {
    const result = await db.select().from(schema.players_master);
    return result as CachedPlayer[];
  },

  async getPlayersLastUpdated(): Promise<number | null> {
    const result = await db.select({ last_updated: max(schema.players_master.updated_at) }).from(schema.players_master);
    return result[0]?.last_updated || null;
  },

  async getPlayerCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(schema.players_master);
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
      
      await db.insert(schema.players_master)
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
    const result = await db.select({ player_id: schema.roster_players.player_id })
      .from(schema.roster_players)
      .where(and(eq(schema.roster_players.league_id, leagueId), eq(schema.roster_players.owner_id, ownerId)));
    return result;
  },
};

export default cache;
