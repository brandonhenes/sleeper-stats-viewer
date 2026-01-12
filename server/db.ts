import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

export type StorageMode = "postgres" | "no-db";

interface ParsedDbUrl {
  protocol: string;
  host: string;
  port: string;
  source: string;
}

function parseDbUrl(url: string, source: string): ParsedDbUrl | null {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      host: parsed.hostname || "unknown",
      port: parsed.port || "default",
      source,
    };
  } catch {
    return null;
  }
}

function isValidPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function logDbSelection(info: ParsedDbUrl | null, accepted: boolean) {
  if (!info) {
    console.log(`[db] URL parse failed`);
    return;
  }
  const status = accepted ? "ACCEPTED" : "REJECTED";
  console.log(`[db] ${status}: protocol=${info.protocol} host=${info.host} port=${info.port} source=${info.source}`);
}

function getDatabaseUrl(): string | null {
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1" 
    || process.env.NODE_ENV === "production";
  
  console.log(`[db] Deployment detection: REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}, NODE_ENV=${process.env.NODE_ENV}, isDeployment=${isDeployment}`);
  
  // In deployment, check for production database file first
  if (isDeployment && existsSync("/tmp/replitdb")) {
    try {
      const url = readFileSync("/tmp/replitdb", "utf-8").trim();
      const info = parseDbUrl(url, "/tmp/replitdb");
      
      // CRITICAL: Only accept postgres:// or postgresql:// URLs
      // kv.replit.com is Replit's KV store, NOT Postgres!
      if (!isValidPostgresUrl(url)) {
        console.warn(`[db] /tmp/replitdb contains non-Postgres URL (protocol: ${info?.protocol || 'unknown'})`);
        logDbSelection(info, false);
        // Fall through to check DATABASE_URL
      } else if (info?.host === "kv.replit.com") {
        console.warn(`[db] /tmp/replitdb points to kv.replit.com which is NOT a Postgres database`);
        logDbSelection(info, false);
        // Fall through to check DATABASE_URL
      } else if (info) {
        logDbSelection(info, true);
        return url;
      }
    } catch (e) {
      console.warn("[db] Could not read /tmp/replitdb:", e);
    }
  }
  
  if (!process.env.DATABASE_URL) {
    console.warn("[db] DATABASE_URL not set - running in no-db fallback mode");
    return null;
  }
  
  const info = parseDbUrl(process.env.DATABASE_URL, "DATABASE_URL env");
  
  // Validate it's actually a Postgres URL
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    console.error(`[db] DATABASE_URL is not a Postgres URL (protocol: ${info?.protocol || 'unknown'})`);
    logDbSelection(info, false);
    return null;
  }
  
  // Reject kv.replit.com - it's not Postgres
  if (info?.host === "kv.replit.com") {
    console.error(`[db] DATABASE_URL points to kv.replit.com which is NOT a Postgres database`);
    logDbSelection(info, false);
    return null;
  }
  
  // Reject internal hostnames in deployments
  if (info?.host === "helium" || info?.host.includes("localhost") || info?.host === "127.0.0.1") {
    if (isDeployment) {
      console.error(`[db] DATABASE_URL points to internal hostname '${info.host}' which is not accessible in deployments.`);
      logDbSelection(info, false);
      return null;
    } else {
      console.log(`[db] Development mode: internal hostname allowed`);
      logDbSelection(info, true);
      return process.env.DATABASE_URL;
    }
  }
  
  logDbSelection(info, true);
  return process.env.DATABASE_URL;
}

let connectionString: string | null = null;
let dbInitError: Error | null = null;
let storageMode: StorageMode = "no-db";
let dbVerified = false;

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

export let pool: pg.Pool | null = connectionString ? new Pool({ 
  connectionString,
  connectionTimeoutMillis: 5000, // Reduced for faster failure detection
  idleTimeoutMillis: 30000,
  max: 10,
}) : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[db] Unexpected pool error:', err);
  });
}

export let db = pool ? drizzle(pool, { schema }) : null;

// Async function to verify DB connection at startup
// If connection fails, switch to no-db mode
export async function verifyDbConnection(): Promise<boolean> {
  if (dbVerified) return storageMode === "postgres";
  if (!pool) {
    dbVerified = true;
    return false;
  }
  
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('[db] Database connection verified successfully');
    dbVerified = true;
    return true;
  } catch (e) {
    console.error('[db] Database connection failed, switching to no-db mode:', (e as Error).message);
    storageMode = "no-db";
    db = null;
    pool = null;
    dbVerified = true;
    return false;
  }
}

export function getStorageMode(): StorageMode {
  return storageMode;
}

export { dbInitError };

console.log(`[db] Initial storage mode: ${storageMode} (verification pending)`);
