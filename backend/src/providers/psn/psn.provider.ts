import { Injectable, Logger } from '@nestjs/common';
import {
  exchangeCodeForAccessToken,
  exchangeNpssoForCode,
  getProfileFromUserName,
  getTitleTrophies,
  getTitleTrophyGroups,
  getUserPlayedGames,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  getUserTrophyGroupEarningsForTitle,
  getUserTrophyProfileSummary,
  type AuthTokensResponse,
} from 'psn-api';
import type { GameProvider, ProviderCredentials } from '../game-provider.interface.js';
import type {
  DlcGroup,
  NormalizedGame,
  NormalizedTrophies,
  ProviderResult,
  RecentTrophy,
  TrophyProfile,
  TrophyUpdate,
} from '../../domain/game.model.js';
import { mergeKey } from '../../games/aggregation.js';

interface Authorization {
  accessToken: string;
}

interface PlayedEntry {
  game: NormalizedGame;
  variants: Set<string>;
}

interface TrophyTitle {
  id: string;
  serviceName: string;
  name: string;
  norm: string;
  stripped: string;
  platformLabel: string;
  iconUrl?: string;
  hasGroups: boolean;
  /** Raw lastUpdatedDateTime from getUserTitles, used for incremental sync diffing. */
  lastUpdated?: string;
  base: NormalizedTrophies;
}

const CONCURRENCY = 8;

@Injectable()
export class PsnProvider implements GameProvider {
  readonly platform = 'psn' as const;
  private readonly logger = new Logger(PsnProvider.name);

  private auth?: AuthTokensResponse;
  private authExpiresAt = 0;
  private _npsso?: string;

  private get npsso(): string | undefined {
    return this._npsso;
  }

  isConfigured(creds: ProviderCredentials): boolean {
    return !!creds.psnNpsso;
  }

  private async authorize(): Promise<Authorization> {
    const now = Date.now();
    if (this.auth && now < this.authExpiresAt) return { accessToken: this.auth.accessToken };

    const npsso = this.npsso;
    if (!npsso) throw new Error('PSN_NPSSO not configured');

    const accessCode = await exchangeNpssoForCode(npsso);
    const auth = await exchangeCodeForAccessToken(accessCode);
    this.auth = auth;
    this.authExpiresAt = now + (auth.expiresIn - 60) * 1000;
    return { accessToken: auth.accessToken };
  }

  async fetch(
    creds: ProviderCredentials,
    knownTrophyState?: Map<string, string>,
  ): Promise<ProviderResult> {
    this._npsso = creds.psnNpsso?.trim() || undefined;
    this.auth = undefined;
    this.authExpiresAt = 0;
    if (!this.isConfigured(creds)) {
      return {
        status: { provider: this.platform, connected: false, error: 'NPSSO not configured' },
        games: [],
      };
    }

    try {
      const authorization = await this.authorize();

      const [accountName, played, trophyTitles] = await Promise.all([
        this.fetchAccountName(authorization),
        this.fetchPlayedGames(authorization),
        this.fetchTrophyTitles(authorization),
      ]);

      await this.enrichGroups(authorization, trophyTitles);
      await this.enrichPlatinumIcons(authorization, trophyTitles);
      const { games, matchedIds } = attachTrophies(played, trophyTitles);
      const synthetic = buildSyntheticGames(trophyTitles, matchedIds);
      const allGames = [...games, ...synthetic];
      const platinumEarned = trophyTitles.filter((t) => t.base.platinumEarned > 0).length;

      const [trophyProfile, trophyUpdates] = await Promise.all([
        this.fetchTrophyProfile(authorization),
        this.fetchTrophyUpdates(authorization, trophyTitles, knownTrophyState ?? new Map()),
      ]);

      return {
        status: {
          provider: this.platform,
          connected: true,
          accountName,
          gameCount: allGames.length,
          platinumEarned,
        },
        games: allGames,
        trophyProfile,
        trophyUpdates,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch PSN data: ${message}`);
      return {
        status: { provider: this.platform, connected: false, error: message },
        games: [],
      };
    }
  }

  private async fetchAccountName(authorization: Authorization): Promise<string | undefined> {
    try {
      const { profile } = await getProfileFromUserName(authorization, 'me');
      return profile?.onlineId;
    } catch {
      return undefined;
    }
  }

  private async fetchPlayedGames(authorization: Authorization): Promise<PlayedEntry[]> {
    const entries: PlayedEntry[] = [];
    let offset = 0;
    const limit = 200;

    for (let page = 0; page < 20; page++) {
      const res: any = await getUserPlayedGames(authorization, 'me', { limit, offset });
      const titles: any[] = res?.titles ?? [];
      for (const t of titles) {
        if (isAppCategory(t.category)) continue;
        const variants = collectNameVariants(t);
        entries.push({
          game: {
            provider: 'psn',
            externalId: t.titleId,
            title: t.name ?? t.localizedName ?? 'Unknown',
            platformLabel: mapPlatform(t.category, t.titleId),
            iconUrl: t.imageUrl,
            coverUrl: t.imageUrl,
            playtimeMinutes: isoDurationToMinutes(t.playDuration),
            playtimeKnown: true,
            genres: prettyGenres(t.concept?.genres),
            firstPlayed: t.firstPlayedDateTime,
            lastPlayed: t.lastPlayedDateTime,
            playCount: t.playCount,
          },
          variants,
        });
      }
      const total: number = res?.totalItemCount ?? entries.length;
      offset += titles.length;
      if (titles.length === 0 || offset >= total) break;
    }
    return entries;
  }

  private async fetchTrophyTitles(authorization: Authorization): Promise<TrophyTitle[]> {
    const titles: TrophyTitle[] = [];
    try {
      let offset = 0;
      const limit = 100;
      for (let page = 0; page < 40; page++) {
        const res: any = await getUserTitles(authorization, 'me', { limit, offset });
        const list: any[] = res?.trophyTitles ?? [];
        for (const t of list) {
          const earned = sumTrophies(t.earnedTrophies);
          const total = sumTrophies(t.definedTrophies);
          titles.push({
            id: t.npCommunicationId,
            serviceName: t.npServiceName ?? 'trophy',
            name: t.trophyTitleName ?? '',
            norm: normalizeTitle(t.trophyTitleName ?? ''),
            stripped: mergeKey(t.trophyTitleName ?? ''),
            platformLabel: t.trophyTitlePlatform ?? '',
            iconUrl: t.trophyTitleIconUrl,
            hasGroups: !!t.hasTrophyGroups,
            lastUpdated: t.lastUpdatedDateTime,
            base: {
              id: t.npCommunicationId,
              titleName: t.trophyTitleName,
              platformLabel: t.trophyTitlePlatform,
              earned,
              total,
              progress:
                typeof t.progress === 'number'
                  ? t.progress
                  : total
                    ? Math.round((earned / total) * 100)
                    : 0,
              platinumTotal: t.definedTrophies?.platinum ?? 0,
              platinumEarned: t.earnedTrophies?.platinum ?? 0,
              lastEarnedAt: t.lastUpdatedDateTime,
            },
          });
        }
        const totalItems: number = res?.totalItemCount ?? titles.length;
        offset += list.length;
        if (list.length === 0 || offset >= totalItems) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not load PSN trophies: ${message}`);
    }
    return titles;
  }

  private async enrichGroups(authorization: Authorization, titles: TrophyTitle[]): Promise<void> {
    const withGroups = titles.filter((t) => t.hasGroups);
    for (let i = 0; i < withGroups.length; i += CONCURRENCY) {
      const batch = withGroups.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (title) => {
          const groups = await this.fetchGroups(authorization, title);
          if (groups.length > 1) title.base.groups = groups;
        }),
      );
    }
  }

  private async enrichPlatinumIcons(
    authorization: Authorization,
    titles: TrophyTitle[],
  ): Promise<void> {
    const platTitles = titles.filter((t) => t.base.platinumEarned > 0);
    for (let i = 0; i < platTitles.length; i += CONCURRENCY) {
      const batch = platTitles.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (title) => {
          const options = { npServiceName: title.serviceName as 'trophy' | 'trophy2' };
          try {
            const [defs, earned]: [any, any] = await Promise.all([
              getTitleTrophies(authorization, title.id, 'all', options),
              getUserTrophiesEarnedForTitle(authorization, 'me', title.id, 'all', options),
            ]);
            const platDef = (defs?.trophies ?? []).find((x: any) => x.trophyType === 'platinum');
            if (platDef?.trophyIconUrl) title.base.platinumIconUrl = platDef.trophyIconUrl;
            if (platDef) {
              const earnedPlat = (earned?.trophies ?? []).find(
                (x: any) => x.trophyId === platDef.trophyId,
              );
              // Exact platinum earn date (falls back to the title's last-updated time otherwise).
              if (earnedPlat?.earnedDateTime) title.base.lastEarnedAt = earnedPlat.earnedDateTime;
            }
          } catch {
            return;
          }
        }),
      );
    }
  }

  private async fetchTrophyProfile(
    authorization: Authorization,
  ): Promise<TrophyProfile | undefined> {
    try {
      const res: any = await getUserTrophyProfileSummary(authorization, 'me');
      return {
        level: Number(res?.trophyLevel ?? 0),
        tier: Number(res?.tier ?? 0),
        progress: Number(res?.progress ?? 0),
        counts: {
          bronze: res?.earnedTrophies?.bronze ?? 0,
          silver: res?.earnedTrophies?.silver ?? 0,
          gold: res?.earnedTrophies?.gold ?? 0,
          platinum: res?.earnedTrophies?.platinum ?? 0,
        },
      };
    } catch (err) {
      this.logger.warn(`Trophy profile failed: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  }

  /** Fetch individual trophies only for titles that changed since the last sync (incremental). */
  private async fetchTrophyUpdates(
    authorization: Authorization,
    titles: TrophyTitle[],
    known: Map<string, string>,
  ): Promise<TrophyUpdate[]> {
    const changed = titles.filter(
      (t) => t.base.earned > 0 && known.get(t.id) !== (t.lastUpdated ?? ''),
    );
    this.logger.log(`Trophy sync: ${changed.length}/${titles.length} titles changed`);

    const updates: TrophyUpdate[] = [];
    for (let i = 0; i < changed.length; i += CONCURRENCY) {
      const batch = changed.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (title) => ({
          npCommId: title.id,
          lastUpdated: title.lastUpdated,
          trophies: await this.fetchTitleEarnedTrophies(authorization, title),
        })),
      );
      updates.push(...results);
    }
    return updates;
  }

  private async fetchTitleEarnedTrophies(
    authorization: Authorization,
    title: TrophyTitle,
  ): Promise<RecentTrophy[]> {
    const options = { npServiceName: title.serviceName as 'trophy' | 'trophy2' };
    try {
      const [defs, earned]: [any, any] = await Promise.all([
        getTitleTrophies(authorization, title.id, 'all', options),
        getUserTrophiesEarnedForTitle(authorization, 'me', title.id, 'all', options),
      ]);
      const defById = new Map<number, any>();
      for (const d of defs?.trophies ?? []) defById.set(d.trophyId, d);
      const out: RecentTrophy[] = [];
      for (const e of earned?.trophies ?? []) {
        if (!e.earned) continue;
        const d = defById.get(e.trophyId);
        out.push({
          provider: 'psn',
          gameTitle: cleanTrophyTitle(title.name),
          gameIconUrl: title.iconUrl,
          name: d?.trophyName ?? '',
          detail: d?.trophyDetail,
          iconUrl: d?.trophyIconUrl,
          type: (e.trophyType ?? d?.trophyType ?? 'bronze') as RecentTrophy['type'],
          earnedAt: e.earnedDateTime,
          rarity: e.trophyEarnedRate != null ? Number(e.trophyEarnedRate) : undefined,
        });
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `Recent trophies failed for ${title.name}: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  private async fetchGroups(authorization: Authorization, title: TrophyTitle): Promise<DlcGroup[]> {
    try {
      const options = { npServiceName: title.serviceName as 'trophy' | 'trophy2' };
      const [defined, earned]: [any, any] = await Promise.all([
        getTitleTrophyGroups(authorization, title.id, options),
        getUserTrophyGroupEarningsForTitle(authorization, 'me', title.id, options),
      ]);
      const earnedById = new Map<string, any>();
      for (const g of earned?.trophyGroups ?? []) earnedById.set(g.trophyGroupId, g);

      return (defined?.trophyGroups ?? []).map((g: any): DlcGroup => {
        const e = earnedById.get(g.trophyGroupId);
        return {
          id: g.trophyGroupId,
          name: g.trophyGroupName ?? (g.trophyGroupId === 'default' ? 'Base game' : 'DLC'),
          isBase: g.trophyGroupId === 'default',
          earned: sumTrophies(e?.earnedTrophies),
          total: sumTrophies(g.definedTrophies),
          platinumTotal: g.definedTrophies?.platinum ?? 0,
          platinumEarned: e?.earnedTrophies?.platinum ?? 0,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Trophy groups failed for ${title.name}: ${message}`);
      return [];
    }
  }
}

function attachTrophies(
  played: PlayedEntry[],
  titles: TrophyTitle[],
): { games: NormalizedGame[]; matchedIds: Set<string> } {
  const matchedIds = new Set<string>();
  const games = played.map(({ game, variants }) => {
    const strippedVariants = new Set<string>();
    for (const v of variants) {
      const s = mergeKey(v);
      if (s) strippedVariants.add(s);
    }
    const prefixVariants = [...variants].filter((v) => v.length >= 4);
    const gameTier = platformTier(game.platformLabel);

    const matched = new Map<string, NormalizedTrophies>();
    for (const t of titles) {
      if (matchesTitle(t, variants, strippedVariants, prefixVariants, gameTier)) {
        matched.set(t.id, t.base);
        matchedIds.add(t.id);
      }
    }

    return matched.size > 0 ? { ...game, trophySets: [...matched.values()] } : game;
  });
  return { games, matchedIds };
}

function buildSyntheticGames(titles: TrophyTitle[], matchedIds: Set<string>): NormalizedGame[] {
  return titles
    .filter((t) => !matchedIds.has(t.id) && t.base.earned > 0)
    .map((t) => ({
      provider: 'psn' as const,
      externalId: t.id,
      title: cleanTrophyTitle(t.name),
      platformLabel: prettyTrophyPlatform(t.platformLabel),
      iconUrl: t.iconUrl,
      coverUrl: t.iconUrl,
      playtimeMinutes: 0,
      playtimeKnown: false,
      trophySets: [t.base],
    }));
}

function cleanTrophyTitle(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s+Trophy Set$/i, '')
    .replace(/\s+Trophies$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function prettyTrophyPlatform(label: string): string {
  return label
    .split(',')
    .map((p) => {
      const u = p.trim().toUpperCase();
      return u === 'PSVITA' ? 'PS Vita' : u;
    })
    .filter(Boolean)
    .join('/');
}

function platformTier(label: string): string {
  const u = label.toUpperCase();
  if (/PS3|VITA|PSP/.test(u)) return 'legacy';
  if (/STEAM|PC/.test(u)) return 'pc';
  return 'modern';
}

function matchesTitle(
  t: TrophyTitle,
  variants: Set<string>,
  strippedVariants: Set<string>,
  prefixVariants: string[],
  gameTier: string,
): boolean {
  if (variants.has(t.norm)) return true;
  if (platformTier(t.platformLabel) !== gameTier) return false;
  if (t.stripped && strippedVariants.has(t.stripped)) return true;
  return prefixVariants.some((v) => t.norm === v || t.norm.endsWith(` ${v}`));
}

function collectNameVariants(t: any): Set<string> {
  const names: string[] = [t.name, t.localizedName, t.concept?.name];
  const metadata = t.concept?.localizedName?.metadata;
  if (metadata && typeof metadata === 'object') {
    for (const value of Object.values(metadata)) {
      if (typeof value === 'string') names.push(value);
    }
  }
  const variants = new Set<string>();
  for (const name of names) {
    const norm = normalizeTitle(name);
    if (norm) variants.add(norm);
  }
  return variants;
}

function sumTrophies(t?: {
  bronze?: number;
  silver?: number;
  gold?: number;
  platinum?: number;
}): number {
  if (!t) return 0;
  return (t.bronze ?? 0) + (t.silver ?? 0) + (t.gold ?? 0) + (t.platinum ?? 0);
}

function mapPlatform(category?: string, titleId?: string): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('ps5')) return 'PS5';
  if (c.includes('ps4')) return 'PS4';
  if (c.includes('ps3')) return 'PS3';
  return platformFromTitleId(titleId);
}

function platformFromTitleId(titleId?: string): string {
  const id = (titleId ?? '').toUpperCase();
  if (id.startsWith('PPSA')) return 'PS5';
  if (id.startsWith('CUSA')) return 'PS4';
  if (id.startsWith('PCS') || id.startsWith('VCJS')) return 'PS Vita';
  if (/^(BCUS|BLUS|BLES|BCES|NPUB|NPEB|NPHB|NPJB)/.test(id)) return 'PS3';
  return 'PlayStation';
}

function isAppCategory(category?: string): boolean {
  return /app$/i.test(category ?? '');
}

function prettyGenres(genres?: string[]): string[] {
  if (!Array.isArray(genres)) return [];
  return genres.map((g) =>
    g
      .split(/[\s_]+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(' '),
  );
}

export function isoDurationToMinutes(iso?: string): number {
  if (!iso) return 0;
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Math.round(Number(s ?? 0) / 60)
  );
}

const ROMAN_NUMERALS: Record<string, string> = {
  ⅰ: 'i',
  ⅱ: 'ii',
  ⅲ: 'iii',
  ⅳ: 'iv',
  ⅴ: 'v',
  ⅵ: 'vi',
  ⅶ: 'vii',
  ⅷ: 'viii',
  ⅸ: 'ix',
  ⅹ: 'x',
  ⅺ: 'xi',
  ⅻ: 'xii',
};

function normalizeTitle(name?: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[ⅰ-ⅻ]/g, (c) => ROMAN_NUMERALS[c] ?? c)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
