import { pgTable, text, serial, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// We aren't storing this data permanently, but we define schemas for type safety
// matching the Sleeper API responses we expect.

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

// Extended league schema with my_record for the flattened list
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
  is_owner: z.boolean().optional(), // enriched field
});

export const rosterSchema = z.object({
  roster_id: z.number(),
  owner_id: z.string().nullable().optional(),
  league_id: z.string(),
  starters: z.array(z.string()).optional(),
  players: z.array(z.string()).optional(),
  settings: z.record(z.number()).optional(), // wins, losses, etc.
  metadata: z.record(z.any()).optional(),
});

// Updated overview response with flat leagues array and optional cached info
export const overviewResponseSchema = z.object({
  user: sleeperUserSchema,
  leagues: z.array(leagueWithRecordSchema),
  cached: z.boolean().optional(),
  lastSyncedAt: z.number().optional(), // Unix timestamp
});

export const leagueDetailsResponseSchema = z.object({
  leagueId: z.string(),
  users: z.array(leagueUserSchema),
  rosters: z.array(rosterSchema),
});

// Sync response schema
export const syncResponseSchema = z.object({
  success: z.boolean(),
  leaguesSynced: z.number(),
  rostersSynced: z.number(),
  message: z.string().optional(),
});

export type SleeperUser = z.infer<typeof sleeperUserSchema>;
export type League = z.infer<typeof leagueSchema>;
export type LeagueWithRecord = z.infer<typeof leagueWithRecordSchema>;
export type MyRecord = z.infer<typeof myRecordSchema>;
export type LeagueUser = z.infer<typeof leagueUserSchema>;
export type Roster = z.infer<typeof rosterSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
export type LeagueDetailsResponse = z.infer<typeof leagueDetailsResponseSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
