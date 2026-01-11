import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

function parseHostFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname || "unknown";
  } catch {
    return "parse-error";
  }
}

function getDatabaseUrl(): string {
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1";
  
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
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  
  const host = parseHostFromUrl(process.env.DATABASE_URL);
  
  if (isDeployment && host === "helium") {
    console.error("[db] CRITICAL: DATABASE_URL points to internal hostname 'helium' which is not accessible in deployments.");
    console.error("[db] Please ensure a production database is provisioned for this deployment.");
    throw new Error("Database misconfigured for deployment - internal hostname not accessible");
  }
  
  console.log(`[db] Using DATABASE_URL environment variable (host: ${host}, deployment: ${isDeployment})`);
  return process.env.DATABASE_URL;
}

let connectionString: string;
let dbInitError: Error | null = null;

try {
  connectionString = getDatabaseUrl();
} catch (e) {
  dbInitError = e as Error;
  connectionString = ""; 
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
export { dbInitError };
