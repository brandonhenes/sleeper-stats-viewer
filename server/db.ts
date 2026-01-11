import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

export type StorageMode = "postgres" | "no-db";

function parseHostFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "unknown";
  } catch {
    return "parse-error";
  }
}

function getDatabaseUrl(): string | null {
  // Multiple ways to detect deployment mode
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1" 
    || process.env.NODE_ENV === "production";
  
  console.log(`[db] Deployment detection: REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}, NODE_ENV=${process.env.NODE_ENV}, isDeployment=${isDeployment}`);
  
  // In deployment, check for production database file first
  if (isDeployment && existsSync("/tmp/replitdb")) {
    try {
      const url = readFileSync("/tmp/replitdb", "utf-8").trim();
      const host = parseHostFromUrl(url);
      console.log(`[db] Deployment mode: Using production database (host: ${host})`);
      return url;
    } catch (e) {
      console.warn("[db] Could not read /tmp/replitdb:", e);
    }
  }
  
  if (!process.env.DATABASE_URL) {
    console.warn("[db] DATABASE_URL not set - running in no-db fallback mode");
    return null;
  }
  
  const host = parseHostFromUrl(process.env.DATABASE_URL);
  
  // ALWAYS reject internal hostnames - they never work in published apps
  // "helium" is Replit's internal DB proxy hostname
  if (host === "helium" || host.includes("localhost") || host === "127.0.0.1") {
    if (isDeployment) {
      console.error(`[db] CRITICAL: DATABASE_URL points to internal hostname '${host}' which is not accessible in deployments.`);
      console.error("[db] Running in no-db fallback mode - using direct Sleeper API calls.");
      return null;
    } else {
      // In development, internal hostnames are fine
      console.log(`[db] Development mode: Using internal hostname '${host}'`);
      return process.env.DATABASE_URL;
    }
  }
  
  console.log(`[db] Using DATABASE_URL environment variable (host: ${host}, deployment: ${isDeployment})`);
  return process.env.DATABASE_URL;
}

let connectionString: string | null = null;
let dbInitError: Error | null = null;
let storageMode: StorageMode = "no-db";

try {
  connectionString = getDatabaseUrl();
  if (connectionString) {
    storageMode = "postgres";
  }
} catch (e) {
  dbInitError = e as Error;
  connectionString = null;
  storageMode = "no-db";
}

export const pool = connectionString ? new Pool({ 
  connectionString,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
}) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[db] Unexpected pool error:', err);
  });
}

export const db = pool ? drizzle(pool, { schema }) : null;
export { dbInitError, storageMode };

console.log(`[db] Storage mode: ${storageMode}`);
