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