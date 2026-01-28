# Sleeper Fantasy Scout

## Overview
Sleeper Fantasy Scout, renamed to Dynasty Edge, is a full-stack web application for Sleeper Fantasy Sports users. It provides tools for analyzing fantasy leagues across multiple seasons, evaluating player exposure, comparing user performance, and tracking trade history. The application leverages the Sleeper API to offer insights into league dynamics, player management, and team strength, with features like condensed league groups, head-to-head records, and detailed trade analysis. Its ambition is to offer comprehensive scouting tools for fantasy sports enthusiasts, including advanced analytics like "Edge Engine" for dynasty league evaluation and power rankings.

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
- Data is synced from the Sleeper API and cached in PostgreSQL using Drizzle ORM.
- Cached data includes users, leagues, rosters, trades, player master data, and aggregated statistics.
- Sync operations are asynchronous, rate-limited, and player data refreshes daily.

### Key Features
- **League Grouping**: Condenses multi-season leagues and supports filtering by dynasty/redraft.
- **Trade History**: Provides detailed trade timelines for league groups, including trade values for traded players.
- **Player Exposure**: Analyzes player ownership across leagues, with an auto-sync queue for trade targets.
- **User Comparison**: Compares stats between users.
- **Head-to-Head Records**: Tracks H2H performance against opponents.
- **Scouting Leaderboards**: Offers various scouting metrics for rosters (e.g., Draft Capital, Strength, Consistency, Churn, Trading).
- **Season History**: Displays season-by-season placement and performance, with accurate placement derived from Sleeper bracket data.
- **Power Rankings**: Computes league-level team strength based on starters, bench, and draft pick values, included in overview.
- **Edge Engine**: An analytics module for dynasty league evaluation, featuring team archetypes (e.g., all-in-contender, rebuilder), composite scores, and a "Trade Radar" for player matching.
- **Market Values Integration**: Displays FantasyPros rankings and dynasty trade values for players, format-aware (SF/TEP) and season-aware.
- **UI/UX**: Tabbed layouts, sortable tables, per-team toggles, and robust error handling with fallback modes for API reliability.

### API Endpoints (Examples)
- `GET /api/overview?username=<username>`: User info and league groups.
- `POST /api/sync?username=<username>`: Initiates background data synchronization.
- `GET /api/group/:groupId/h2h?username=<username>`: Head-to-head records for a league group.
- `GET /api/players/exposure?username=<username>`: Player exposure analysis.
- `GET /api/league/:leagueId/scouting/draft-capital`: Draft capital leaderboard for a league.
- `GET /api/group/:groupId/seasons?username=<username>`: Season history for a league group.
- `GET /api/group-analytics?username=<username>&season=<season>`: Talent analytics for league groups.
- `GET /api/league/:leagueId/team-strength`: Computes total asset value for each roster.
- `GET /api/market-values?ids=id1,id2&asOf=2025&sf=false&tep=false`: Retrieves market values for players.
- `GET /api/health`: Reports storage mode, DB connectivity, and environment info.

### Shared Code
- `shared/schema.ts`: Zod schemas for API responses and types.
- `shared/routes.ts`: API route definitions.

## External Dependencies

### Third-Party APIs
- **Sleeper API** (https://api.sleeper.app/v1): Primary data source for fantasy sports data (users, leagues, rosters, transactions, NFL players).

### Database
- **PostgreSQL**: Used for data caching and persistence via Drizzle ORM.

### Key NPM Packages
- `drizzle-orm` + `drizzle-kit`: ORM for PostgreSQL.
- `pg`: PostgreSQL client.
- `@tanstack/react-query`: Server state management.
- `framer-motion`: Animations.
- `zod`: Runtime type validation.
- `shadcn/ui`: UI component library.
- `csv-parse`: Robust CSV parsing for market value imports.

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string.
- `SESSION_SECRET`: For session management.

## Recent Changes

### January 28, 2026 (UI Unification & Navigation Restructure)

**Navigation Restructure** (`client/src/components/Layout.tsx`):
- Updated navigation tabs: Dashboard, Trophy Room, Edge Engine, Player Market, Compare
- Icons: LayoutDashboard (Dashboard), Trophy (Trophy Room), Zap (Edge Engine), TrendingUp (Player Market), Users (Compare)
- Clean separation: Past (Trophy Room) vs Future (Edge Engine)

**Dashboard Simplification** (`client/src/pages/Profile.tsx`):
- Simplified to navigation hub with user profile header and stats
- Navigation cards for Trophy Room (yellow) and Edge Engine (blue)
- League group cards with filtering by season and type
- Removed heavy analytics tables/charts (moved to dedicated pages)

**Edge Engine Enhancement** (`client/src/pages/EdgeEngine.tsx`):
- Uses canonical `/api/league/:leagueId/power-rankings` endpoint
- Displays True Power Score with formula tooltip (45% Starters + 15% Bench + 25% Picks + 10% Window + 5% Age)
- ArchetypeBadge for each team (Dynasty Juggernaut, All-In Contender, Fragile Contender, etc.)
- Core Assets tab with AgeScaleBar components showing position-specific age curves
- Trade Radar tab for trade opportunities

**Trophy Room** (`client/src/pages/TrophyRoom.tsx`):
- Already complete with Season History, H2H Records, and Achievements tabs
- Historical achievements focus (past performance)

### January 27, 2026 (Decision Engine v1 - Age Curves & Archetypes)

**Age Curve Engine** (`server/engine/ageCurves.ts`):
- Position-specific age curves with precise mappings:
  - RB: Ascent 0-21, late Ascent 22-23, Prime 24-26, Decline 27-28, Cliff 29+
  - WR: Ascent 0-23, late Ascent 24-25, Prime 26-29, Decline 30-31, Cliff 32+
  - TE: Ascent 0-23, late Ascent 24-25, Prime 26-30, Decline 31-32, Cliff 33+
  - QB: Ascent 0-23, late Ascent 24-25, Prime 26-33, Decline 34-36, Cliff 37+
- Traffic light color system: blue (Ascent), green (late Ascent), gold (Prime), orange (Decline), red (Cliff), gray (Unknown)
- `getAgeCurveStatus(age, position)` returns full AgeCurveStatus with dot_pct for UI rendering

**Archetype Classifier** (`server/engine/archetypes.ts`):
- Value-weighted window calculation (player value as weight, not simple average)
- Core assets selection: min(12, startersCount + 3) top players by value
- Percentile safety net: returns 50 for empty or single-item arrays
- Archetype classification with priority order:
  1. Dynasty Juggernaut: power ≥ 85 AND window ≥ 70
  2. All-In Contender: power ≥ 75 AND window < 50 AND draft < 40
  3. Fragile Contender: power ≥ 70 AND window < 50
  4. Productive Struggle: power 40-69 AND draft ≥ 50 AND window ≥ 50
  5. Dead Zone: power 40-69 AND draft < 40 AND window < 50
  6. Rebuilder: power < 40 AND draft ≥ 60
  7. Competitor: default

**Power Rankings Enhancement** (`server/engine/powerRankings.ts`):
- New response fields: power_pct, draft_pct, window_core_raw/pct, window_total_raw/pct
- Core assets with full age_curve objects for each player
- Archetype classification with human-readable reasons
- Dual window calculations: core (top N players) and total (full roster)

**UI Components** (`client/src/components/AgeScaleBar.tsx`):
- AgeScaleBar: Visual scale showing player age on position curve with color-coded dot
- ArchetypeBadge: Color-coded team classification with tooltip reasons
- PercentileBar: Visual bar for displaying percentile values

### January 26, 2026 (Canonical Player Value Pipeline)

**Player Values Table** (`shared/schema.ts`):
- New `player_values` table with `value_1qb` and `value_sf` columns
- Stores canonical FantasyPros dynasty values for dual-mode (1QB/Superflex) lookup
- Indexed on position for efficient queries

**CSV Importer** (`server/marketValues/importPlayerValues.ts`):
- Dual-mode support: reads from `server/data/fantasypros_dynasty_1qb.csv` and `server/data/fantasypros_dynasty_sf.csv`
- Name normalization: removes Jr/Sr/II/III/IV/V suffixes for matching
- COALESCE upsert: updates without wiping values from other mode
- Generates `server/data/unmatched_report.csv` for debugging unmatched players
- Endpoint: `POST /api/debug/import-player-values`

**Player Values Repository** (`server/marketValues/playerValuesRepo.ts`):
- `inferLeagueMode(settings)`: Detects SF via SUPER_FLEX position or QB count >= 2
- `getPlayerValuesMap(ids, mode)`: Batch lookup with mode-specific values
- `getPlayerValuesStatus()`: Global counts (rows, has_1qb, has_sf, last_updated)
- `getRosterCoverage(leagueId, rosterIds, ownerId)`: Per-roster coverage analysis

**API Endpoints**:
- `GET /api/player-values/status`: Global player value status
- `GET /api/league/:leagueId/player-values/coverage`: Per-roster coverage with missing list

**UI Components**:
- `usePlayerValuesStatus` and `usePlayerValuesCoverage` hooks in `client/src/hooks/use-sleeper.ts`
- `CoverageWarning` component with View List modal and clipboard copy
- Integrated into LeagueGroupDetails page with mode badge (1QB/SF)

**Cleanup**:
- Old CSVs archived to `server/data/_archive/`
- Legacy import files moved but preserved for reference

### January 25, 2026 (Absolute Valuation Engine & Historical Crawler)

**Absolute Valuation Engine** (`server/engine/powerRankings.ts`):
- **New Weight Distribution**: 45% Starters, 15% Bench, 25% Picks, 10% Window, 5% Age
- **Pick Value Scaling**: Picks scaled by factor of 20x to normalize with starters range
- **Team Age Score**: Computed from value-weighted average age (younger = higher score)
- **Single Source of Truth**: All views use the same canonical power rankings

**League Chain Historical Crawler** (`server/routes.ts`):
- **POST /api/sync/history**: New endpoint for full historical sync
- **Chain Crawling**: Follows `previous_league_id` up to 5 seasons back
- **Trophy Extraction**: Parses winners_bracket to find 1st, 2nd, 3rd place finishes
- **Season Summaries**: Stores regular season standings and playoff results

**Trophy Room Enhancement** (`client/src/pages/TrophyRoom.tsx`):
- **Sync Full History Button**: Triggers historical data crawl
- **Refreshes Automatically**: Invalidates season data after sync completes

### January 25, 2026 (Professional Draft Pick Valuation Pipeline)
**Data Import** (`server/marketValues/importDraftPickValues.ts`):
- Imports draft pick values from CSV into `draft_pick_values` table
- Parses Pick_Description into round and tier columns
- Stores 1QB and Superflex values separately
- Endpoint: `POST /api/debug/import-pick-values`

**Draft Capital Valuation** (`server/analytics/draftCapital.ts`):
- New `computePicksValueForLeague` function uses database-driven pick values
- **Luck-Adjusted Tier Estimation**: Uses Max PF Rank to estimate pick position
  - Top third (Rank 1-4 in 12-team): Late picks (1.07-1.12)
  - Middle third (Rank 5-8): Mid picks (1.04-1.06)
  - Bottom third (Rank 9-12): Early picks (1.01-1.03)
- Format-sensitive: Uses `value_sf` for Superflex leagues, `value_1qb` otherwise
- Graceful fallback to hardcoded values when database unavailable

**Edge Engine Integration** (`server/routes.ts`):
- Pre-computes lineups to get Max PF for all rosters
- Ranks rosters by Max PF before computing pick values
- Uses `computePicksValueForLeague` with Max PF ranks for accurate valuation

### Edge Engine Features
- **Weight Formula**: 45% Starters, 15% Bench, 15% Max PF, 20% Draft Capital, 5% Age Window
- **Team Archetypes**: all-in-contender, fragile-contender, productive-struggle, dead-zone, rebuilder
- **Max PF (Luck Score)**: Compares actual_pf vs max_pf (from lineup optimizer)
- **Sortable Power Rankings**: Sort by Rank, Starters, Bench, Max PF, Picks, Age, Efficiency
- **Trade Radar**: Matches surplus players to opponents' deficit positions