# Production Bug Root Cause Analysis

## Issue Summary
External users hit 500 errors on:
- `GET /api/overview?username=...`
- `GET /api/players/exposure?...`

Deployment logs showed: `getaddrinfo EAI_AGAIN helium`

## Root Cause
The `DATABASE_URL` environment variable in the development environment points to an internal Replit hostname `helium` which is only accessible within the Replit development container. 

When the app is deployed (published), this internal hostname is not resolvable, causing DNS lookup failures (`EAI_AGAIN` = "try again" DNS error).

### Code Path
1. **server/db.ts** reads `process.env.DATABASE_URL`
2. In deployment, this URL contains hostname `helium` (internal Replit DB proxy)
3. The PostgreSQL connection pool attempts to connect
4. DNS fails with `getaddrinfo EAI_AGAIN helium`
5. Request handlers crash with 500 errors

## Fix Applied
Modified `server/db.ts` to detect deployment mode and reject internal hostnames:

```typescript
// In deployment, reject internal hostnames that won't be accessible
if (isDeployment && (host === "helium" || host.includes("localhost") || host === "127.0.0.1")) {
  console.error(`[db] CRITICAL: DATABASE_URL points to internal hostname '${host}'`);
  return null; // Falls back to no-db mode
}
```

When database is unavailable:
- App enters "no-db" fallback mode
- Fetches data directly from Sleeper API
- Returns `degraded: true` flag in responses
- Core functionality remains available

## Prevention
- Always check if `DATABASE_URL` is externally accessible before deployment
- Use Replit's production database provisioning for deployed apps
- The `/api/health` endpoint now reports storage mode and DB connectivity
