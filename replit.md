# Sleeper Fantasy Scout

## Overview

This is a full-stack Sleeper Fantasy Sports scouting tool that allows users to view their fantasy leagues across multiple seasons, analyze player exposure, compare against other users, and track trade history. The app pulls league data from the Sleeper API, displays league groups (condensed by season via previous_league_id chaining), and provides detailed views including head-to-head records, trades, and player exposure analysis.

The application follows a monorepo structure with a React frontend and Express backend, using the Sleeper public API as the primary data source with PostgreSQL caching for persistence.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state caching and synchronization
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style)
- **Animations**: Framer Motion for page transitions and list animations
- **Build Tool**: Vite with path aliases (`@/` for client/src, `@shared/` for shared code)

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Pattern**: REST endpoints under `/api/` prefix
- **External API Integration**: Sleeper API (https://api.sleeper.app/v1) with concurrency limiting (max 6 concurrent requests)
- **Development**: tsx for TypeScript execution, Vite middleware for HMR

### Data Flow
1. User enters Sleeper username on home page
2. User is redirected to /u/:username profile page
3. Background sync job fetches all leagues, rosters, trades, and player data
4. Frontend polls sync status and displays progress
5. Data is cached in PostgreSQL and displayed as league groups
6. User can view league details, player exposure, or compare with other users

### Key Features
- **League Groups**: Multi-season leagues condensed via previous_league_id chaining
- **Dynasty/Redraft Filtering**: Filter leagues by type on profile page
- **Trade History**: View all trades for a league group with timeline
- **Player Exposure**: Analyze which players you own across leagues
- **User Comparison**: Compare stats between two users
- **Head-to-Head Records**: View H2H records against opponents in each league group

### Caching Strategy
- **PostgreSQL Cache**: All Sleeper API data cached in PostgreSQL via Drizzle ORM
- **Tables** (defined in shared/schema.ts): 
  - users, leagues, rosters, roster_players, user_leagues, league_users
  - trades (transaction history)
  - players_master (NFL player database)
  - h2h_season (head-to-head records)
  - sync_jobs (background job tracking)
  - group_overrides (manual league grouping)
- **Async Operations**: All cache methods use async/await with connection pooling
- **Sync interval**: 10-minute minimum between syncs per username
- **Player database**: Refreshed once per day from /players/nfl

### API Endpoints
- `GET /api/overview?username=<username>` - Returns user info and all league groups with aggregated W-L records
- `GET /api/league/:leagueId` - Returns detailed league info with rosters and users
- `POST /api/sync?username=<username>` - Starts non-blocking background sync job
- `GET /api/sync/status?job_id=<id>` - Returns sync job progress
- `GET /api/group/:groupId/h2h?username=<username>` - Returns head-to-head records for a league group
- `GET /api/group/:groupId/trades` - Returns all trades for a league group
- `GET /api/players/exposure?username=<username>` - Returns player exposure analysis
- `GET /api/league/:leagueId/draft-capital?username=<username>` - Returns draft picks owned from trades
- `GET /api/league/:leagueId/churn?username=<username>` - Returns roster churn rate and league ranking
- `GET /api/league/:leagueId/trade-timing?username=<username>` - Returns trade timing analysis by season phase
- `GET /api/league/:leagueId/all-play?username=<username>` - Returns all-play record and luck index

### Frontend Routes
- `/` - Home page with username search
- `/u/:username` - User profile with league groups
- `/u/:username/league/:groupId` - League group details with H2H and trades
- `/players/:username` - Player exposure table
- `/compare` - User comparison input form
- `/compare/:userA/:userB` - Comparison results

### Shared Code
- `shared/schema.ts` - Zod schemas for API responses and type definitions
- `shared/routes.ts` - API route definitions with request/response schemas

## External Dependencies

### Third-Party APIs
- **Sleeper API** (https://api.sleeper.app/v1): Fantasy sports data source
  - User lookup by username
  - League listings by user/sport/season
  - League rosters and user details
  - League transactions (trades)
  - NFL players database
  - No authentication required (public API)

### Database
- **PostgreSQL**: Primary database via Drizzle ORM with connection pooling (pg package)
- All cache tables defined in shared/schema.ts with proper indexes and composite primary keys

### Key NPM Packages
- `drizzle-orm` + `drizzle-kit`: Database ORM and migrations
- `pg`: PostgreSQL client with connection pooling
- `@tanstack/react-query`: Server state management
- `framer-motion`: Animations
- `zod`: Runtime type validation
- `shadcn/ui` components: Full suite of Radix-based UI primitives

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required for Drizzle)
- `SESSION_SECRET`: Session secret for authentication (if needed)

## Recent Changes

### January 2, 2026
- **Draft Capital Tracking**: Shows traded picks owned by year/round, derived from Sleeper's traded_picks API data only
- **Roster Churn Rate**: Calculates waiver add/drop activity with league ranking (excludes current user from avg calculation)
- **Trade Timing Analysis**: Classifies trades by season phase (draft window, in-season, playoffs, offseason) with trading style
- **All-Play/Luck Index**: Computes theoretical record vs all opponents each week, compares to actual record for luck factor
- Added useDraftCapital, useChurnRate, useTradeTiming, useAllPlay hooks
- League detail page now shows Draft Capital, Churn Rate, Trade Timing, and Luck Index cards

### December 31, 2025
- **Migrated from SQLite to PostgreSQL**: Complete rewrite of cache layer to use PostgreSQL with Drizzle ORM for Autoscale deployment compatibility
- All cache methods now async with proper await usage throughout codebase
- Added trades table and sync for trade history
- Added players_master table and sync from /players/nfl
- Added player exposure endpoint and Players page
- Added Compare feature with user comparison view
- Implemented league_type detection (dynasty/redraft) from settings.type
- Created Layout component with top nav tabs
- Updated routing to /u/:username pattern
- Added trade timeline to league group details page
