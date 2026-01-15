import * as fs from "fs";
import * as path from "path";
import cache from "../cache";

interface FPRanking {
  rank: number;
  tier: number;
  playerName: string;
  team: string;
  position: string;
}

interface TradeValue {
  name: string;
  team: string;
  position: string;
  tradeValue: number | null;
  sfOrTepValue: number | null;
  valueChange: string | null;
}

interface PlayerMatch {
  player_id: string;
  full_name: string;
  position: string | null;
}

interface ImportResult {
  fp_rows: number;
  trade_rows: number;
  upserted_players: number;
  unmatched: Array<{ name: string; position: string; source: string }>;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "N/A" || s === "-" || s === "New" || s === "- / -") return null;
  const cleaned = s.replace(/[−–]/g, "-").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseFPCsv(content: string): FPRanking[] {
  const lines = content.split("\n");
  const results: FPRanking[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const match = line.match(/^"(\d+)",(\d+),"([^"]+)",([^,]+),"([^"]+)"/);
    if (match) {
      results.push({
        rank: parseInt(match[1], 10),
        tier: parseInt(match[2], 10),
        playerName: match[3],
        team: match[4],
        position: match[5].replace(/\d+$/, ""),
      });
    }
  }
  
  return results;
}

function parseTradeValuesCsv(content: string): TradeValue[] {
  const lines = content.split("\n");
  const results: TradeValue[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(",");
    if (parts.length < 4) continue;
    
    const name = parts[0];
    const team = parts[1];
    const position = parts[2];
    
    if (!name || name === "All Other QBs" || name === "All Other RBs" || 
        name === "All Other TEs" || name === "All Other WRs") continue;
    
    const tradeValue = parseNum(parts[3]);
    const sfOrTepValue = parseNum(parts[4]);
    const valueChange = parts[5]?.trim() || null;
    
    results.push({
      name,
      team,
      position,
      tradeValue,
      sfOrTepValue,
      valueChange,
    });
  }
  
  return results;
}

export async function importMarketValues(asOfYear: number): Promise<ImportResult> {
  const fpPath = path.join(process.cwd(), "attached_assets", "FantasyPros_2025_Dynasty_OP_Rankings_1768449572023.csv");
  const tradePath = path.join(process.cwd(), "attached_assets", "DynastyTradeValues_Jan2026.csv_-_Sheet1_1768449572023.csv");
  
  let fpContent = "";
  let tradeContent = "";
  
  try {
    fpContent = fs.readFileSync(fpPath, "utf-8");
  } catch (e) {
    console.error("Failed to read FantasyPros CSV:", e);
  }
  
  try {
    tradeContent = fs.readFileSync(tradePath, "utf-8");
  } catch (e) {
    console.error("Failed to read TradeValues CSV:", e);
  }
  
  const fpRankings = parseFPCsv(fpContent);
  const tradeValues = parseTradeValuesCsv(tradeContent);
  
  const players = await cache.getAllPlayers();
  
  const playersByNormName = new Map<string, PlayerMatch>();
  const aliases = await cache.getPlayerAliases();
  
  for (const p of players) {
    if (!p.full_name) continue;
    const norm = normName(p.full_name);
    playersByNormName.set(norm, {
      player_id: p.player_id,
      full_name: p.full_name,
      position: p.position || null,
    });
  }
  
  for (const alias of aliases) {
    const p = players.find(pl => pl.player_id === alias.player_id);
    if (p) {
      playersByNormName.set(normName(alias.alias), {
        player_id: p.player_id,
        full_name: p.full_name || alias.alias,
        position: p.position || null,
      });
    }
  }
  
  const merged = new Map<string, {
    player_id: string;
    position: string | null;
    fp_rank?: number;
    fp_tier?: number;
    trade_value_std?: number | null;
    trade_value_sf?: number | null;
    trade_value_tep?: number | null;
    trade_value_change?: string | null;
  }>();
  
  const unmatched: Array<{ name: string; position: string; source: string }> = [];
  
  for (const fp of fpRankings) {
    const norm = normName(fp.playerName);
    const match = playersByNormName.get(norm);
    
    if (match) {
      const existing = merged.get(match.player_id) || { 
        player_id: match.player_id, 
        position: match.position 
      };
      existing.fp_rank = fp.rank;
      existing.fp_tier = fp.tier;
      merged.set(match.player_id, existing);
    } else {
      unmatched.push({ name: fp.playerName, position: fp.position, source: "fantasypros" });
    }
  }
  
  for (const tv of tradeValues) {
    const norm = normName(tv.name);
    const match = playersByNormName.get(norm);
    
    if (match) {
      const existing = merged.get(match.player_id) || { 
        player_id: match.player_id, 
        position: match.position 
      };
      existing.trade_value_std = tv.tradeValue;
      existing.trade_value_change = tv.valueChange;
      
      if (tv.position === "QB" && tv.sfOrTepValue != null) {
        existing.trade_value_sf = tv.sfOrTepValue;
      } else if (tv.position === "TE" && tv.sfOrTepValue != null) {
        existing.trade_value_tep = tv.sfOrTepValue;
      }
      
      merged.set(match.player_id, existing);
    } else {
      unmatched.push({ name: tv.name, position: tv.position, source: "trade_values" });
    }
  }
  
  let upserted = 0;
  for (const [playerId, data] of Array.from(merged.entries())) {
    await cache.upsertMarketValue({
      player_id: playerId,
      as_of_year: asOfYear,
      fp_rank: data.fp_rank ?? null,
      fp_tier: data.fp_tier ?? null,
      trade_value_std: data.trade_value_std ?? null,
      trade_value_sf: data.trade_value_sf ?? null,
      trade_value_tep: data.trade_value_tep ?? null,
      trade_value_change: data.trade_value_change ?? null,
    });
    upserted++;
  }
  
  return {
    fp_rows: fpRankings.length,
    trade_rows: tradeValues.length,
    upserted_players: upserted,
    unmatched,
  };
}
