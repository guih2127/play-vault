import type { DlcGroup, NormalizedGame, Platform } from '../domain/game.model.js';

export interface TrophySet {
  label: string;
  platformLabel: string;
  titleName?: string;
  earned: number;
  total: number;
  progress: number;
  platinumTotal: number;
  platinumEarned: number;
  platinumIconUrl?: string;
  lastEarnedAt?: string;
  groups?: DlcGroup[];
}

export interface AggregatedGame {
  key: string;
  title: string;
  platformLabels: string[];
  providers: Platform[];
  totalPlaytimeMinutes: number;
  playtimeKnown: boolean;
  genres: string[];
  firstPlayed?: string;
  lastPlayed?: string;
  coverUrl?: string;
  trophySets: TrophySet[];
  platinum: { earned: number; total: number };
  platinumEarnedAt?: string;
  beaten?: boolean;
  playing?: boolean;
  manual?: boolean;
  rating?: number;
}

export function mergeGames(games: NormalizedGame[]): AggregatedGame[] {
  const buckets = new Map<string, NormalizedGame[]>();
  for (const game of games) {
    const key = mergeKey(game.title);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(game);
    else buckets.set(key, [game]);
  }

  const merged: AggregatedGame[] = [];
  for (const [key, sources] of buckets) merged.push(buildAggregate(key, sources));
  merged.sort((a, b) => b.totalPlaytimeMinutes - a.totalPlaytimeMinutes);
  return merged;
}

function buildAggregate(key: string, sources: NormalizedGame[]): AggregatedGame {
  const totalPlaytimeMinutes = sources.reduce((sum, g) => sum + g.playtimeMinutes, 0);
  const playtimeKnown = sources.some((g) => g.playtimeKnown);
  const providers = unique(sources.map((g) => g.provider));
  const genres = unique(sources.flatMap((g) => g.genres ?? []));
  const firstPlayed = minDate(sources.map((g) => g.firstPlayed));
  const lastPlayed = maxDate(sources.map((g) => g.lastPlayed));
  const coverUrl = sources.find((g) => g.coverUrl)?.coverUrl;
  const title = sources.slice().sort((a, b) => b.playtimeMinutes - a.playtimeMinutes)[0].title;
  const trophySets = collectTrophySets(sources, title);
  const platformLabels = derivePlatformLabels(sources, trophySets);
  const platinum = {
    earned: trophySets.reduce((sum, s) => sum + s.platinumEarned, 0),
    total: trophySets.reduce((sum, s) => sum + s.platinumTotal, 0),
  };

  return {
    key,
    title,
    platformLabels,
    providers,
    genres,
    totalPlaytimeMinutes,
    playtimeKnown,
    firstPlayed,
    lastPlayed,
    coverUrl,
    trophySets,
    platinum,
  };
}

function derivePlatformLabels(sources: NormalizedGame[], trophySets: TrophySet[]): string[] {
  const seen = new Map<string, string>();
  const add = (label: string) => {
    for (const part of label.split('/')) {
      const l = part.trim();
      if (l && l !== 'PlayStation') seen.set(l.toLowerCase(), l);
    }
  };
  for (const g of sources) add(g.platformLabel);
  for (const s of trophySets) add(s.platformLabel);
  const result = [...seen.values()];
  return result.length > 0 ? result : unique(sources.map((g) => g.platformLabel));
}

function collectTrophySets(sources: NormalizedGame[], gameTitle: string): TrophySet[] {
  const byId = new Map<string, TrophySet>();
  for (const g of sources) {
    for (const t of g.trophySets ?? []) {
      const id = t.id ?? `${t.platformLabel}:${t.titleName}`;
      const existing = byId.get(id);
      if (existing && existing.earned >= t.earned) continue;
      byId.set(id, {
        label: '',
        platformLabel: prettyPlatform(t.platformLabel ?? g.platformLabel),
        titleName: t.titleName,
        earned: t.earned,
        total: t.total,
        progress: t.progress,
        platinumTotal: t.platinumTotal,
        platinumEarned: t.platinumEarned,
        platinumIconUrl: t.platinumIconUrl,
        lastEarnedAt: t.lastEarnedAt,
        groups: t.groups,
      });
    }
  }

  const sets = [...byId.values()].sort((a, b) => b.total - a.total);
  labelSets(sets, gameTitle);
  return sets;
}

function labelSets(sets: TrophySet[], gameTitle: string): void {
  const platformCounts = new Map<string, number>();
  for (const s of sets)
    platformCounts.set(s.platformLabel, (platformCounts.get(s.platformLabel) ?? 0) + 1);

  for (const s of sets) {
    const collides = (platformCounts.get(s.platformLabel) ?? 0) > 1;
    const suffix = collides ? editionSuffix(s.titleName ?? '', gameTitle) : '';
    s.label = suffix ? `${s.platformLabel} · ${suffix}` : s.platformLabel;
  }
}

function editionSuffix(titleName: string, gameTitle: string): string {
  const stop = new Set(tokens(gameTitle).map((w) => w.toLowerCase()));
  const extra = tokens(titleName).filter((w) => !stop.has(w.toLowerCase()));
  return extra.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function tokens(s: string): string[] {
  return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function prettyPlatform(label: string): string {
  return label
    .split(',')
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p && p !== 'PSPC')
    .map((p) => (p === 'PSVITA' ? 'PS Vita' : p === 'STEAM' ? 'Steam' : p))
    .join('/');
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

export function mergeKey(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[ⅰ-ⅻ]/g, (c) => ROMAN_NUMERALS[c] ?? c)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(ps4|ps5|ps3|pc)\b/g, '')
    .replace(
      /\b(remaster(ed)?|remake|definitive|deluxe|standard|complete|goty|edition|trophies|game of the year)\b/g,
      '',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function minDate(dates: (string | undefined)[]): string | undefined {
  const valid = dates.filter((d): d is string => !!d).sort();
  return valid[0];
}

function maxDate(dates: (string | undefined)[]): string | undefined {
  const valid = dates.filter((d): d is string => !!d).sort();
  return valid[valid.length - 1];
}
