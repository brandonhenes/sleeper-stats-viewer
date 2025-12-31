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

// Request/Response Schemas for our internal API
export const overviewResponseSchema = z.object({
  user: sleeperUserSchema,
  leaguesBySeason: z.record(z.array(leagueSchema)),
});

export const leagueDetailsResponseSchema = z.object({
  leagueId: z.string(),
  users: z.array(leagueUserSchema),
  rosters: z.array(rosterSchema),
});

export type SleeperUser = z.infer<typeof sleeperUserSchema>;
export type League = z.infer<typeof leagueSchema>;
export type LeagueUser = z.infer<typeof leagueUserSchema>;
export type Roster = z.infer<typeof rosterSchema>;
export type OverviewResponse = z.infer<typeof overviewResponseSchema>;
export type LeagueDetailsResponse = z.infer<typeof leagueDetailsResponseSchema>;
