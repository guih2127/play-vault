# PlayVault

App pessoal para sincronizar e exibir os jogos que joguei no PS5, Steam e Switch 2 — com tempo de jogo, troféus/conquistas, platinas e notas.

- **Backend:** NestJS (ESM) + SQLite nativo do Node (`node:sqlite`) — porta **3000**
- **Frontend:** React + Vite + TypeScript — porta **5173** (proxy `/api` → `localhost:3000`)

## Pré-requisitos

- **Node.js 24+** (o backend usa o `node:sqlite`, que é experimental e exige Node 24)
- Um arquivo `backend/.env` preenchido (ver abaixo)

## Configuração (`backend/.env`)

```env
PORT=3000
PSN_NPSSO=            # token NPSSO da PSN (expira ~2 meses)
STEAM_API_KEY=        # Steam Web API key
STEAM_ID=             # SteamID64
NINTENDO_SESSION_TOKEN=  # opcional (Switch via nxapi, bloqueado)
RAWG_API_KEY=         # RAWG (busca/autocomplete e metadados)
```

## Rodando

Abra **dois terminais** na raiz do projeto.

**Terminal 1 — backend:**

```powershell
cd backend
npm install      # só na primeira vez
npm run start:dev
```

**Terminal 2 — frontend:**

```powershell
cd frontend
npm install      # só na primeira vez
npm run dev
```

Depois abra **http://localhost:5173** no navegador.

> Na primeira vez que abrir, clique em **Sincronizar** para puxar os dados da PSN/Steam e salvar o snapshot no SQLite (`backend/playvault.db`). Sincronizações levam ~9s; depois disso a biblioteca carrega instantânea do snapshot.

## Scripts úteis

| Onde | Comando | O que faz |
|------|---------|-----------|
| backend | `npm run start:dev` | Backend em watch mode |
| backend | `npm run build` | Build de produção |
| backend | `npm run start:prod` | Roda o build (`dist/main`) |
| backend | `npm test` | Testes (vitest) |
| frontend | `npm run dev` | Dev server (Vite) |
| frontend | `npm run build` | Build de produção |
| frontend | `npm run preview` | Preview do build |

## API (principais endpoints)

- `GET /api/providers` — status dos providers conectados
- `GET /api/games` — biblioteca (do snapshot)
- `POST /api/sync` — sincroniza providers e regrava o snapshot
- `GET /api/search?q=` — busca de jogos (RAWG) p/ cadastro manual
- `GET /api/meta?key=&title=` — metadados do jogo (RAWG)
- `POST /api/manual` / `DELETE /api/manual/:id` — cadastro manual (Switch 2)
- `POST /api/games/beaten` — marca jogo como zerado
- `POST /api/games/rating` — nota (0.5–5 estrelas)

## Notas

- **Switch 2:** a API automática (nxapi) está bloqueada pela Nintendo — jogos do Switch entram por **cadastro manual**.
- O banco `backend/playvault.db` guarda snapshots, flags de zerado, notas e cadastros manuais — sobrevive entre syncs.
