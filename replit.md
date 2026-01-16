# Sleeper Fantasy Scout

## Overview
Sleeper Fantasy Scout is a full-stack web application designed for Sleeper Fantasy Sports users. It enables users to analyze their fantasy leagues across multiple seasons, evaluate player exposure, compare their performance with other users, and track trade history. The application leverages the Sleeper API to retrieve league data and provides features like condensed league groups, head-to-head records, and detailed trade analysis. The project aims to provide comprehensive scouting tools for fantasy sports enthusiasts, offering insights into league dynamics and player management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter
- **State Management**: TanStack React Query
- **Styling**: Tailwind CSS with shadcn/ui components
- **Animations**: Framer Motion
- **Build Tool**: Vite

### Backend
- **Framework**: Express.js with TypeScript
- **API Pattern**: REST endpoints (`/api/` prefix)
- **External API Integration**: Sleeper API (with concurrency limiting)
- **Development**: tsx for execution, Vite middleware for HMR

### Data Flow and Caching
- User input triggers data sync from Sleeper API.
- Data is cached in PostgreSQL using Drizzle ORM.
- Cache includes users, leagues, rosters, trades, player master data, and various aggregated statistics.
- Sync operations are asynchronous and rate-limited. Player database refreshes daily.

### Key Features
- **League Grouping**: Condenses multi-season leagues.
- **Dynasty/Redraft Filtering**: Filters leagues by type.
- **Trade History**: Detailed trade timelines for league groups.
- **Player Exposure**: Analyzes player ownership across leagues.
- **User Comparison**: Compares stats between users.
- **Head-to-Head Records**: Tracks H2H performance against opponents.
- **Scouting Leaderboards**: Provides various scouting metrics for all rosters in a league (e.g., Draft Capital, Strength, Consistency, Churn, Trading).
- **Season History**: Displays season-by-season placement and performance.

### API Endpoints (Examples)
- `GET /api/overview?username=<username>`: User info and league groups.
- `POST /api/sync?username=<username>`: Initiates background data synchronization.
- `GET /api/group/:groupId/h2h?username=<username>`: Head-to-head records for a league group.
- `GET /api/players/exposure?username=<username>`: Player exposure analysis.
- `GET /api/league/:leagueId/scouting/draft-capital`: Draft capital leaderboard for a league.
- `GET /api/group/:groupId/seasons?username=<username>`: Season history for a league group.

### Frontend Routes (Examples)
- `/`: Home page.
- `/u/:username`: User profile with league groups.
- `/u/:username/league/:groupId`: League group details.
- `/players/:username`: Player exposure.
- `/compare/:userA/:userB`: User comparison results.

### Shared Code
- `shared/schema.ts`: Zod schemas for API responses and types.
- `shared/routes.ts`: API route definitions.

## External Dependencies

### Third-Party APIs
- **Sleeper API** (https://api.sleeper.app/v1): Primary data source for fantasy sports data (users, leagues, rosters, transactions, NFL players). No authentication required.

### Database
- **PostgreSQL**: Used for data caching and persistence via Drizzle ORM.

### Key NPM Packages
- `drizzle-orm` + `drizzle-kit`: ORM for PostgreSQL.
- `pg`: PostgreSQL client.
- `@tanstack/react-query`: Server state management.
- `framer-motion`: Animations.
- `zod`: Runtime type validation.
- `shadcn/ui`: UI component library.

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: For session management (if authentication is implemented).

## Recent Changes

### January 16, 2026 (Team Strength & Enhanced Player Valuations)
**Database & Schema**:
- Added `draft_pick_values` table for dynasty pick value charts (2026/2027)
- Pick values tiered: 1st round (1.01-1.03, 1.04-1.06, 1.07-1.12), 2nd/3rd (early/late)
- Added unique index on (pick_year, pick_round, pick_tier) for data integrity

**Team Strength API** (`GET /api/league/:leagueId/team-strength`):
- Computes total asset value for each roster (players + draft picks)
- Starter selection: greedy best-fit algorithm respecting roster slot eligibility
- Bench weight: 0.30 multiplier for non-starters
- Pick valuation: uses pre-fetched draft pick values (optimized, no serial awaits)
- Format-aware: applies SF/TEP adjustments based on league settings
- Returns: starters_value, bench_value, picks_total, total_assets, asset_rank

**Market Values API Enhancements**:
- Now returns: position, fp_tier, trade_value_change, trade_value_effective
- Effective value computed server-side based on sf/tep flags

**UI Enhancements (TeamsSection)**:
- Format badges: displays 1QB/SF and TEP badges in header
- Verdict chips: Elite/Strong/Starter/Depth/Fringe based on FP tier
- Value deltas: shows arrows with +/- change values
- Labeled stats: "FP Rank:" and "Value:" with formatted values
- Team strength display: asset rank badge and total points on team cards

**New Hook**:
- `useTeamStrength(leagueId, season)`: fetches team strength rankings

### January 15, 2026 (FantasyPros Market Values Integration + Enhancements)
**Database & Schema**:
- Added `player_market_values` table for storing FP rankings and dynasty trade values
- Added `player_aliases` table for mapping alternate player names to Sleeper IDs
- Both tables support season-aware data via `as_of_year` field
- Updated `leagueDetailsResponseSchema` with `is_superflex` and `is_tep` fields

**Import System**:
- Created `server/marketValues/importMarketValues.ts` module for parsing FantasyPros CSV data
- **ENHANCED**: Uses csv-parse library for robust, production-grade CSV parsing with header mapping
- Importer matches players via normalized names and manual aliases
- Supports FP dynasty rankings (rank, tier, best/worst/avg) and trade values (standard/superflex/TEP)

**League Format Detection**:
- `/api/league/:leagueId` now returns `is_superflex` and `is_tep` flags
- Superflex: detected from `roster_positions` containing "SUPER_FLEX"
- TEP: detected from `scoring_settings.bonus_rec_te > 0` or `rec_te > rec`
- LeagueGroupDetails passes format flags to TeamsSection and TradesSection

**API Endpoints**:
- `GET /api/market-values?ids=id1,id2&asOf=2025&sf=false&tep=false`: Get market values for players
- `POST /api/debug/import-market-values`: Import market values from CSV (dev only)

**UI Integration**:
- TeamsSection displays FP Rank and Trade Value badges on player cards
- Sort toggle allows switching between Rank and Value sorting modes
- **NEW**: TradesSection displays trade values for traded players
- Format-aware: sf/tep flags applied for accurate valuations
- Season-aware: uses displayedSeason/seasonFilter for year-specific values

**Files**:
- `shared/schema.ts`: playerMarketValues, playerAliases tables and types
- `server/cache.ts`: getPlayerAliases, upsertMarketValue, getMarketValuesByIds helpers
- `server/marketValues/importMarketValues.ts`: CSV import logic (uses csv-parse)
- `client/src/hooks/use-sleeper.ts`: useMarketValues hook
- `client/src/components/TeamsSection.tsx`: Market value display and sorting
- `client/src/components/TradesSection.tsx`: Trade values on traded players

### January 15, 2026 (Season-Aware Navigation & Per-Team Toggles)
**Season-Aware Data**:
- Added `seasons_to_league` mapping to LeagueGroup schema (season→league_id array) for client-side season navigation
- Profile.tsx and LeagueCard.tsx now use selected season to fetch season-specific data
- LeagueGroupDetails.tsx computes `activeLeagueId` from seasons_to_league mapping based on selected season
- All data hooks (draft capital, churn, trade timing, all-play, H2H, trades) now season-aware
- H2H and trades hooks accept optional `season` parameter for filtering

**Per-Team Toggles**:
- TeamsSection.tsx now supports per-team Roster/Draft Capital toggle buttons
- Each expanded team card has individual toggle to switch between roster view and draft capital view
- Global toggle resets all per-team overrides when changed

**Fallback Improvements**:
- LeagueCard.tsx activeLeagueId falls back to last league_ids element if latest_league_id undefined

### January 12, 2026 (League Summary Tile Fixes)
**Bug Fixes**:
- Fixed points-for/against calculation with proper Number() parsing and operator precedence
- Fixed ranking computation to parse all roster stats as numbers before sorting
- Added schema validation via leagueSummarySchema.parse() to prevent malformed responses
- Updated useLeagueSummary hook to return LeagueSummary | null type with proper retry settings
- Added loading state and null handling in LeagueGroupCard for graceful degradation

### January 11, 2026 (Production Reliability + UX Improvements)
**Production Reliability**:
- Fixed 500 errors caused by DATABASE_URL pointing to internal "helium" hostname in deployment
- Added no-db fallback mode: fetches data directly from Sleeper API when database unavailable
- Added `/api/health` endpoint reporting storage mode, DB connectivity, and environment info
- Added retry logic with exponential backoff (3 retries, 500ms/1500ms/3000ms delays) for Sleeper API calls
- Added 15-second timeout for external API calls via AbortController
- Responses include `degraded: true` flag when operating in fallback mode

**Frontend Crash Fixes**:
- Fixed `.toFixed()` crashes with null-safe formatting helpers (fmtNum, fmtPct)
- Updated TeamsSection, TradeTargetsModal, and LeagueGroupDetails with defensive rendering

**Trade Targets UX**:
- Modal now shows ALL opponents by default (no need to click "Show all")
- Better error toasts when individual sync fails with actionable message
- Toggle button correctly shows "Show fewer" when expanded

**Documentation**:
- Added /docs/PROD_BUG_ROOT_CAUSE.md explaining the "helium" hostname issue
- Added /docs/PROD_FIX_CHECKLIST.md with verification steps
- Added /GOTCHAS.md with developer documentation

### January 6, 2026 (Phase 2.4 Major UX Overhaul)
**Placement Accuracy**:
- Derivation ladder: 1) roster.settings fields (final_rank, playoff_rank) 2) bracket endpoints 3) NULL (never guess)
- Real bracket data from Sleeper's `/league/:id/winners_bracket` endpoint
- Source tracking in season summaries ("bracket", "roster_settings", "unknown")
- Tile placement badges on league cards

**Trade Targets Auto-Sync**:
- POST /api/exposure/sync accepts `user_id` param for syncing users without cached usernames
- Auto-sync queue runs when modal opens with concurrency limit (2)
- Visual row states: Needs sync -> Syncing -> Ready/Failed with progress bar

**Page Reorganization**:
- Above the fold: Season Result card with Final Finish, Regular Rank, Record, Win%, PF
- Quick Actions row: Trade Targets, My Roster, Draft Capital, Trade History buttons
- Tabbed layout: Overview | Teams | Trades | H2H | History
- Scope labels on every metric (Latest Season, Season-to-Date, etc.)