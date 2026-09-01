import { Inject, Injectable } from '@nestjs/common';
import { GAME_PROVIDERS } from '../providers/game-provider.interface.js';
import type { GameProvider } from '../providers/game-provider.interface.js';
import type {
  Platform,
  ProviderStatus,
  RecentTrophy,
  TrophyProfile,
} from '../domain/game.model.js';
import { DatabaseService } from '../db/database.service.js';
import type { AggregatedGame } from './aggregation.js';
import { mergeKey } from './aggregation.js';
import type { SnapshotPayload } from './snapshot.js';

export interface BacklogItem {
  id: number;
  title: string;
  platform: string;
  coverUrl?: string;
  priority: number;
  notes?: string;
  createdAt: string;
}

/** Strip Sony's " Trophy Set" / " Trophies" suffixes that leak into some title names. */
function cleanTitle(name: string): string {
  return (name ?? '')
    .replace(/\s+Trophy Set$/i, '')
    .replace(/\s+Trophies$/i, '')
    .trim();
}

function clampPriority(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(2, n));
}

function trophyTotals(g: AggregatedGame): { earned: number; total: number } {
  return {
    earned: g.trophySets.reduce((s, t) => s + t.earned, 0),
    total: g.trophySets.reduce((s, t) => s + t.total, 0),
  };
}

/** A game is "completed" when platinumed, or 100% of its trophies/achievements are earned. */
function isCompleted(g: AggregatedGame): boolean {
  if (g.platinum.earned > 0) return true;
  const { earned, total } = trophyTotals(g);
  return total > 0 && earned === total;
}

/** A game is "beaten" when explicitly marked, or completed. */
function isBeaten(g: AggregatedGame): boolean {
  return !!g.beaten || isCompleted(g);
}

function isSteamTrophySet(platformLabel: string): boolean {
  return /steam/i.test(platformLabel);
}

function emptyProviderTrophies() {
  return {
    earned: 0,
    total: 0,
    platinumEarned: 0,
    platinumTotal: 0,
    gamesWithTrophies: 0,
    beaten: 0,
  };
}

export interface ProviderTrophies {
  earned: number;
  total: number;
  platinumEarned: number;
  platinumTotal: number;
  gamesWithTrophies: number;
  beaten: number;
}

export interface DashboardSummary {
  lastSyncAt: string | null;
  providers: ProviderStatus[];
  totals: {
    games: number;
    playtimeMinutes: number;
    playtimeHours: number;
    trophiesEarned: number;
    trophiesTotal: number;
    platinumEarned: number;
    platinumTotal: number;
  };
  counts: {
    beaten: number;
    completed: number;
    /** PSN platinums + Steam games at 100% achievements. */
    platinum: number;
    playtimeHours: number;
  };
  byPlatform: Array<{ provider: Platform; games: number; playtimeMinutes: number }>;
  recentlyPlayed: AggregatedGame[];
  mostPlayed: AggregatedGame[];
  playingGames: AggregatedGame[];
  beatenGames: AggregatedGame[];
  trophiesByProvider: { psn: ProviderTrophies; steam: ProviderTrophies };
  recentPlatinums: {
    psn: Array<{
      key: string;
      title: string;
      name?: string;
      coverUrl?: string;
      platinumIconUrl?: string;
      earnedAt?: string;
      rarity?: number;
    }>;
    steam: Array<{
      key: string;
      title: string;
      name?: string;
      coverUrl?: string;
      platinumIconUrl?: string;
      earnedAt?: string;
      rarity?: number;
    }>;
  };
  recentTrophies: { psn: RecentTrophy[]; steam: RecentTrophy[] };
  trophyProfile: TrophyProfile | null;
  backlogPreview: BacklogItem[];
  backlogCount: number;
}

@Injectable()
export class GamesService {
  constructor(
    @Inject(GAME_PROVIDERS) private readonly providers: GameProvider[],
    private readonly db: DatabaseService,
  ) {}

  private latest() {
    return this.db.getLatestSnapshot<SnapshotPayload>();
  }

  getGames(): AggregatedGame[] {
    const snap = this.latest();
    const beatenKeys = this.db.getBeatenKeys();
    const playingKeys = this.db.getPlayingKeys();
    const ratings = this.db.getRatings();
    const synced = (snap?.data.games ?? []).filter((g) => g.trophySets.length > 0);
    const all = [...synced, ...this.manualGames()];

    // Real platinum dates live in the incremental trophy store; map them to each game
    // (indexing by trophy-set title names too, so localized titles like WUCHANG resolve).
    const keyByTitle = new Map<string, string>();
    for (const g of all) {
      keyByTitle.set(mergeKey(g.title), g.key);
      for (const s of g.trophySets) if (s.titleName) keyByTitle.set(mergeKey(s.titleName), g.key);
    }
    const platDateByKey = new Map<string, string>();
    for (const t of this.db.getAllStoredTrophies<RecentTrophy>()) {
      if (t.type !== 'platinum' || !t.earnedAt) continue;
      const key = keyByTitle.get(mergeKey(t.gameTitle)) ?? mergeKey(t.gameTitle);
      const prev = platDateByKey.get(key);
      if (!prev || t.earnedAt > prev) platDateByKey.set(key, t.earnedAt);
    }

    // Ratings may have been stored under a title-variant key (e.g. a trophy-set
    // name); remap them to the canonical game key so they still resolve.
    const ratingByGameKey = new Map<string, number>();
    for (const [rk, rv] of ratings) ratingByGameKey.set(keyByTitle.get(rk) ?? rk, rv);

    return all.map((g) => ({
      ...g,
      title: cleanTitle(g.title),
      platinumEarnedAt: platDateByKey.get(g.key),
      beaten: g.manual ? beatenKeys.has(g.key) || g.beaten : beatenKeys.has(g.key),
      playing: playingKeys.has(g.key),
      rating: ratings.get(g.key) ?? ratingByGameKey.get(g.key),
    }));
  }

  setRating(key: string, rating: number): void {
    this.db.setRating(key, Math.max(0, Math.min(5, Math.round(rating * 2) / 2)));
  }

  private manualGames(): AggregatedGame[] {
    return this.db.listManualGames().map((row) => ({
      key: `manual:${row.id}`,
      title: row.title,
      platformLabels: [row.platform],
      providers: [],
      genres: [],
      totalPlaytimeMinutes: row.playtime_minutes ?? 0,
      playtimeKnown: row.playtime_minutes != null,
      coverUrl: row.cover_url ?? undefined,
      trophySets: [],
      platinum: { earned: 0, total: 0 },
      manual: true,
    }));
  }

  setBeaten(key: string, beaten: boolean): void {
    this.db.setBeaten(key, beaten);
    if (beaten) this.db.setPlaying(key, false);
  }

  setPlaying(key: string, playing: boolean): void {
    this.db.setPlaying(key, playing);
  }

  /**
   * Set each beaten PlayStation game's "beaten date" to the date of its most recently
   * earned trophy, taken from the incremental trophy store. Lets the beaten list be
   * ordered by real completion date across platforms.
   */
  backfillPsnBeatenDates(): { updated: number } {
    const store = this.db.getAllStoredTrophies<RecentTrophy>();
    const lastByKey = new Map<string, string>();
    for (const t of store) {
      if ((t.provider ?? 'psn') !== 'psn' || !t.earnedAt || !t.gameTitle) continue;
      const key = mergeKey(t.gameTitle);
      const prev = lastByKey.get(key);
      if (!prev || t.earnedAt > prev) lastByKey.set(key, t.earnedAt);
    }

    let updated = 0;
    for (const g of this.getGames()) {
      if (!g.providers.includes('psn') || !isBeaten(g)) continue;
      const date = lastByKey.get(g.key);
      if (!date) continue;
      this.db.setBeatenDate(g.key, date);
      updated++;
    }
    return { updated };
  }

  addManualGame(input: {
    title?: string;
    platform?: string;
    hours?: number;
    coverUrl?: string;
    beaten?: boolean;
  }): { id: number } {
    const title = (input.title ?? '').trim() || 'Untitled';
    const platform = (input.platform ?? '').trim() || 'Switch';
    const playtimeMinutes =
      typeof input.hours === 'number' && input.hours > 0 ? Math.round(input.hours * 60) : null;
    const coverUrl = (input.coverUrl ?? '').trim() || null;
    const id = this.db.addManualGame({ title, platform, playtimeMinutes, coverUrl });
    if (input.beaten) this.db.setBeaten(`manual:${id}`, true);
    return { id };
  }

  deleteManualGame(id: number): void {
    this.db.deleteManualGame(id);
    this.db.setBeaten(`manual:${id}`, false);
    this.db.setPlaying(`manual:${id}`, false);
  }

  getBacklog(): BacklogItem[] {
    return this.db.listBacklogGames().map((row) => ({
      id: row.id,
      title: row.title,
      platform: row.platform,
      coverUrl: row.cover_url ?? undefined,
      priority: row.priority,
      notes: row.notes ?? undefined,
      createdAt: row.created_at,
    }));
  }

  addBacklogGame(input: {
    title?: string;
    platform?: string;
    coverUrl?: string;
    priority?: number;
    notes?: string;
  }): { id: number } {
    const title = (input.title ?? '').trim() || 'Untitled';
    const platform = (input.platform ?? '').trim() || 'Other';
    const coverUrl = (input.coverUrl ?? '').trim() || null;
    const notes = (input.notes ?? '').trim() || null;
    const priority = clampPriority(input.priority ?? 1);
    const id = this.db.addBacklogGame({ title, platform, coverUrl, priority, notes });
    return { id };
  }

  setBacklogPriority(id: number, priority: number): void {
    this.db.setBacklogPriority(id, clampPriority(priority));
  }

  deleteBacklogGame(id: number): void {
    this.db.deleteBacklogGame(id);
  }

  /** Move a backlog item into the library as a manual game ("I started playing"). */
  startBacklogGame(id: number): { id: number } | null {
    const row = this.db.getBacklogGame(id);
    if (!row) return null;
    const manualId = this.db.addManualGame({
      title: row.title,
      platform: row.platform,
      playtimeMinutes: null,
      coverUrl: row.cover_url,
    });
    this.db.setPlaying(`manual:${manualId}`, true);
    this.db.deleteBacklogGame(id);
    return { id: manualId };
  }

  getProviderStatuses(): ProviderStatus[] {
    const snap = this.latest();
    if (snap) return snap.data.providers;
    return this.providers.map((p) => ({
      provider: p.platform,
      connected: false,
      error: 'Never synced',
    }));
  }

  /** All individual trophies stored so far, most recent first. */
  getAllTrophies(): RecentTrophy[] {
    return this.db
      .getAllStoredTrophies<RecentTrophy>()
      .map((t) => ({ ...t, provider: t.provider ?? 'psn' }))
      .filter((t) => t.earnedAt)
      .sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''));
  }

  getDashboard(): DashboardSummary {
    const snap = this.latest();
    const games = this.getGames();

    const playtimeMinutes = games.reduce((sum, g) => sum + g.totalPlaytimeMinutes, 0);
    const trophiesEarned = games.reduce(
      (sum, g) => sum + g.trophySets.reduce((s, t) => s + t.earned, 0),
      0,
    );
    const trophiesTotal = games.reduce(
      (sum, g) => sum + g.trophySets.reduce((s, t) => s + t.total, 0),
      0,
    );
    const providerStatuses = this.getProviderStatuses();
    const platinumEarned = providerStatuses.reduce((sum, p) => sum + (p.platinumEarned ?? 0), 0);
    const platinumTotal = (snap?.data.games ?? []).reduce((sum, g) => sum + g.platinum.total, 0);

    const byPlatformMap = new Map<Platform, { games: number; playtimeMinutes: number }>();
    for (const g of games) {
      for (const provider of g.providers) {
        const entry = byPlatformMap.get(provider) ?? { games: 0, playtimeMinutes: 0 };
        entry.games += 1;
        entry.playtimeMinutes += g.totalPlaytimeMinutes;
        byPlatformMap.set(provider, entry);
      }
    }

    const recentlyPlayed = games
      .filter((g) => g.lastPlayed)
      .slice()
      .sort((a, b) => (b.lastPlayed! > a.lastPlayed! ? 1 : -1))
      .slice(0, 12);
    const mostPlayed = games.slice(0, 12);

    const playingGames = games
      .filter((g) => g.playing)
      .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''));

    const beatenDates = this.db.getBeatenDates();
    const beatenAt = (g: AggregatedGame) => beatenDates.get(g.key) ?? g.lastPlayed ?? '';
    const beatenGames = games
      .filter((g) => isBeaten(g))
      .sort((a, b) => beatenAt(b).localeCompare(beatenAt(a)));
    const completedCount = games.filter((g) => isCompleted(g)).length;

    const trophiesByProvider = {
      psn: emptyProviderTrophies(),
      steam: emptyProviderTrophies(),
    };
    for (const g of games) {
      let psnHit = false;
      let steamHit = false;
      for (const set of g.trophySets) {
        const bucket = isSteamTrophySet(set.platformLabel)
          ? trophiesByProvider.steam
          : trophiesByProvider.psn;
        bucket.earned += set.earned;
        bucket.total += set.total;
        bucket.platinumEarned += set.platinumEarned;
        bucket.platinumTotal += set.platinumTotal;
        if (isSteamTrophySet(set.platformLabel)) steamHit = true;
        else psnHit = true;
      }
      if (psnHit) trophiesByProvider.psn.gamesWithTrophies += 1;
      if (steamHit) trophiesByProvider.steam.gamesWithTrophies += 1;
    }

    for (const g of beatenGames) {
      for (const prov of g.providers) {
        if (prov === 'psn') trophiesByProvider.psn.beaten += 1;
        else if (prov === 'steam') trophiesByProvider.steam.beaten += 1;
      }
    }

    // "Platinum" groups PSN platinums with Steam games completed at 100%.
    const steamCompleted = games.filter((g) => {
      const steamSets = g.trophySets.filter((s) => isSteamTrophySet(s.platformLabel));
      if (steamSets.length === 0) return false;
      const earned = steamSets.reduce((s, t) => s + t.earned, 0);
      const total = steamSets.reduce((s, t) => s + t.total, 0);
      return total > 0 && earned === total;
    }).length;
    const platinumCount = platinumEarned + steamCompleted;

    // Prefer individual platinum trophies from the incremental store (one per platinum earned,
    // with exact dates). Fall back to game-derived platinums before the first full trophy sync.
    // Resolve a trophy/platinum's game to its aggregated key. Store titles can be in a
    // different language than the game title (e.g. WUCHANG's Chinese "明末：渊虚之羽"), so we
    // also index each game's trophy-set title names, not just its own title.
    const keyByTitle = new Map<string, string>();
    for (const g of games) {
      keyByTitle.set(mergeKey(g.title), g.key);
      for (const s of g.trophySets) {
        if (s.titleName) keyByTitle.set(mergeKey(s.titleName), g.key);
      }
    }
    const resolveKey = (title: string) => keyByTitle.get(mergeKey(title)) ?? mergeKey(title);
    const gameByKey = new Map(games.map((g) => [g.key, g]));
    // Prefer the aggregated game's (English) title over the store's localized one.
    const resolveTitle = (title: string) =>
      gameByKey.get(resolveKey(title))?.title ?? cleanTitle(title);

    const storedTrophies = this.db.getAllStoredTrophies<RecentTrophy>();
    const storePlatinums = storedTrophies
      .filter((t) => t.type === 'platinum' && t.earnedAt)
      .sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''))
      .map((t) => ({
        key: resolveKey(t.gameTitle),
        title: resolveTitle(t.gameTitle),
        name: t.name,
        coverUrl: t.gameIconUrl,
        platinumIconUrl: t.iconUrl,
        earnedAt: t.earnedAt,
        rarity: t.rarity,
      }));

    const gamePlatinums = games
      .filter((g) => g.platinum.earned > 0)
      .map((g) => ({
        key: g.key,
        title: g.title,
        coverUrl: g.coverUrl,
        platinumIconUrl: g.trophySets.find((s) => s.platinumIconUrl)?.platinumIconUrl,
        when: g.trophySets.find((s) => s.platinumEarned > 0)?.lastEarnedAt ?? g.lastPlayed,
      }))
      .sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))
      .map(({ key, title, coverUrl, platinumIconUrl, when }) => ({
        key,
        title,
        coverUrl,
        platinumIconUrl,
        earnedAt: when,
      }));

    const psnPlatinums = storePlatinums.length ? storePlatinums : gamePlatinums;

    const lastSteamTrophyByKey = new Map<string, RecentTrophy>();
    for (const t of storedTrophies) {
      if ((t.provider ?? 'psn') !== 'steam' || !t.earnedAt) continue;
      const k = resolveKey(t.gameTitle);
      const cur = lastSteamTrophyByKey.get(k);
      if (!cur || (t.earnedAt ?? '') > (cur.earnedAt ?? '')) lastSteamTrophyByKey.set(k, t);
    }

    const steamPlatinums = games
      .filter((g) => {
        const sets = g.trophySets.filter((s) => isSteamTrophySet(s.platformLabel));
        if (sets.length === 0) return false;
        const e = sets.reduce((a, t) => a + t.earned, 0);
        const tot = sets.reduce((a, t) => a + t.total, 0);
        return tot > 0 && e === tot;
      })
      .map((g) => ({
        key: g.key,
        title: g.title,
        coverUrl: g.coverUrl,
        when:
          g.trophySets.find((s) => isSteamTrophySet(s.platformLabel))?.lastEarnedAt ?? g.lastPlayed,
      }))
      .sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))
      .map(({ key, title, coverUrl, when }) => {
        const last = lastSteamTrophyByKey.get(key);
        return {
          key,
          title,
          name: last?.name,
          coverUrl,
          platinumIconUrl: last?.iconUrl,
          earnedAt: when,
          rarity: last?.rarity,
        };
      });

    const recentPlatinums = { psn: psnPlatinums, steam: steamPlatinums };

    const latestTrophies = (provider: 'psn' | 'steam') =>
      storedTrophies
        .filter((t) => (t.provider ?? 'psn') === provider && t.earnedAt)
        .sort((a, b) => (b.earnedAt ?? '').localeCompare(a.earnedAt ?? ''))
        .slice(0, 5)
        .map((t) => ({ ...t, provider, gameTitle: resolveTitle(t.gameTitle) }));
    const recentTrophies = { psn: latestTrophies('psn'), steam: latestTrophies('steam') };

    const backlog = this.getBacklog();

    return {
      lastSyncAt: snap?.createdAt ?? null,
      providers: providerStatuses,
      totals: {
        games: games.length,
        playtimeMinutes,
        playtimeHours: Math.round((playtimeMinutes / 60) * 10) / 10,
        trophiesEarned,
        trophiesTotal,
        platinumEarned,
        platinumTotal,
      },
      counts: {
        beaten: beatenGames.length,
        completed: completedCount,
        platinum: platinumCount,
        playtimeHours: Math.round((playtimeMinutes / 60) * 10) / 10,
      },
      byPlatform: [...byPlatformMap.entries()].map(([provider, v]) => ({
        provider,
        games: v.games,
        playtimeMinutes: v.playtimeMinutes,
      })),
      recentlyPlayed,
      mostPlayed,
      playingGames,
      beatenGames: beatenGames.slice(0, 40),
      trophiesByProvider,
      recentPlatinums,
      recentTrophies,
      trophyProfile: snap?.data.trophyProfile ?? null,
      backlogPreview: backlog.slice(0, 8),
      backlogCount: backlog.length,
    };
  }
}
