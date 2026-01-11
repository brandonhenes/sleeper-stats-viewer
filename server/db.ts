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
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1";
  
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
  
  // In deployment, reject internal hostnames that won't be accessible
  if (isDeployment && (host === "helium" || host.includes("localhost") || host === "127.0.0.1")) {
    console.error(`[db] CRITICAL: DATABASE_URL points to internal hostname '${host}' which is not accessible in deployments.`);
    console.error("[db] Running in no-db fallback mode - using direct Sleeper API calls.");
    return null;
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
