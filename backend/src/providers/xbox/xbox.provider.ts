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

/** An earned achievement before it's tied to its game (title name/cover are filled in later). */
type EarnedAchievement = Pick<
  RecentTrophy,
  'name' | 'detail' | 'iconUrl' | 'earnedAt' | 'rarity'
>;

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

  /**
   * Make an Xbox Live image URL usable from our https deployment. Titlehub returns image URLs
   * on `http://images-eds.xboxlive.com`, which the browser blocks as mixed content — and its
   * plain-https variant serves a certificate that doesn't match the host (also blocked). Xbox
   * exposes the same CDN under a dedicated SSL host (`images-eds-ssl.xboxlive.com`) with a valid
   * certificate, so rewrite to that; upgrade any other http URL to https as a fallback.
   */
  private httpsify(url?: string): string | undefined {
    if (!url) return undefined;
    const ssl = url.replace(
      /^https?:\/\/images-eds\.xboxlive\.com/,
      'https://images-eds-ssl.xboxlive.com',
    );
    return ssl.startsWith('http://') ? 'https://' + ssl.slice('http://'.length) : ssl;
  }

  private coverFor(t: XboxTitle): string | undefined {
    const boxart = t.images?.find((i) => i.type === 'BoxArt' || i.type === 'Poster');
    return this.httpsify(boxart?.url ?? t.displayImage);
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

  /**
   * A per-title fingerprint used to decide whether to re-fetch its individual achievements.
   * It combines last-played time with the earned/total counts: right after connecting, Xbox
   * Live may briefly report 0 earned (data not yet propagated), so keying on lastTimePlayed
   * alone would cache an empty trophy list and never refresh once the counts populate. Folding
   * in the counts forces a re-fetch as soon as they change.
   */
  private syncKey(t: XboxTitle): string {
    const last = t.titleHistory?.lastTimePlayed ?? '';
    const earned = t.achievement?.currentAchievements ?? 0;
    const total = t.achievement?.totalAchievements ?? 0;
    // The leading token is a fetch-logic version: bump it whenever the way we resolve
    // achievements changes, so the next sync re-fetches every title once (titles cached as
    // empty by an older, broken strategy would otherwise never refresh).
    return `v2|${last}|${earned}/${total}`;
  }

  /** Store individual achievements for titles that changed since the last sync (incremental). */
  private async buildTrophyUpdates(
    session: XboxSession,
    titles: XboxTitle[],
    known: Map<string, string>,
  ): Promise<TrophyUpdate[]> {
    const changed = titles.filter((t) => known.get(`xbox:${t.titleId}`) !== this.syncKey(t));
    if (changed.length === 0) {
      this.logger.log(`Xbox trophy sync: 0/${titles.length} titles changed`);
      return [];
    }

    // One paginated call returns every earned Xbox One/Series achievement, grouped by title.
    // (Per-title queries return the catalogue with the user's state stripped — all NotStarted —
    // so the user's history endpoint is the only reliable source, joined back to titles by id.)
    const earnedByTitle = await this.fetchEarnedAchievements(session);
    this.logger.log(
      `Xbox trophy sync: ${changed.length}/${titles.length} changed; modern earned across ${earnedByTitle.size} titles`,
    );

    const updates: TrophyUpdate[] = [];
    for (let i = 0; i < changed.length; i += CONCURRENCY) {
      const batch = changed.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map(async (t) => ({
          npCommId: `xbox:${t.titleId}`,
          lastUpdated: this.syncKey(t),
          trophies: await this.trophiesForTitle(session, t, earnedByTitle),
        })),
      );
      updates.push(...res);
    }
    return updates;
  }

  private async trophiesForTitle(
    session: XboxSession,
    t: XboxTitle,
    earnedByTitle: Map<string, EarnedAchievement[]>,
  ): Promise<RecentTrophy[]> {
    const cover = this.coverFor(t);
    const modern = earnedByTitle.get(String(t.titleId));
    if (modern && modern.length > 0) {
      return modern.map((a) => ({ provider: 'xbox', gameTitle: t.name, gameIconUrl: cover, ...a }));
    }
    // Xbox 360 titles don't appear in the modern achievement history; their unlocks live in the
    // legacy (contract v1) endpoint, which does honour the user's state per title.
    if ((t.achievement?.currentAchievements ?? 0) > 0) {
      return this.fetchLegacyAchievements(session, t);
    }
    return [];
  }

  /**
   * Page through the user's whole achievement history (modern, contract v2) and return every
   * earned achievement grouped by its title id. This is the only endpoint that reflects the
   * user's actual unlock state for Xbox One/Series titles.
   */
  private async fetchEarnedAchievements(
    session: XboxSession,
  ): Promise<Map<string, EarnedAchievement[]>> {
    const out = new Map<string, EarnedAchievement[]>();
    let continuationToken: string | undefined;
    let page = 0;
    try {
      do {
        const params: Record<string, unknown> = { maxItems: 1000 };
        if (continuationToken) params.continuationToken = continuationToken;
        const { data } = await axios.get(
          `${ACHIEVEMENTS}/users/xuid(${session.xuid})/achievements`,
          { headers: this.headers(session, '2'), params, timeout: 25000 },
        );
        for (const a of (data?.achievements ?? []) as any[]) {
          if (a.progressState !== 'Achieved') continue;
          const titleId = a.titleAssociations?.[0]?.id;
          if (titleId == null) continue;
          const icon = this.httpsify((a.mediaAssets ?? []).find((m: any) => m.type === 'Icon')?.url);
          const pct = a.rarity?.currentPercentage;
          const entry: EarnedAchievement = {
            name: a.name,
            detail: a.description ?? a.lockedDescription,
            iconUrl: icon,
            earnedAt: a.progression?.timeUnlocked,
            rarity: pct != null ? Math.round(Number(pct) * 10) / 10 : undefined,
          };
          const key = String(titleId);
          const arr = out.get(key);
          if (arr) arr.push(entry);
          else out.set(key, [entry]);
        }
        continuationToken = data?.pagingInfo?.continuationToken ?? undefined;
        page++;
      } while (continuationToken && page < 25);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Xbox earned-achievement history failed: ${message}`);
    }
    return out;
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
