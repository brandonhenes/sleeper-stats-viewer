import { z } from 'zod';
import { 
  overviewResponseSchema, 
  leagueDetailsResponseSchema,
  syncResponseSchema,
  syncStatusSchema,
  h2hResponseSchema,
  tradesResponseSchema,
  playerExposureResponseSchema,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  sleeper: {
    // GET /api/overview?username=...&season=...
    // Returns cached data immediately with sync status flags
    overview: {
      method: 'GET' as const,
      path: '/api/overview',
      input: z.object({
        username: z.string(),
        season: z.coerce.number().int().optional(),
      }),
      responses: {
        200: overviewResponseSchema,
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },

    // GET /api/league/:leagueId
    league: {
      method: 'GET' as const,
      path: '/api/league/:leagueId',
      responses: {
        200: leagueDetailsResponseSchema,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },

    // POST /api/sync?username=...
    // Starts a background sync job (non-blocking)
    sync: {
      method: 'POST' as const,
      path: '/api/sync',
      input: z.object({
        username: z.string()
      }),
      responses: {
        200: syncResponseSchema,
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        429: z.object({ message: z.string() }), // rate limited
        500: errorSchemas.internal
      },
    },

    // GET /api/sync/status?job_id=...
    // Returns sync job progress
    syncStatus: {
      method: 'GET' as const,
      path: '/api/sync/status',
      input: z.object({
        job_id: z.string()
      }),
      responses: {
        200: syncStatusSchema,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },

    // GET /api/group/:groupId/h2h?username=...&season=...
    // Returns head-to-head records vs each opponent (on-demand, cached)
    h2h: {
      method: 'GET' as const,
      path: '/api/group/:groupId/h2h',
      input: z.object({
        username: z.string(),
        season: z.coerce.number().int().optional(),
      }),
      responses: {
        200: h2hResponseSchema,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },

    // GET /api/group/:groupId/trades
    // Returns all trades for leagues in this group
    trades: {
      method: 'GET' as const,
      path: '/api/group/:groupId/trades',
      responses: {
        200: tradesResponseSchema,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },

    // GET /api/players/exposure?username=...
    // Returns player exposure analysis across all leagues
    playerExposure: {
      method: 'GET' as const,
      path: '/api/players/exposure',
      input: z.object({
        username: z.string()
      }),
      responses: {
        200: playerExposureResponseSchema,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
