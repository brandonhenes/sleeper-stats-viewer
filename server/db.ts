import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { readFileSync, existsSync } from "fs";

const { Pool } = pg;

function getDatabaseUrl(): string {
  if (existsSync("/tmp/replitdb")) {
    try {
      return readFileSync("/tmp/replitdb", "utf-8").trim();
    } catch (e) {
      console.warn("Could not read /tmp/replitdb, falling back to DATABASE_URL");
    }
  }
  
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  
  return process.env.DATABASE_URL;
}

const connectionString = getDatabaseUrl();
export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
