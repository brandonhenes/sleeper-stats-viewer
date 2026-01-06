import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

function getDatabaseUrl(): string {
  if (existsSync("/tmp/replitdb")) {
    try {
      const url = readFileSync("/tmp/replitdb", "utf-8").trim();
      console.log("[db] Using production database from /tmp/replitdb");
      return url;
    } catch (e) {
      console.warn("[db] Could not read /tmp/replitdb, falling back to DATABASE_URL");
    }
  }
  
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  
  console.log("[db] Using DATABASE_URL environment variable");
  return process.env.DATABASE_URL;
}

const connectionString = getDatabaseUrl();
export const pool = new Pool({ 
  connectionString,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err);
});

export const db = drizzle(pool, { schema });
