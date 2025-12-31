# Sleeper Fantasy Dashboard

## Overview

This is a Sleeper Fantasy Sports dashboard application that allows users to view their fantasy leagues across multiple seasons. The app pulls league data from the Sleeper API, displays league cards with win-loss records, and provides detailed views for individual leagues including rosters and standings.

The application follows a monorepo structure with a React frontend and Express backend, using the Sleeper public API as the primary data source with local SQLite caching for performance.

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
1. User enters Sleeper username on frontend
2. Backend fetches user data and leagues from Sleeper API
3. For each league, backend fetches rosters to calculate user's W-L record
4. Data is cached in SQLite and returned to frontend
5. Frontend displays flattened league list sorted by name (A-Z) then season (DESC)

### Caching Strategy
- **SQLite Cache**: Local `sleeper.db` file stores users, leagues, rosters, and player data
- **Tables**: users, leagues, rosters, roster_players, user_leagues
- **Purpose**: Reduce Sleeper API calls and improve response times

### API Endpoints
- `GET /api/overview?username=<username>` - Returns user info and all leagues with W-L records
- `GET /api/league/:leagueId` - Returns detailed league info with rosters and users
- `POST /api/sync?username=<username>` - Forces refresh of cached data from Sleeper API

### Shared Code
- `shared/schema.ts` - Zod schemas for API responses and type definitions
- `shared/routes.ts` - API route definitions with request/response schemas

## External Dependencies

### Third-Party APIs
- **Sleeper API** (https://api.sleeper.app/v1): Fantasy sports data source
  - User lookup by username
  - League listings by user/sport/season
  - League rosters and user details
  - No authentication required (public API)

### Database
- **PostgreSQL**: Primary database via Drizzle ORM (configured but minimal usage currently)
- **SQLite** (better-sqlite3): Local caching layer for Sleeper API responses

### Key NPM Packages
- `drizzle-orm` + `drizzle-kit`: Database ORM and migrations
- `@tanstack/react-query`: Server state management
- `framer-motion`: Animations
- `zod`: Runtime type validation
- `shadcn/ui` components: Full suite of Radix-based UI primitives

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (required for Drizzle)