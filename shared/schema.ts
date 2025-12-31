import { pgTable, text, serial, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sleeper user schema
export const sleeperUserSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  display_name: z.string(),
  avatar: z.string().nullable().optional(),
});

// Record type for W-L-T
export const myRecordSchema = z.object({
  wins: z.number(),
  losses: z.number(),
  ties: z.number(),
});

// Extended league schema with my_record for individual leagues (used internally)
export const leagueWithRecordSchema = z.object({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  status: z.string(),
  sport: z.string(),
  total_rosters: z.number().optional(),
  my_record: myRecordSchema.optional(),
  my_roster_id: z.number().optional(),
});

// League Group: aggregates leagues across seasons
export const leagueGroupSchema = z.object({
  group_id: z.string(),
  name: z.string(), // most recent season name
  min_season: z.number(),
  max_season: z.number(),
  seasons_count: z.number(),
  overall_record: myRecordSchema, // aggregated W-L-T across all seasons
  league_ids: z.array(z.string()), // all league_ids in this group
  league_type: z.enum(["dynasty", "redraft", "unknown"]).optional(), // derived from settings
});

// Original league schema (kept for backwards compatibility)
export const leagueSchema = z.object({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  status: z.string(),
  sport: z.string(),
  total_rosters: z.number().optional(),
});

export const leagueUserSchema = z.object({
  user_id: z.string(),
  username: z.string().optional(),
  display_name: z.string().optional(),
  avatar: z.string().nullable().optional(),
  metadata: z.record(z.any()).optional(),
  is_owner: z.boolean().optional(),
});

export const rosterSchema = z.object({
  roster_id: z.number(),
  owner_id: z.string().nullable().optional(),
  league_id: z.string(),
  starters: z.array(z.string()).optional(),
  players: z.array(z.string()).optional(),
  settings: z.record(z.number()).optional(),
  metadata: z.record(z.any()).optional(),
});

// Sync status response
export const syncStatusSchema = z.object({
  job_id: z.string(),
  status: z.enum(["running", "done", "error"]),
  step: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  leagues_total: z.number().optional(),
  leagues_done: z.number().optional(),
  error: z.string().nullable().optional(),
});

// Updated overview response with league groups
export const overviewResponseSchema = z.object({
  user: sleeperUserSchema,
  league_groups: z.array(leagueGroupSchema),
  cached: z.boolean().optional(),
  needs_sync: z.boolean().optional(),
  sync_status: z.enum(["not_started", "running", "done", "error"]).optional(),
  lastSyncedAt: z.number().optional(),
});

export const leagueDetailsResponseSchema = z.object({
  leagueId: z.string(),
  users: z.array(leagueUserSchema),
  rosters: z.array(rosterSchema),
});

// Sync response schema for POST /api/sync
export const syncResponseSchema = z.object({
  job_id: z.string(),
  status: z.enum(["running", "done", "error"]),
  message: z.string().optional(),
});

// H2H opponent record
export const h2hOpponentSchema = z.object({
  opp_owner_id: z.string(),
  display_name: z.string().nullable().optional(),
  team_name: z.string().nullable().optional(),
  wins: z.number(),
  losses: z.number(),
  ties: z.number(),
  games: z.number(),
  pf: z.number(),
  pa: z.number(),
});

// H2H response for a league group
export const h2hResponseSchema = z.object({
  group_id: z.string(),
  my_owner_id: z.string(),
  opponents: z.array(h2hOpponentSchema),
  h2h_overall: myRecordSchema, // sum of all H2H matchups
});

export type SleeperUser = z.infer<typeof sleeperUserSchema>;
export type League = z.infer<typeof leagueSchema>;
export type LeagueWithRecord = z.infer<typeof leagueWithRecordSchema>;
export type LeagueGroup = z.infer<typeof leagueGroupSchema>;
export type MyRecord = z.infer<typeof myRecordSchema>;
export type LeagueUser = z.infer<typeof leagueUserSchema>;
export type Roster = z.infer<typeof rosterSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
export type LeagueDetailsResponse = z.infer<typeof leagueDetailsResponseSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
export type H2hOpponent = z.infer<typeof h2hOpponentSchema>;
export type H2hResponse = z.infer<typeof h2hResponseSchema>;

// Trade schemas
export const tradeAssetSchema = z.object({
  player_id: z.string(),
  player_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
});

export const tradeDraftPickSchema = z.object({
  season: z.string().optional(),
  round: z.number().optional(),
  roster_id: z.number().optional(),
  previous_owner_id: z.number().optional(),
  owner_id: z.number().optional(),
});

export const tradeSchema = z.object({
  transaction_id: z.string(),
  league_id: z.string(),
  league_name: z.string().optional(),
  season: z.number().optional(),
  status: z.string(),
  created_at: z.number(),
  roster_ids: z.array(z.number()).optional(),
  adds: z.record(z.string(), z.string()).nullable().optional(),
  drops: z.record(z.string(), z.string()).nullable().optional(),
  draft_picks: z.array(tradeDraftPickSchema).nullable().optional(),
});

export const tradesResponseSchema = z.object({
  group_id: z.string(),
  trades: z.array(tradeSchema),
});

export const playerSchema = z.object({
  player_id: z.string(),
  full_name: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  age: z.number().nullable().optional(),
  years_exp: z.number().nullable().optional(),
});

export const playerExposureSchema = z.object({
  player: playerSchema,
  leagues_owned: z.number(),
  total_leagues: z.number(),
  exposure_pct: z.number(),
  league_names: z.array(z.string()),
});

export const playerExposureResponseSchema = z.object({
  username: z.string(),
  total_leagues: z.number(),
  exposures: z.array(playerExposureSchema),
});

export type Trade = z.infer<typeof tradeSchema>;
export type TradesResponse = z.infer<typeof tradesResponseSchema>;
export type Player = z.infer<typeof playerSchema>;
export type PlayerExposure = z.infer<typeof playerExposureSchema>;
export type PlayerExposureResponse = z.infer<typeof playerExposureResponseSchema>;
