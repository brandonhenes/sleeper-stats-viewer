import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import cache from "../cache";

interface PickValueRow {
  Draft_Pick_Year: string;
  Pick_Description: string;
  "1QB_Value": string;
  Superflex_Value: string;
}

interface ParsedPickValue {
  pick_year: number;
  pick_round: number;
  pick_tier: string;
  value_1qb: number;
  value_sf: number;
}

interface ImportResult {
  rows_imported: number;
  rows_skipped: number;
  years: number[];
}

function parsePickDescription(desc: string): { round: number; tier: string } | null {
  const normalized = desc.trim().toLowerCase();
  
  if (normalized.includes("1.01") && normalized.includes("1.03")) {
    return { round: 1, tier: "1.01-1.03" };
  }
  if (normalized.includes("1.04") && normalized.includes("1.06")) {
    return { round: 1, tier: "1.04-1.06" };
  }
  if (normalized.includes("1.07") && normalized.includes("1.12")) {
    return { round: 1, tier: "1.07-1.12" };
  }
  if (normalized.includes("early second")) {
    return { round: 2, tier: "early" };
  }
  if (normalized.includes("late second")) {
    return { round: 2, tier: "late" };
  }
  if (normalized.includes("early third")) {
    return { round: 3, tier: "early" };
  }
  if (normalized.includes("late third")) {
    return { round: 3, tier: "late" };
  }
  if (normalized.includes("all others") || normalized.includes("4th") || normalized.includes("later")) {
    return { round: 4, tier: "all" };
  }
  
  return null;
}

function parseNumber(val: string): number | null {
  if (!val) return null;
  const cleaned = val.trim().replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export async function importDraftPickValues(csvPath: string): Promise<ImportResult> {
  const content = fs.readFileSync(csvPath, "utf-8");
  
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  const parsed: ParsedPickValue[] = [];
  const yearsSet = new Set<number>();
  let skipped = 0;

  for (const row of records) {
    const yearKey = Object.keys(row).find(k => k.toLowerCase().includes("year"));
    const descKey = Object.keys(row).find(k => k.toLowerCase().includes("description"));
    const oneQbKey = Object.keys(row).find(k => k.includes("1QB") || k.toLowerCase().includes("1qb"));
    const sfKey = Object.keys(row).find(k => k.toLowerCase().includes("superflex") || k.toLowerCase() === "sf_value");

    if (!yearKey || !descKey || !oneQbKey || !sfKey) {
      skipped++;
      continue;
    }

    const year = parseNumber(row[yearKey]);
    const desc = row[descKey];
    const value1qb = parseNumber(row[oneQbKey]);
    const valueSf = parseNumber(row[sfKey]);

    if (!year || !desc || value1qb === null || valueSf === null) {
      skipped++;
      continue;
    }

    const pickInfo = parsePickDescription(desc);
    if (!pickInfo) {
      console.log(`[import-pick-values] Skipping unrecognized description: "${desc}"`);
      skipped++;
      continue;
    }

    parsed.push({
      pick_year: year,
      pick_round: pickInfo.round,
      pick_tier: pickInfo.tier,
      value_1qb: value1qb,
      value_sf: valueSf,
    });
    yearsSet.add(year);
  }

  for (const pv of parsed) {
    await cache.upsertDraftPickValue(pv);
  }

  const yearsArray = Array.from(yearsSet);
  console.log(`[import-pick-values] Imported ${parsed.length} pick values for years: ${yearsArray.join(", ")}`);

  return {
    rows_imported: parsed.length,
    rows_skipped: skipped,
    years: yearsArray.sort((a, b) => a - b),
  };
}

export async function importFromAttachedAsset(): Promise<ImportResult> {
  const possiblePaths = [
    "attached_assets/DynastyTradeValuesDP_Jan2026.csv_-_Sheet1_1769304846012.csv",
    "attached_assets/DynastyTradeValuesDP_Jan2026.csv_-_Sheet1_1768620976740.csv",
    "attached_assets/DynastyTradeValuesDP_Jan2026.csv",
  ];
  
  for (const p of possiblePaths) {
    const fullPath = path.resolve(p);
    if (fs.existsSync(fullPath)) {
      console.log(`[import-pick-values] Found CSV at: ${fullPath}`);
      return importDraftPickValues(fullPath);
    }
  }
  
  throw new Error("Draft pick values CSV not found in attached_assets");
}
