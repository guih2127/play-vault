import { Injectable, Logger } from '@nestjs/common';

/**
 * Platinum guide data (difficulty, hours, playthroughs, warnings, guide link) sourced from the
 * community dataset at github.com/langdonx/trophy-guide-list-json, which aggregates PSNProfiles →
 * PowerPyx → PlayStationTrophies → PlatGet → Knoef.
 *
 * The dataset (~3 MB across two static JSON files) is lazy-loaded into memory on first use and
 * refreshed on a long TTL — never at startup. Per-game results are cached by MetaService in the
 * `game_meta` table, so after a game is looked up once the dataset is essentially never needed again.
 */
export interface TrophyGuide {
  difficulty?: number; // 0–10, may be fractional
  playthroughs?: number;
  hours?: number;
  guideUrl?: string;
  source?: string; // 'PSNProfiles' | 'PowerPyx' | ...
  authors?: string[];
  missable: boolean;
  online: boolean;
  buggy: boolean;
}

// Attribute bit flags — see github.com/langdonx/trophy-guide-list-json/blob/master/types/attributes-v2.ts
const SOURCE_PSNP = 1 << 0;
const SOURCE_KNOEF = 1 << 1;
const SOURCE_PLATGET = 1 << 2;
const SOURCE_PLAYSTATIONTROPHIES = 1 << 3;
const SOURCE_POWERPYX = 1 << 4;
const HAS_BUGGY_TROPHIES = 1 << 13;
const HAS_MISSABLE_TROPHIES = 1 << 14;
const HAS_ONLINE_TROPHIES = 1 << 15;

const ROOT = 'https://raw.githubusercontent.com/langdonx/trophy-guide-list-json/master';
const GAMES_URL = `${ROOT}/games-v2.min.json`;
const GUIDES_URL = `${ROOT}/guides-v2.min.json`;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface GameRec {
  a: number;
  p?: string;
  r: number[]; // [difficulty, playthroughs, hours]
}

// Normalize a title for matching: lowercase, drop parentheticals/symbols/edition noise, unify roman
// numerals with arabic, collapse spaces. Applied identically to both our titles and the dataset's
// guide names, so any deterministic transform only helps. Kept in sync with the offline match test
// that measured ~86% coverage on the real library.
const EDITION =
  /\b(remaster(?:ed)?|definitive|complete|goty|game of the year|deluxe|ultimate|standard|digital|edition|bundle|hd|ps4|ps5|ps3|vita|playstation|the game)\b/g;
// Only multi-letter roman numerals — converting lone i/v/x is unsafe (e.g. "Mega Man X" ≠ "Mega Man 10").
const ROMAN: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
};
// Unicode roman-numeral glyphs (e.g. "KINGDOM HEARTS Ⅲ") → ASCII, so the map above can catch them.
const UNICODE_ROMAN: Record<string, string> = {
  'ⅰ': 'i', 'ⅱ': 'ii', 'ⅲ': 'iii', 'ⅳ': 'iv', 'ⅴ': 'v',
  'ⅵ': 'vi', 'ⅶ': 'vii', 'ⅷ': 'viii', 'ⅸ': 'ix', 'ⅹ': 'x',
};
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[ⅰ-ⅹ]/g, (c) => UNICODE_ROMAN[c] ?? c)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[™®©]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[:\-–—_'’".,!?()/\\]/g, ' ')
    .replace(EDITION, ' ')
    .replace(/\b(ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi)\b/g, (m) => ROMAN[m])
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class TrophyGuideService {
  private readonly logger = new Logger(TrophyGuideService.name);
  private games: Record<string, GameRec> | null = null;
  private nameToId: Map<string, number> | null = null;
  private authorsByGameId: Map<number, string[]> | null = null;
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  async lookup(title: string): Promise<TrophyGuide | null> {
    await this.ensureLoaded();
    if (!this.games || !this.nameToId) return null;
    const id = this.nameToId.get(norm(title));
    if (id == null) return null;
    const rec = this.games[String(id)];
    if (!rec) return null;

    const [difficulty, playthroughs, hours] = rec.r ?? [];
    const num = (n: unknown) => (typeof n === 'number' && n >= 0 ? n : undefined);
    return {
      difficulty: num(difficulty),
      playthroughs: num(playthroughs),
      hours: num(hours),
      guideUrl: this.guideUrl(rec.a, rec.p),
      source: this.source(rec.a),
      authors: this.authorsByGameId?.get(id),
      missable: !!(rec.a & HAS_MISSABLE_TROPHIES),
      online: !!(rec.a & HAS_ONLINE_TROPHIES),
      buggy: !!(rec.a & HAS_BUGGY_TROPHIES),
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.games && Date.now() - this.loadedAt < TTL_MS) return;
    if (!this.loading) this.loading = this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const [gamesRes, guidesRes] = await Promise.all([fetch(GAMES_URL), fetch(GUIDES_URL)]);
      const gamesJson = (await gamesRes.json()) as { games: Record<string, GameRec> };
      const guidesJson = (await guidesRes.json()) as Record<
        string,
        { n?: string; g?: number[]; u?: string[] }
      >;

      // Build title → gameId from guide names ("X Trophy Guide"), and gameId → authors. We keep only
      // these small indexes and the games map; the 2.4 MB guides blob is dropped after this.
      const nameToId = new Map<string, number>();
      const authorsByGameId = new Map<number, string[]>();
      for (const gid in guidesJson) {
        const g = guidesJson[gid];
        const m = g?.n?.match(/^(.*?)\s+troph(?:y|ies)\s+guide\s*$/i);
        if (!m || !g.g?.length) continue;
        const key = norm(m[1]);
        const gameId = g.g[0];
        if (key && !nameToId.has(key)) nameToId.set(key, gameId);
        if (g.u?.length && !authorsByGameId.has(gameId)) authorsByGameId.set(gameId, g.u);
      }

      this.games = gamesJson.games;
      this.nameToId = nameToId;
      this.authorsByGameId = authorsByGameId;
      this.loadedAt = Date.now();
      this.logger.log(
        `Trophy guide dataset loaded: ${Object.keys(this.games).length} games, ${nameToId.size} indexed names`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to load trophy guide dataset: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private source(a: number): string | undefined {
    if (a & SOURCE_PSNP) return 'PSNProfiles';
    if (a & SOURCE_POWERPYX) return 'PowerPyx';
    if (a & SOURCE_PLAYSTATIONTROPHIES) return 'PlayStationTrophies';
    if (a & SOURCE_PLATGET) return 'PlatGet';
    if (a & SOURCE_KNOEF) return 'Knoef';
    return undefined;
  }

  private guideUrl(a: number, p?: string): string | undefined {
    if (!p) return undefined;
    if (a & SOURCE_KNOEF) return `https://knoef.info/${p}`;
    if (a & SOURCE_PLATGET) return `https://www.platget.com/${p}`;
    if (a & SOURCE_PLAYSTATIONTROPHIES) return `https://www.playstationtrophies.org/game/${p}`;
    if (a & SOURCE_POWERPYX) return `https://powerpyx.com/${p}`;
    if (a & SOURCE_PSNP) return `https://psnprofiles.com/guide/${p}`;
    return undefined;
  }
}
