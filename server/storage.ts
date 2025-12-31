import { db } from "./db";
// We don't really have database storage needs for this proxy app
// but we keep the file for architectural consistency.

export interface IStorage {
  // Add DB methods here if we decide to cache data later
}

export class MemStorage implements IStorage {
  // Empty implementation for now
}

export const storage = new MemStorage();
