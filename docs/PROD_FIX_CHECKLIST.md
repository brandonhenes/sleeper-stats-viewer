# Production Fix Checklist

## Files Changed

| File | Change |
|------|--------|
| `server/db.ts` | Added detection for internal hostnames (helium, localhost, 127.0.0.1) in deployment mode; falls back to no-db mode gracefully |
| `server/cache.ts` | Added `isDbAvailable()` function and `storageMode` export |
| `server/routes.ts` | Added `/api/health` endpoint; updated `/api/overview` and `/api/players/exposure` to use direct Sleeper API fallback when DB unavailable; added `fetchLeaguesFromSleeperDirect()` helper with timeout/retry |
| `client/src/components/TeamsSection.tsx` | Fixed `.toFixed()` crash with null-safe formatting |
| `client/src/components/TradeTargetsModal.tsx` | Fixed `.toFixed()` crash with null-safe formatting |
| `client/src/pages/LeagueGroupDetails.tsx` | Added `fmtNum()` and `fmtPct()` helpers for safe number formatting |

## Verification Steps

### 1. Check Health Endpoint
```bash
curl -s https://YOUR-APP.replit.app/api/health | jq
```
Expected: JSON with `status: "ok"` and `storage_mode` field

### 2. Test Overview Endpoint
```bash
curl -s "https://YOUR-APP.replit.app/api/overview?username=henes35" | head -c 500
```
Expected: HTTP 200 with JSON containing `user` object and `league_groups` array

### 3. Test Exposure Endpoint
```bash
curl -s "https://YOUR-APP.replit.app/api/players/exposure?username=henes35" | head -c 500
```
Expected: HTTP 200 with JSON (may include `degraded: true` if no DB)

### 4. Check for Frontend Crashes
- Navigate to any league details page
- Verify no blank screens or "undefined" errors
- Check browser console for errors

## Known Limitations in No-DB Mode

When database is unavailable (degraded mode):
- Only fetches leagues from current + previous season (rate limit protection)
- No trade history or H2H records
- No player exposure calculations
- Responses include `degraded: true` flag

## Remaining Issues

1. **Production Database**: For full functionality, a production database must be provisioned that uses an externally-accessible hostname
2. **Sleeper API Rate Limits**: Direct API fallback mode is subject to Sleeper's undocumented rate limits (~60 req/min)
3. **Historical Data**: League chains beyond 2 seasons require DB caching

## Rollback

If issues persist, the changes are safe to roll back as they only add fallback behavior - no existing functionality was removed.
