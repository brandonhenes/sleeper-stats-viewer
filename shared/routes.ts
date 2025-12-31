import { z } from 'zod';
import { 
  overviewResponseSchema, 
  leagueDetailsResponseSchema,
  syncResponseSchema
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
    overview: {
      method: 'GET' as const,
      path: '/api/overview',
      input: z.object({
        username: z.string()
      }),
      responses: {
        200: overviewResponseSchema,
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },
    league: {
      method: 'GET' as const,
      path: '/api/league/:leagueId',
      responses: {
        200: leagueDetailsResponseSchema,
        404: errorSchemas.notFound,
        500: errorSchemas.internal
      },
    },
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
