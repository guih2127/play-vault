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

/** The earned achievements for one title, plus the title's name from the achievement history. */
interface TitleEarned {
  name?: string;
  achievements: EarnedAchievement[];
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
      const recentTitles = await this.fetchTitles(session);
      // The user's earned Xbox One/Series achievements — the only reliable source of unlock
      // state (per-title queries return the catalogue with every achievement as NotStarted).
      const earned = await this.fetchEarnedAchievements(session);
      // Titles the user earned achievements in but that dropped out of the recent title history
      // (typically older games): fetch their metadata so they still show up as games.
      const recentIds = new Set(recentTitles.map((t) => String(t.titleId)));
      const missingIds = [...earned.keys()].filter((id) => !recentIds.has(id));
      const extraTitles = await this.fetchTitlesByIds(session, missingIds, earned);
      const titles = [...recentTitles, ...extraTitles];

      const games = titles.map((t) => this.toNormalizedGame(t, earned));
      const trophyUpdates = await this.buildTrophyUpdates(
        session,
        titles,
        knownTrophyState ?? new Map(),
        earned,
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
   * Fetch metadata (name, cover, achievement totals) for specific title ids — used for games the
   * user earned achievements in that no longer appear in the recent title history. If titlehub
   * can't return a title, fall back to a minimal record built from the achievement history so the
   * game (and its trophies) still shows, just without cover art.
   */
  private async fetchTitlesByIds(
    session: XboxSession,
    ids: string[],
    earned: Map<string, TitleEarned>,
  ): Promise<XboxTitle[]> {
    if (ids.length === 0) return [];
    const out: XboxTitle[] = [];
    const CHUNK = 15;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const path = chunk.map((id) => `titleid(${id})`).join(',');
      try {
        const { data } = await axios.get(
          `${TITLEHUB}/users/xuid(${session.xuid})/titles/${path}/decoration/achievement,image`,
          { headers: this.headers(session, '2'), timeout: 25000 },
        );
        const fetched: XboxTitle[] = data?.titles ?? [];
        const seen = new Set(fetched.map((t) => String(t.titleId)));
        out.push(...fetched);
        // Anything titlehub omitted still gets a minimal record from the history.
        for (const id of chunk) {
          if (!seen.has(id)) out.push({ titleId: id, name: earned.get(id)?.name ?? `Xbox ${id}` });
        }
      } catch {
        for (const id of chunk) {
          out.push({ titleId: id, name: earned.get(id)?.name ?? `Xbox ${id}` });
        }
      }
    }
    return out;
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

  private toNormalizedGame(t: XboxTitle, earned: Map<string, TitleEarned>): NormalizedGame {
    const ach = t.achievement;
    const cover = this.coverFor(t);
    // titlehub's currentAchievements is unreliable for Xbox One/Series (often 0 even when the
    // user has unlocks), so prefer the count from the achievement history when we have it.
    const historyEarned = earned.get(String(t.titleId))?.achievements.length ?? 0;
    const earnedCount = Math.max(historyEarned, ach?.currentAchievements ?? 0);
    const total = ach?.totalAchievements ?? historyEarned;
    const set: NormalizedTrophies | undefined =
      total > 0 || earnedCount > 0
        ? {
            id: `xbox:${t.titleId}`,
            titleName: t.name,
            platformLabel: 'Xbox',
            earned: earnedCount,
            total: total || earnedCount,
            progress: total ? Math.round((earnedCount / total) * 100) : earnedCount > 0 ? 100 : 0,
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
  private syncKey(t: XboxTitle, earned: Map<string, TitleEarned>): string {
    const last = t.titleHistory?.lastTimePlayed ?? '';
    const historyEarned = earned.get(String(t.titleId))?.achievements.length ?? 0;
    const e = Math.max(historyEarned, t.achievement?.currentAchievements ?? 0);
    const total = t.achievement?.totalAchievements ?? historyEarned;
    // The leading token is a fetch-logic version: bump it whenever the way we resolve
    // achievements changes, so the next sync re-fetches every title once (titles cached as
    // empty by an older, broken strategy would otherwise never refresh).
    return `v3|${last}|${e}/${total}`;
  }

  /** Store individual achievements for titles that changed since the last sync (incremental). */
  private async buildTrophyUpdates(
    session: XboxSession,
    titles: XboxTitle[],
    known: Map<string, string>,
    earned: Map<string, TitleEarned>,
  ): Promise<TrophyUpdate[]> {
    const changed = titles.filter((t) => known.get(`xbox:${t.titleId}`) !== this.syncKey(t, earned));
    this.logger.log(
      `Xbox trophy sync: ${changed.length}/${titles.length} changed; earned history across ${earned.size} titles`,
    );
    if (changed.length === 0) return [];

    const updates: TrophyUpdate[] = [];
    for (let i = 0; i < changed.length; i += CONCURRENCY) {
      const batch = changed.slice(i, i + CONCURRENCY);
      const res = await Promise.all(
        batch.map(async (t) => ({
          npCommId: `xbox:${t.titleId}`,
          lastUpdated: this.syncKey(t, earned),
          trophies: await this.trophiesForTitle(session, t, earned),
        })),
      );
      updates.push(...res);
    }
    return updates;
  }

  private async trophiesForTitle(
    session: XboxSession,
    t: XboxTitle,
    earned: Map<string, TitleEarned>,
  ): Promise<RecentTrophy[]> {
    const cover = this.coverFor(t);
    const modern = earned.get(String(t.titleId))?.achievements;
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
  ): Promise<Map<string, TitleEarned>> {
    const out = new Map<string, TitleEarned>();
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
          const assoc = a.titleAssociations?.[0];
          if (assoc?.id == null) continue;
          const icon = this.httpsify((a.mediaAssets ?? []).find((m: any) => m.type === 'Icon')?.url);
          const pct = a.rarity?.currentPercentage;
          const entry: EarnedAchievement = {
            name: a.name,
            detail: a.description ?? a.lockedDescription,
            iconUrl: icon,
            earnedAt: a.progression?.timeUnlocked,
            rarity: pct != null ? Math.round(Number(pct) * 10) / 10 : undefined,
          };
          const key = String(assoc.id);
          const te = out.get(key);
          if (te) te.achievements.push(entry);
          else out.set(key, { name: assoc.name, achievements: [entry] });
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
