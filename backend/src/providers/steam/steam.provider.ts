import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { GameProvider, ProviderCredentials } from '../game-provider.interface.js';
import type {
  NormalizedGame,
  NormalizedTrophies,
  ProviderResult,
  RecentTrophy,
  TrophyUpdate,
} from '../../domain/game.model.js';

interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played?: number;
}

const CONCURRENCY = 8;
const API = 'https://api.steampowered.com';

@Injectable()
export class SteamProvider implements GameProvider {
  readonly platform = 'steam' as const;
  private readonly logger = new Logger(SteamProvider.name);

  private _apiKey?: string;
  private _steamId?: string;

  private get apiKey(): string | undefined {
    return this._apiKey;
  }

  private get steamId(): string | undefined {
    return this._steamId;
  }

  isConfigured(creds: ProviderCredentials): boolean {
    return !!creds.steamApiKey && !!creds.steamId;
  }

  async fetch(
    creds: ProviderCredentials,
    knownTrophyState?: Map<string, string>,
  ): Promise<ProviderResult> {
    this._apiKey = creds.steamApiKey?.trim() || undefined;
    this._steamId = creds.steamId?.trim() || undefined;
    if (!this.isConfigured(creds)) {
      return {
        status: {
          provider: this.platform,
          connected: false,
          error: 'API key / SteamID not configured',
        },
        games: [],
      };
    }

    try {
      const [owned, accountName] = await Promise.all([
        this.fetchOwnedGames(),
        this.fetchPersonaName(),
      ]);
      const games = owned.map((g) => this.toNormalizedGame(g));

      const withPlaytime = games.filter((g) => g.playtimeMinutes >= 60);
      await this.enrichAchievements(withPlaytime);

      const trophyUpdates = await this.buildTrophyUpdates(owned, knownTrophyState ?? new Map());

      return {
        status: {
          provider: this.platform,
          connected: true,
          accountName: accountName ?? this.steamId,
          gameCount: games.length,
        },
        games,
        trophyUpdates,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch Steam data: ${message}`);
      return {
        status: { provider: this.platform, connected: false, error: message },
        games: [],
      };
    }
  }

  private async fetchPersonaName(): Promise<string | undefined> {
    try {
      const { data } = await axios.get(`${API}/ISteamUser/GetPlayerSummaries/v2/`, {
        params: { key: this.apiKey, steamids: this.steamId },
        timeout: 15000,
      });
      return data?.response?.players?.[0]?.personaname;
    } catch {
      return undefined;
    }
  }

  private async fetchOwnedGames(): Promise<OwnedGame[]> {
    const { data } = await axios.get(`${API}/IPlayerService/GetOwnedGames/v1/`, {
      params: {
        key: this.apiKey,
        steamid: this.steamId,
        include_appinfo: 1,
        include_played_free_games: 1,
        format: 'json',
      },
      timeout: 20000,
    });
    return data?.response?.games ?? [];
  }

  private toNormalizedGame(g: OwnedGame): NormalizedGame {
    const lastPlayed =
      g.rtime_last_played && g.rtime_last_played > 0
        ? new Date(g.rtime_last_played * 1000).toISOString()
        : undefined;
    return {
      provider: 'steam',
      externalId: String(g.appid),
      title: g.name,
      platformLabel: 'Steam',
      coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
      iconUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
      playtimeMinutes: g.playtime_forever ?? 0,
      playtimeKnown: true,
      lastPlayed,
    };
  }

  private async enrichAchievements(games: NormalizedGame[]): Promise<void> {
    for (let i = 0; i < games.length; i += CONCURRENCY) {
      const batch = games.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((game) => this.attachAchievements(game)));
    }
  }

  /** Fetch individual achievements only for games that changed since the last sync (incremental). */
  private async buildTrophyUpdates(
    owned: OwnedGame[],
    known: Map<string, string>,
  ): Promise<TrophyUpdate[]> {
    const candidates = owned.filter((g) => (g.playtime_forever ?? 0) >= 60);
    const changed = candidates.filter(
      (g) => known.get(`steam:${g.appid}`) !== String(g.rtime_last_played ?? 0),
    );
    this.logger.log(`Steam trophy sync: ${changed.length}/${candidates.length} games changed`);

    const updates: TrophyUpdate[] = [];
    for (let i = 0; i < changed.length; i += CONCURRENCY) {
      const batch = changed.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map(async (g) => ({
          npCommId: `steam:${g.appid}`,
          lastUpdated: String(g.rtime_last_played ?? 0),
          trophies: await this.fetchAchievementDetails(g),
        })),
      );
      updates.push(...res);
    }
    return updates;
  }

  private async fetchAchievementDetails(g: OwnedGame): Promise<RecentTrophy[]> {
    try {
      const [schemaRes, playerRes, globalRes] = await Promise.all([
        axios
          .get(`${API}/ISteamUserStats/GetSchemaForGame/v2/`, {
            params: { key: this.apiKey, appid: g.appid },
            timeout: 15000,
          })
          .catch(() => null),
        axios
          .get(`${API}/ISteamUserStats/GetPlayerAchievements/v1/`, {
            params: { key: this.apiKey, steamid: this.steamId, appid: g.appid },
            timeout: 15000,
          })
          .catch(() => null),
        axios
          .get(`${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/`, {
            params: { gameid: g.appid },
            timeout: 15000,
          })
          .catch(() => null),
      ]);

      const schemaAch: any[] = schemaRes?.data?.game?.availableGameStats?.achievements ?? [];
      if (schemaAch.length === 0) return [];
      const defByName = new Map<string, any>(schemaAch.map((a) => [a.name, a]));
      const pctByName = new Map<string, number>(
        (globalRes?.data?.achievementpercentages?.achievements ?? []).map((a: any) => [
          a.name,
          Number(a.percent),
        ]),
      );
      const playerAch: any[] = playerRes?.data?.playerstats?.achievements ?? [];
      const cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`;

      const out: RecentTrophy[] = [];
      for (const pa of playerAch) {
        if (!pa.achieved) continue;
        const def = defByName.get(pa.apiname);
        const pct = pctByName.get(pa.apiname);
        out.push({
          provider: 'steam',
          gameTitle: g.name,
          gameIconUrl: cover,
          name: def?.displayName ?? pa.apiname,
          detail: def?.description,
          iconUrl: def?.icon,
          earnedAt:
            pa.unlocktime && pa.unlocktime > 0
              ? new Date(pa.unlocktime * 1000).toISOString()
              : undefined,
          rarity: pct != null ? Math.round(pct * 10) / 10 : undefined,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  private async attachAchievements(game: NormalizedGame): Promise<void> {
    try {
      const { data } = await axios.get(`${API}/ISteamUserStats/GetPlayerAchievements/v1/`, {
        params: { key: this.apiKey, steamid: this.steamId, appid: game.externalId },
        timeout: 15000,
      });
      const stats = data?.playerstats;
      if (!stats?.success || !Array.isArray(stats.achievements)) return;

      const achievements: Array<{ achieved: number; unlocktime?: number }> = stats.achievements;
      const total = achievements.length;
      if (total === 0) return;
      const earned = achievements.filter((a) => a.achieved === 1).length;
      const maxUnlock = achievements.reduce(
        (m, a) => (a.achieved === 1 && a.unlocktime ? Math.max(m, a.unlocktime) : m),
        0,
      );

      const set: NormalizedTrophies = {
        id: `steam:${game.externalId}`,
        titleName: game.title,
        platformLabel: 'Steam',
        earned,
        total,
        progress: Math.round((earned / total) * 100),
        platinumTotal: 0,
        platinumEarned: 0,
        lastEarnedAt: maxUnlock > 0 ? new Date(maxUnlock * 1000).toISOString() : undefined,
      };
      game.trophySets = [set];
    } catch {
      return;
    }
  }
}
