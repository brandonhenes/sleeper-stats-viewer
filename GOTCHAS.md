# Developer Gotchas - Sleeper Fantasy Scout

This document explains key caveats, edge cases, and implementation details that developers should be aware of when working on this codebase.

## Sleeper API Behavior

### Offseason Empty States
- During the NFL offseason (typically February-August), many endpoints return limited or no data
- Bracket data (`/winners_bracket`, `/losers_bracket`) won't exist until playoffs complete
- Matchups may be empty or partially populated
- Always check for null/undefined before accessing bracket or matchup data

### Rate Limiting & Concurrency
- Sleeper API has no official rate limit documentation, but we observe ~60 req/min soft limit
- Use `withConcurrencyLimit()` helper (limit=3 default) for batch API calls
- Sync operations should not run more frequently than every 10 minutes per user
- Auto-sync for trade targets uses CONCURRENCY_LIMIT=2 to avoid overwhelming the API

### Missing Bracket Data
- Not all leagues have playoff brackets (some end after regular season)
- Check if `winners_bracket` endpoint returns data before using it
- When bracket data is unavailable, label as "No playoff data" instead of guessing

## Season Finish Determination

### The Derivation Ladder (In Priority Order)
1. **Roster settings fields**: Check `roster.settings.playoff_rank`, `roster.settings.final_rank`, `roster.settings.rank`
2. **Bracket endpoints**: Fetch `/league/{id}/winners_bracket` and parse final matchups
3. **Never guess**: If neither source provides data, leave `finish_place` as null

### Why Regular-Season Rank Cannot Determine Champion
- Regular season standings don't predict playoff results
- A 6th seed can win the championship, a 1st seed can lose first round
- Only bracket data or roster settings can definitively identify champion/runner-up

### Source Tracking
- Season summaries include a `source` field: "bracket", "roster_settings", or "unknown"
- This helps debug why certain placements may look incorrect

## League Groups & History

### previous_league_id Chains
- Dynasty leagues often span multiple seasons with different `league_id`s each year
- The `previous_league_id` field chains these together into a single "league group"
- If `previous_league_id` points to a league not in our cache, the chain breaks
- We only follow chains within the user's cached leagues to avoid infinite API calls

### Season Mapping
- A single league group may contain leagues from multiple seasons
- `min_season` and `max_season` indicate the date range
- The "latest_league_id" is the most recent season's league ID

### Active vs Inactive Groups
- `is_active` flag indicates if the league has current/ongoing activity
- Leagues with status "complete" or very old seasons are marked inactive

## Draft Capital Computation

### Pick Ownership
- Fetched from `/league/{id}/traded_picks` endpoint
- Includes both original picks and traded picks
- Grouped by year and round (R1, R2, R3, R4)

### Year Scope
- "Current year" = current calendar year picks only
- "All future" = current + all future years with data
- Does NOT include historical/past draft picks

### Pick Hoard Index
- Calculated metric: sum of (pick_value × quantity) across all future picks
- Higher index = more future draft capital accumulated

## Trade Targets System

### Exposure-Based Ranking
- Opponents ranked by how much they want players on the user's roster
- Based on opponent's cross-league exposure to those players
- Higher exposure % = more interest in acquiring that player

### Sync Requirements
- Each opponent needs their own exposure profile synced to calculate scores
- "Needs sync" means we don't have recent exposure data for that user
- Auto-sync runs when modal opens with concurrency limit

### has_valid_username Flag
- Some roster owners may not have linked Sleeper usernames
- We can sync by `user_id` instead of `username` in these cases
- Display username may differ from actual login username

## Common Edge Cases

### Null Safety
- Always use null-safe formatting helpers (fmtNum, fmtPct)
- Check `?.` optional chaining before accessing nested properties
- Sleeper API returns inconsistent null vs undefined vs 0

### No-DB Fallback Mode
- When database is unavailable, app falls back to direct Sleeper API calls
- Responses include `degraded: true` flag
- Features like trade history and H2H records are disabled in this mode

### Playoff Types
- Some leagues use bracket playoffs, others use consolation rounds
- Losers bracket determines lower finish positions (e.g., 5th-8th place)
- Not all leagues have both winners and losers brackets
