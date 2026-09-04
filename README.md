# PlayVault

Personal app to sync and browse the games you've played on PS5, Steam and Switch 2 — with
trophies/achievements, platinums, ratings, a backlog and playtime.

- **Backend:** NestJS (ESM) + Postgres (`pg`) — port **3000**
- **Frontend:** React + Vite + TypeScript — port **5173** (proxy `/api` → `localhost:3000`)

## Prerequisites

- **Node.js 20+**
- **A Postgres database.** For local development a free [Neon](https://neon.tech) dev branch or a
  local Postgres both work — put its connection string in `DATABASE_URL` (see below).
- A filled-in `backend/.env` (see below)
- A Google OAuth Client ID (for "Sign in with Google") — create one in the Google Cloud Console
  and add `http://localhost:5173` as an authorized JavaScript origin

## Configuration (`backend/.env`)

Copy `backend/.env.example` and fill it in. App-level values:

```env
PORT=3000

# Postgres connection string (required, locally too)
DATABASE_URL=postgres://user:pass@host/dbname?sslmode=require

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

`JWT_SECRET` and `ENCRYPTION_KEY` are **generated automatically on first run (development only)**
and saved to `backend/.env` — you only fill in the external keys (`STEAM_API_KEY`, `RAWG_API_KEY`,
`GOOGLE_CLIENT_ID`). If `backend/.env` doesn't exist yet, it's created from `.env.example`.
See [Deploying to production](#deploying-to-production) for how secrets and the database work there.

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
> **Sync** to pull your data and store a snapshot in Postgres.

## Deploying to production

Set `NODE_ENV=production`. Two things behave differently — both to prevent silent data loss:

- **Secrets are never auto-generated.** `JWT_SECRET` and `ENCRYPTION_KEY` must be provided as real
  environment variables (host/platform secrets). If either is missing the app refuses to start with
  a clear error. This is deliberate: auto-generating them would write to an ephemeral container
  filesystem, so they'd rotate on the next deploy — logging out every user **and making already-
  encrypted PSN tokens permanently undecryptable**. Generate stable values once and keep them:

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"  # JWT_SECRET
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # ENCRYPTION_KEY
  ```

- **The database is managed Postgres.** Point `DATABASE_URL` at a hosted Postgres (e.g. a free
  [Neon](https://neon.tech) project). Because the database lives outside the app, the app itself is
  stateless and fits free web-service tiers (e.g. Render's free plan). Backups are handled by the
  Postgres provider.

The backend serves the built frontend (`app.useStaticAssets`), so the whole thing is **one
service, one origin** — no CORS or reverse proxy needed for the session cookie.

### Free deploy (Render + Neon)

The repo includes a `render.yaml` blueprint. Steps:

1. **Database:** create a free [Neon](https://neon.tech) project and copy its connection string.
2. **Secrets:** generate a `JWT_SECRET` and `ENCRYPTION_KEY` (commands above) and keep them.
3. **Google OAuth:** in the Google Cloud Console, add your production URL
   (`https://<your-app>.onrender.com`) as an authorized JavaScript origin.
4. **Deploy:** on Render, create a **Blueprint** from this repo (it reads `render.yaml`), then fill
   in the environment variables it prompts for: `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`,
   `APP_URL` (the app's own URL), `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` (same value), and the
   optional `STEAM_API_KEY` / `RAWG_API_KEY`.
5. **Migrate your data** (optional, if coming from SQLite) — see below.

> `VITE_GOOGLE_CLIENT_ID` is read at **build time** (baked into the frontend bundle), so it must be
> set as an environment variable before the build runs — the blueprint handles this.

### Migrating existing SQLite data

If you have an older `backend/playvault.db` (this app used SQLite before), copy it into Postgres
once with the included script:

```bash
cd backend
npm run build
DATABASE_URL="postgres://...he neon url..." node scripts/migrate-sqlite-to-postgres.mjs
```

It creates the schema if missing and skips rows that already exist, so it's safe to re-run.

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

## API docs

Interactive API docs (Swagger UI) are served at **http://localhost:3000/docs** while the backend is
running — every endpoint grouped by controller, with request/response details and "Try it out".

## Notes

- **Switch 2:** the automatic API (nxapi) is blocked by Nintendo, so Switch games are added
  **manually**.
- The Postgres database stores users, per-user connections, snapshots, beaten flags, ratings and
  manual entries — it survives between syncs.
