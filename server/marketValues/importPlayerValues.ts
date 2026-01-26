import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import cache from "../cache";
import { db } from "../db";
import * as schema from "../../shared/schema";
import { sql } from "drizzle-orm";

const DATA_DIR = path.join(process.cwd(), "server/data");
const CSV_1QB = path.join(DATA_DIR, "fantasypros_dynasty_1qb.csv");
const CSV_SF = path.join(DATA_DIR, "fantasypros_dynasty_sf.csv");
const OVERRIDES_FILE = path.join(DATA_DIR, "value_overrides.json");
const UNMATCHED_REPORT = path.join(DATA_DIR, "unmatched_report.csv");

interface ParsedRow {
  name: string;
  position: string;
  team: string;
  value: number;
  rank: number | null;
}

interface PlayerMatch {
  player_id: string;
  full_name: string | null;
  position: string | null;
}

interface MergedValue {
  player_id: string;
  full_name: string;
  position: string;
  value_1qb: number | null;
  value_sf: number | null;
  rank_dynasty: number | null;
}

interface UnmatchedRow {
  mode: string;
  raw_name: string;
  raw_pos: string;
  raw_team: string;
  raw_value: number;
  normalized_name: string;
  normalized_pos: string;
  reason: string;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePos(pos: string): string {
  const p = (pos || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST") return "DEF";
  return p;
}

function detectColumn(headers: string[], ...patterns: string[]): number {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  for (const pattern of patterns) {
    const idx = lowerHeaders.findIndex(h => h.includes(pattern.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseValue(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const num = Number(String(v).replace(/[^0-9.]/g, ""));
  return isNaN(num) ? 0 : Math.round(num);
}

function parseRank(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const num = Number(String(v).replace(/[^0-9]/g, ""));
  return isNaN(num) ? null : num;
}

function parseCSV(filePath: string): ParsedRow[] {
  if (!fs.existsSync(filePath)) {
    console.log(`CSV file not found: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const records = parse(content, {
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as string[][];

  if (records.length < 2) {
    console.log(`CSV file has no data rows: ${filePath}`);
    return [];
  }

  const headers = records[0];
  const nameIdx = detectColumn(headers, "player", "name");
  const posIdx = detectColumn(headers, "pos", "position");
  const teamIdx = detectColumn(headers, "team");
  const valueIdx = detectColumn(headers, "value", "trade value", "dynasty value");
  const rankIdx = detectColumn(headers, "rank", "overall rank");

  if (nameIdx === -1 || valueIdx === -1) {
    console.log(`Required columns not found in ${filePath}. Headers: ${headers.join(", ")}`);
    return [];
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    const name = row[nameIdx]?.trim() || "";
    const position = posIdx !== -1 ? row[posIdx]?.trim() || "" : "";
    const team = teamIdx !== -1 ? row[teamIdx]?.trim() || "" : "";
    const value = parseValue(row[valueIdx]);
    const rank = rankIdx !== -1 ? parseRank(row[rankIdx]) : null;

    if (name && value > 0) {
      rows.push({ name, position, team, value, rank });
    }
  }

  return rows;
}

function buildPlayerIndex(players: PlayerMatch[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of players) {
    const key = `${normalizeName(p.full_name || "")}|${normalizePos(p.position || "")}`;
    if (!index.has(key)) {
      index.set(key, p.player_id);
    }
  }
  return index;
}

function loadOverrides(): Map<string, string> {
  const overrides = new Map<string, string>();
  if (fs.existsSync(OVERRIDES_FILE)) {
    try {
      const content = JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf-8"));
      for (const [key, playerId] of Object.entries(content)) {
        overrides.set(key.toLowerCase(), playerId as string);
      }
      console.log(`Loaded ${overrides.size} overrides from ${OVERRIDES_FILE}`);
    } catch (e) {
      console.log(`Failed to parse overrides file: ${e}`);
    }
  }
  return overrides;
}

function writeUnmatchedReport(unmatched: UnmatchedRow[]): void {
  if (unmatched.length === 0) {
    console.log("No unmatched rows to report");
    return;
  }

  const headers = ["mode", "raw_name", "raw_pos", "raw_team", "raw_value", "normalized_name", "normalized_pos", "reason"];
  const lines = [headers.join(",")];
  for (const row of unmatched) {
    lines.push([
      row.mode,
      `"${row.raw_name.replace(/"/g, '""')}"`,
      row.raw_pos,
      row.raw_team,
      row.raw_value,
      `"${row.normalized_name}"`,
      row.normalized_pos,
      `"${row.reason}"`,
    ].join(","));
  }

  fs.writeFileSync(UNMATCHED_REPORT, lines.join("\n"));
  console.log(`Unmatched report written to: ${UNMATCHED_REPORT}`);
}

async function importPlayerValues(): Promise<void> {
  console.log("=== Player Values Import ===");
  console.log(`Data directory: ${DATA_DIR}`);

  const allPlayers = await cache.getAllPlayers();
  console.log(`Loaded ${allPlayers.length} players from players_master`);

  const playerIndex = buildPlayerIndex(allPlayers);
  const overrides = loadOverrides();

  const rows1qb = parseCSV(CSV_1QB);
  const rowsSf = parseCSV(CSV_SF);

  console.log(`1QB CSV rows: ${rows1qb.length}`);
  console.log(`SF CSV rows: ${rowsSf.length}`);

  if (rows1qb.length === 0 && rowsSf.length === 0) {
    console.log("No CSV data to import. Please add CSVs to server/data/");
    return;
  }

  const merged = new Map<string, MergedValue>();
  const unmatched: UnmatchedRow[] = [];

  function processRows(rows: ParsedRow[], mode: "1qb" | "sf"): void {
    for (const row of rows) {
      const normalizedName = normalizeName(row.name);
      const normalizedPos = normalizePos(row.position);
      const lookupKey = `${normalizedName}|${normalizedPos}`;

      let playerId = overrides.get(lookupKey) || playerIndex.get(lookupKey);

      if (!playerId && normalizedPos) {
        const entries = Array.from(playerIndex.entries());
        for (const [key, id] of entries) {
          if (key.startsWith(normalizedName + "|")) {
            playerId = id;
            break;
          }
        }
      }

      if (!playerId) {
        unmatched.push({
          mode,
          raw_name: row.name,
          raw_pos: row.position,
          raw_team: row.team,
          raw_value: row.value,
          normalized_name: normalizedName,
          normalized_pos: normalizedPos,
          reason: "no match in players_master index",
        });
        continue;
      }

      const player = allPlayers.find(p => p.player_id === playerId);
      const existing = merged.get(playerId) || {
        player_id: playerId,
        full_name: player?.full_name || row.name,
        position: normalizedPos || player?.position || "",
        value_1qb: null,
        value_sf: null,
        rank_dynasty: null,
      };

      if (mode === "1qb") {
        existing.value_1qb = row.value;
      } else {
        existing.value_sf = row.value;
      }

      if (row.rank !== null && existing.rank_dynasty === null) {
        existing.rank_dynasty = row.rank;
      }

      merged.set(playerId, existing);
    }
  }

  processRows(rows1qb, "1qb");
  processRows(rowsSf, "sf");

  console.log(`Matched player_ids: ${merged.size}`);
  console.log(`Unmatched rows: ${unmatched.length}`);

  writeUnmatchedReport(unmatched);

  const values = Array.from(merged.values());
  const BATCH_SIZE = 500;
  let upserted = 0;

  if (!db) {
    console.error("Database not available");
    return;
  }

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    const now = Date.now();

    await db
      .insert(schema.player_values)
      .values(batch.map(v => ({
        player_id: v.player_id,
        full_name: v.full_name,
        position: v.position,
        value_1qb: v.value_1qb,
        value_sf: v.value_sf,
        rank_dynasty: v.rank_dynasty,
        updated_at: now,
      })))
      .onConflictDoUpdate({
        target: schema.player_values.player_id,
        set: {
          full_name: sql`EXCLUDED.full_name`,
          position: sql`EXCLUDED.position`,
          value_1qb: sql`COALESCE(EXCLUDED.value_1qb, ${schema.player_values.value_1qb})`,
          value_sf: sql`COALESCE(EXCLUDED.value_sf, ${schema.player_values.value_sf})`,
          rank_dynasty: sql`COALESCE(EXCLUDED.rank_dynasty, ${schema.player_values.rank_dynasty})`,
          updated_at: sql`EXCLUDED.updated_at`,
        },
      });

    upserted += batch.length;
    console.log(`Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rows (total: ${upserted})`);
  }

  console.log("=== Import Complete ===");
  console.log(`Total rows read from 1QB CSV: ${rows1qb.length}`);
  console.log(`Total rows read from SF CSV: ${rowsSf.length}`);
  console.log(`Total matched player_ids: ${merged.size}`);
  console.log(`Unmatched 1QB: ${unmatched.filter(u => u.mode === "1qb").length}`);
  console.log(`Unmatched SF: ${unmatched.filter(u => u.mode === "sf").length}`);
  console.log(`DB rows upserted: ${upserted}`);
  console.log(`Unmatched report: ${UNMATCHED_REPORT}`);
}

if (require.main === module) {
  importPlayerValues()
    .then(() => process.exit(0))
    .catch(e => {
      console.error("Import failed:", e);
      process.exit(1);
    });
}

export { importPlayerValues, normalizeName, normalizePos };
