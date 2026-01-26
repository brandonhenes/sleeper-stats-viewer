import { db } from "../db";
import * as schema from "../../shared/schema";
import { eq, inArray, isNotNull, sql, count, max } from "drizzle-orm";

export function inferLeagueMode(leagueRawJson: string | null): "sf" | "1qb" {
  if (!leagueRawJson) return "1qb";
  
  try {
    const league = JSON.parse(leagueRawJson);
    const rosterPositions: string[] = league.roster_positions || [];
    
    if (rosterPositions.includes("SUPER_FLEX")) {
      return "sf";
    }
    
    const qbCount = rosterPositions.filter(p => p === "QB").length;
    if (qbCount >= 2) {
      return "sf";
    }
    
    return "1qb";
  } catch {
    return "1qb";
  }
}

export async function getPlayerValuesMap(
  playerIds: string[]
): Promise<Map<string, { value_1qb: number | null; value_sf: number | null }>> {
  const result = new Map<string, { value_1qb: number | null; value_sf: number | null }>();
  
  if (!db || playerIds.length === 0) return result;
  
  const rows = await db
    .select({
      player_id: schema.player_values.player_id,
      value_1qb: schema.player_values.value_1qb,
      value_sf: schema.player_values.value_sf,
    })
    .from(schema.player_values)
    .where(inArray(schema.player_values.player_id, playerIds));
  
  for (const row of rows) {
    result.set(row.player_id, {
      value_1qb: row.value_1qb,
      value_sf: row.value_sf,
    });
  }
  
  return result;
}

export async function getPlayerValuesStatus(): Promise<{
  rows_in_player_values: number;
  has_1qb: number;
  has_sf: number;
  last_updated_at: number | null;
}> {
  if (!db) {
    return {
      rows_in_player_values: 0,
      has_1qb: 0,
      has_sf: 0,
      last_updated_at: null,
    };
  }
  
  const [totalResult] = await db
    .select({ count: count() })
    .from(schema.player_values);
  
  const [has1qbResult] = await db
    .select({ count: count() })
    .from(schema.player_values)
    .where(isNotNull(schema.player_values.value_1qb));
  
  const [hasSfResult] = await db
    .select({ count: count() })
    .from(schema.player_values)
    .where(isNotNull(schema.player_values.value_sf));
  
  const [maxUpdatedResult] = await db
    .select({ max_updated: max(schema.player_values.updated_at) })
    .from(schema.player_values);
  
  return {
    rows_in_player_values: totalResult?.count || 0,
    has_1qb: has1qbResult?.count || 0,
    has_sf: hasSfResult?.count || 0,
    last_updated_at: maxUpdatedResult?.max_updated || null,
  };
}

export interface RosterCoverageResult {
  league_id: string;
  mode: "sf" | "1qb";
  total_players: number;
  matched_players: number;
  coverage_pct: number;
  missing: Array<{ player_id: string; full_name: string; position: string }>;
}

export async function getRosterCoverage(
  leagueId: string,
  ownerId: string,
  leagueRawJson: string | null
): Promise<RosterCoverageResult> {
  const mode = inferLeagueMode(leagueRawJson);
  
  if (!db) {
    return {
      league_id: leagueId,
      mode,
      total_players: 0,
      matched_players: 0,
      coverage_pct: 0,
      missing: [],
    };
  }
  
  const rosterPlayers = await db
    .select({
      player_id: schema.roster_players.player_id,
    })
    .from(schema.roster_players)
    .where(
      sql`${schema.roster_players.league_id} = ${leagueId} AND ${schema.roster_players.owner_id} = ${ownerId}`
    );
  
  const playerIds = rosterPlayers.map(r => r.player_id);
  
  if (playerIds.length === 0) {
    return {
      league_id: leagueId,
      mode,
      total_players: 0,
      matched_players: 0,
      coverage_pct: 100,
      missing: [],
    };
  }
  
  const players = await db
    .select({
      player_id: schema.players_master.player_id,
      full_name: schema.players_master.full_name,
      position: schema.players_master.position,
    })
    .from(schema.players_master)
    .where(inArray(schema.players_master.player_id, playerIds));
  
  const playerMap = new Map(players.map(p => [p.player_id, p]));
  
  const valuesMap = await getPlayerValuesMap(playerIds);
  
  const missing: Array<{ player_id: string; full_name: string; position: string }> = [];
  let matched = 0;
  
  for (const playerId of playerIds) {
    const playerInfo = playerMap.get(playerId);
    const valueInfo = valuesMap.get(playerId);
    
    const hasValue = mode === "sf" 
      ? valueInfo?.value_sf != null 
      : valueInfo?.value_1qb != null;
    
    if (hasValue) {
      matched++;
    } else {
      missing.push({
        player_id: playerId,
        full_name: playerInfo?.full_name || "Unknown",
        position: playerInfo?.position || "UNK",
      });
    }
  }
  
  missing.sort((a, b) => {
    const posOrder = ["QB", "RB", "WR", "TE", "K", "DEF"];
    const posA = posOrder.indexOf(a.position);
    const posB = posOrder.indexOf(b.position);
    if (posA !== posB) return posA - posB;
    return a.full_name.localeCompare(b.full_name);
  });
  
  const coveragePct = playerIds.length > 0 
    ? Math.round((matched / playerIds.length) * 1000) / 10 
    : 100;
  
  return {
    league_id: leagueId,
    mode,
    total_players: playerIds.length,
    matched_players: matched,
    coverage_pct: coveragePct,
    missing,
  };
}

export async function getPlayerValue(
  playerId: string,
  mode: "sf" | "1qb"
): Promise<number> {
  const valuesMap = await getPlayerValuesMap([playerId]);
  const valueInfo = valuesMap.get(playerId);
  
  if (!valueInfo) return 0;
  
  return (mode === "sf" ? valueInfo.value_sf : valueInfo.value_1qb) || 0;
}

export async function getRosterTotalValue(
  playerIds: string[],
  mode: "sf" | "1qb"
): Promise<{ total: number; missing: number }> {
  const valuesMap = await getPlayerValuesMap(playerIds);
  
  let total = 0;
  let missing = 0;
  
  for (const playerId of playerIds) {
    const valueInfo = valuesMap.get(playerId);
    const value = mode === "sf" ? valueInfo?.value_sf : valueInfo?.value_1qb;
    
    if (value != null) {
      total += value;
    } else {
      missing++;
    }
  }
  
  return { total, missing };
}
