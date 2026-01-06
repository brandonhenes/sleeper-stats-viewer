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