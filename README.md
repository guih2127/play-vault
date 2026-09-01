# PlayVault

Personal app to sync and browse the games you've played on PS5, Steam and Switch 2 — with
trophies/achievements, platinums, ratings, a backlog and playtime.

- **Backend:** NestJS (ESM) + Node's native SQLite (`node:sqlite`) — port **3000**
- **Frontend:** React + Vite + TypeScript — port **5173** (proxy `/api` → `localhost:3000`)

## Prerequisites

- **Node.js 24+** (the backend uses `node:sqlite`, which is experimental and requires Node 24)
- A filled-in `backend/.env` (see below)
- A Google OAuth Client ID (for "Sign in with Google") — create one in the Google Cloud Console
  and add `http://localhost:5173` as an authorized JavaScript origin

## Configuration (`backend/.env`)

Copy `backend/.env.example` and fill it in. App-level values:

```env
PORT=3000

# App-level Steam Web API key (used to read any signed-in user's public library)
STEAM_API_KEY=
# RAWG key (game search / metadata)
RAWG_API_KEY=

# Auth
APP_URL=http://localhost:5173
GOOGLE_CLIENT_ID=
JWT_SECRET=        # 48+ random bytes, base64
ENCRYPTION_KEY=    # exactly 32 random bytes, base64
```

Generate the secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # ENCRYPTION_KEY
```

> PSN and Steam accounts are connected **per user inside the app** (Profile screen), not in `.env` —
> PSN via an NPSSO token (encrypted at rest), Steam via "Sign in with Steam" (OpenID).

## Running

The quickest way (Windows) — from the project root:

```powershell
.\playvault.cmd
```

This installs dependencies on first run, starts backend + frontend, and opens the browser once the
backend is ready. `Ctrl+C` stops both.

Or run each side manually in two terminals:

```powershell
cd backend  && npm install && npm run start:dev   # terminal 1
cd frontend && npm install && npm run dev          # terminal 2
```

Then open **http://localhost:5173**.

> First time: sign in (Google or email/password), open **Profile**, connect PSN/Steam, then hit
> **Sync** to pull your data and store a snapshot in SQLite (`backend/playvault.db`).

## Useful scripts

| Where    | Command             | What it does                          |
| -------- | ------------------- | ------------------------------------- |
| backend  | `npm run start:dev` | Backend in watch mode                 |
| backend  | `npm run build`     | Production build                      |
| backend  | `npm run start:prod`| Run the build (`dist/main`)           |
| backend  | `npm test`          | Tests (vitest)                        |
| backend  | `npm run format`    | Prettier                              |
| frontend | `npm run dev`       | Dev server (Vite)                     |
| frontend | `npm run build`     | Production build                      |
| frontend | `npm run format`    | Prettier                              |

## API (main endpoints)

Auth (public): `POST /api/auth/google`, `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/auth/me`.

Everything below requires an authenticated session (cookie):

- `GET /api/profile` — current user + connected providers
- `POST /api/profile/psn` — connect PSN (NPSSO) · `GET /api/profile/steam/login` — connect Steam (OpenID)
- `GET /api/dashboard` — dashboard summary · `GET /api/games` — library (from snapshot)
- `POST /api/sync` — sync the signed-in user's providers and rewrite the snapshot
- `GET /api/trophies` — individual trophies · `GET /api/backlog` — backlog
- `POST /api/games/beaten` — mark as beaten · `POST /api/games/rating` — rate (0.5–5 stars)
- `POST /api/manual` / `DELETE /api/manual/:id` — manual entries (Switch 2)
- `GET /api/search?q=` — game search (RAWG) · `GET /api/meta?key=&title=` — game metadata (RAWG)

## Notes

- **Switch 2:** the automatic API (nxapi) is blocked by Nintendo, so Switch games are added
  **manually**.
- The `backend/playvault.db` database stores users, per-user connections, snapshots, beaten flags,
  ratings and manual entries — it survives between syncs.
