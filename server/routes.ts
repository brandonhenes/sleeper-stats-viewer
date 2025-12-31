import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

const BASE = "https://api.sleeper.app/v1";

// Helper function from original code
async function jget(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null; // Handle 404 gracefully for some endpoints
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function getUserByUsername(username: string) {
  return jget(`${BASE}/user/${encodeURIComponent(username)}`);
}

async function getLeaguesForSeason(userId: string, sport: string, season: number) {
  return jget(`${BASE}/user/${userId}/leagues/${sport}/${season}`);
}

async function getLeagueUsers(leagueId: string) {
  return jget(`${BASE}/league/${leagueId}/users`);
}

async function getLeagueRosters(leagueId: string) {
  return jget(`${BASE}/league/${leagueId}/rosters`);
}

async function getLeague(leagueId: string) {
    return jget(`${BASE}/league/${leagueId}`);
}


export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.sleeper.overview.path, async (req, res) => {
    try {
      const { username } = api.sleeper.overview.input.parse(req.query);
      
      const user = await getUserByUsername(username);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const userId = user.user_id;

      // "Since inception": brute-force seasons. 
      const sport = "nfl";
      const startSeason = 2017;
      const endSeason = new Date().getFullYear() + 1; // Include next season just in case

      const leaguesBySeason: Record<string, any[]> = {};
      
      // Run these in parallel chunks to speed it up slightly, but be careful of rate limits
      // Linear loop is safer for now as per original code, but we can optimise slightly with Promise.all
      const seasons = [];
      for (let s = startSeason; s <= endSeason; s++) seasons.push(s);

      const results = await Promise.all(
        seasons.map(async (season) => {
           const leagues = await getLeaguesForSeason(userId, sport, season);
           return { season, leagues };
        })
      );

      results.forEach(({ season, leagues }) => {
        if (leagues && leagues.length > 0) {
          leaguesBySeason[season] = leagues;
        }
      });

      res.json({ user, leaguesBySeason });
    } catch (e) {
      console.error("Overview error:", e);
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input" });
      }
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  app.get(api.sleeper.league.path, async (req, res) => {
    try {
      const { leagueId } = req.params;
      
      // Fetch users and rosters in parallel
      const [users, rosters] = await Promise.all([
        getLeagueUsers(leagueId),
        getLeagueRosters(leagueId),
      ]);

      if (!users || !rosters) {
         return res.status(404).json({ message: "League details not found" });
      }

      res.json({ leagueId, users, rosters });
    } catch (e) {
      console.error("League error:", e);
      res.status(500).json({ message: e instanceof Error ? e.message : "Internal server error" });
    }
  });

  return httpServer;
}
