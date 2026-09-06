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
import { XboxAuthService, type XboxSession } from '../../auth/xbox-auth.service.js';

const TITLEHUB = 'https://titlehub.xboxlive.com';
const ACHIEVEMENTS = 'https://achievements.xboxlive.com';
const CONCURRENCY = 4;

interface XboxTitle {
  titleId: string;
  name: string;
  displayImage?: string;
  achievement?: {
    currentAchievements: number;
    totalAchievements: number;
    currentGamerscore: number;
    totalGamerscore: number;
    progressPercentage: number;
  };
  titleHistory?: { lastTimePlayed?: string };
  images?: Array<{ url: string; type: string }>;
}

@Injectable()
export class XboxProvider implements GameProvider {
  readonly platform = 'xbox' as const;
  private readonly logger = new Logger(XboxProvider.name);

  constructor(private readonly xboxAuth: XboxAuthService) {}

  isConfigured(creds: ProviderCredentials): boolean {
    return this.xboxAuth.isConfigured() && !!creds.xboxRefreshToken;
  }

  async fetch(
    creds: ProviderCredentials,
    knownTrophyState?: Map<string, string>,
  ): Promise<ProviderResult> {
    if (!this.isConfigured(creds)) {
      return {
        status: { provider: this.platform, connected: false, error: 'Xbox account not connected' },
        games: [],
      };
    }

    let session: XboxSession;
    try {
      session = await this.xboxAuth.getSessionFromRefreshToken(creds.xboxRefreshToken!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Xbox auth failed: ${message}`);
      return {
        status: { provider: this.platform, connected: false, error: 'Xbox sign-in expired' },
        games: [],
      };
    }

    try {
      const titles = await this.fetchTitles(session);
      const games = titles.map((t) => this.toNormalizedGame(t));
      const trophyUpdates = await this.buildTrophyUpdates(
        session,
        titles,
        knownTrophyState ?? new Map(),
      );

      return {
        status: {
          provider: this.platform,
          connected: true,
          accountName: session.gamertag,
          gameCount: games.length,
        },
        games,
        trophyUpdates,
        credentialUpdate: { xboxRefreshToken: session.refreshToken },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch Xbox data: ${message}`);
      return {
        status: { provider: this.platform, connected: false, error: message },
        games: [],
        // Still persist a rotated token so the connection survives a transient data error.
        credentialUpdate: { xboxRefreshToken: session.refreshToken },
      };
    }
  }

  private headers(session: XboxSession, contractVersion: string): Record<string, string> {
    return {
      Authorization: session.authHeader,
      'x-xbl-contract-version': contractVersion,
      'Accept-Language': 'en-US',
      Accept: 'application/json',
    };
  }

  /** All titles the user has played, decorated with their achievement summary. */
  private async fetchTitles(session: XboxSession): Promise<XboxTitle[]> {
    const { data } = await axios.get(
      `${TITLEHUB}/users/xuid(${session.xuid})/titles/titleHistory/decoration/achievement,image`,
      { headers: this.headers(session, '2'), timeout: 25000 },
    );
    const titles: XboxTitle[] = data?.titles ?? [];
    // Keep only titles that expose an achievement set (skip apps/media with none).
    return titles.filter((t) => (t.achievement?.totalAchievements ?? 0) > 0);
  }

  private coverFor(t: XboxTitle): string | undefined {
    const boxart = t.images?.find((i) => i.type === 'BoxArt' || i.type === 'Poster');
    return boxart?.url ?? t.displayImage;
  }

  private toNormalizedGame(t: XboxTitle): NormalizedGame {
    const ach = t.achievement;
    const cover = this.coverFor(t);
    const set: NormalizedTrophies | undefined = ach
      ? {
          id: `xbox:${t.titleId}`,
          titleName: t.name,
          platformLabel: 'Xbox',
          earned: ach.currentAchievements,
          total: ach.totalAchievements,
          progress:
            ach.progressPercentage ??
            (ach.totalAchievements
              ? Math.round((ach.currentAchievements / ach.totalAchievements) * 100)
              : 0),
          platinumTotal: 0,
          platinumEarned: 0,
          lastEarnedAt: t.titleHistory?.lastTimePlayed,
        }
      : undefined;
    return {
      provider: 'xbox',
      externalId: t.titleId,
      title: t.name,
      platformLabel: 'Xbox',
      coverUrl: cover,
      iconUrl: cover,
      // Xbox Live does not expose per-title playtime through these endpoints.
      playtimeMinutes: 0,
      playtimeKnown: false,
      lastPlayed: t.titleHistory?.lastTimePlayed,
      trophySets: set ? [set] : undefined,
    };
  }

  /** Fetch individual achievements only for titles that changed since the last sync (incremental). */
  private async buildTrophyUpdates(
    session: XboxSession,
    titles: XboxTitle[],
    known: Map<string, string>,
  ): Promise<TrophyUpdate[]> {
    const changed = titles.filter(
      (t) => known.get(`xbox:${t.titleId}`) !== (t.titleHistory?.lastTimePlayed ?? ''),
    );
    this.logger.log(`Xbox trophy sync: ${changed.length}/${titles.length} titles changed`);

    const updates: TrophyUpdate[] = [];
    for (let i = 0; i < changed.length; i += CONCURRENCY) {
      const batch = changed.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map(async (t) => ({
          npCommId: `xbox:${t.titleId}`,
          lastUpdated: t.titleHistory?.lastTimePlayed ?? '',
          trophies: await this.fetchAchievementDetails(session, t),
        })),
      );
      updates.push(...res);
    }
    return updates;
  }

  private async fetchAchievementDetails(
    session: XboxSession,
    t: XboxTitle,
  ): Promise<RecentTrophy[]> {
    // Xbox One / Series titles expose earned achievements through the modern (contract v2)
    // endpoint. Xbox 360 titles return nothing there — their unlocks live in the legacy
    // (contract v1) `titleachievements` endpoint — so fall back to it when v2 comes back empty
    // but titlehub says the user has earned achievements for this title.
    const modern = await this.fetchModernAchievements(session, t);
    if (modern.length > 0) return modern;
    if ((t.achievement?.currentAchievements ?? 0) > 0) {
      return this.fetchLegacyAchievements(session, t);
    }
    return modern;
  }

  private async fetchModernAchievements(
    session: XboxSession,
    t: XboxTitle,
  ): Promise<RecentTrophy[]> {
    try {
      const { data } = await axios.get(
        `${ACHIEVEMENTS}/users/xuid(${session.xuid})/achievements`,
        {
          headers: this.headers(session, '2'),
          params: { titleId: t.titleId, maxItems: 1000 },
          timeout: 20000,
        },
      );
      const cover = this.coverFor(t);
      const achievements: any[] = data?.achievements ?? [];
      const out: RecentTrophy[] = [];
      for (const a of achievements) {
        if (a.progressState !== 'Achieved') continue;
        const icon = (a.mediaAssets ?? []).find((m: any) => m.type === 'Icon')?.url;
        const pct = a.rarity?.currentPercentage;
        out.push({
          provider: 'xbox',
          gameTitle: t.name,
          gameIconUrl: cover,
          name: a.name,
          detail: a.description ?? a.lockedDescription,
          iconUrl: icon,
          earnedAt: a.progression?.timeUnlocked,
          rarity: pct != null ? Math.round(Number(pct) * 10) / 10 : undefined,
        });
      }
      return out;
    } catch (err) {
      this.logAchievementError('v2', t, err);
      return [];
    }
  }

  private async fetchLegacyAchievements(
    session: XboxSession,
    t: XboxTitle,
  ): Promise<RecentTrophy[]> {
    try {
      const { data } = await axios.get(
        `${ACHIEVEMENTS}/users/xuid(${session.xuid})/achievements`,
        {
          headers: this.headers(session, '1'),
          params: { titleId: t.titleId, maxItems: 1000 },
          timeout: 20000,
        },
      );
      // The v1 endpoint returns only the achievements the user has earned, in the legacy
      // schema: `unlocked` marks the earn and `timeUnlocked` holds the date. There are no
      // per-achievement icons (only a numeric `imageId`), so these fall back to the game cover.
      const achievements: any[] = data?.achievements ?? [];
      const cover = this.coverFor(t);
      const out: RecentTrophy[] = [];
      for (const a of achievements) {
        if (a.unlocked !== true) continue;
        out.push({
          provider: 'xbox',
          gameTitle: t.name,
          gameIconUrl: cover,
          name: a.name,
          detail: a.description ?? a.lockedDescription,
          iconUrl: undefined,
          earnedAt: a.timeUnlocked,
          rarity: undefined,
        });
      }
      return out;
    } catch (err) {
      this.logAchievementError('v1', t, err);
      return [];
    }
  }

  private logAchievementError(api: string, t: XboxTitle, err: unknown): void {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const body = axios.isAxiosError(err)
      ? JSON.stringify(err.response?.data)?.slice(0, 200)
      : String(err);
    this.logger.warn(
      `Xbox achievements (${api}) fetch failed for ${t.name} (${t.titleId}): status=${status} body=${body}`,
    );
  }
}
