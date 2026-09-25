import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DatabaseService } from '../db/database.service.js';
import { TrophyGuideService, type TrophyGuide } from './trophy-guide.service.js';

export interface GameMeta {
  found: boolean;
  configured: boolean;
  publisher?: string;
  developer?: string;
  genres: string[];
  released?: string;
  metacritic?: number;
  /** RAWG user score, 0–5. */
  userScore?: number;
  ratingsCount?: number;
  /** Play modes derived from RAWG tags (e.g. "Single-player · Co-op"). */
  modes?: string;
  /** Every platform the game is available on (RAWG), not just the ones the user owns. */
  platforms: string[];
  /** A few visually-similar games from RAWG. */
  similar: { name: string; image?: string }[];
  description?: string;
  rawgUrl?: string;
  /** Platinum difficulty/hours/playthroughs + guide, from the trophy-guide dataset (PSN only). */
  guide?: TrophyGuide;
}

const EMPTY_META = (configured: boolean): GameMeta => ({
  found: false,
  configured,
  genres: [],
  platforms: [],
  similar: [],
});

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly trophyGuide: TrophyGuideService,
  ) {}

  private get key(): string | undefined {
    return this.config.get<string>('RAWG_API_KEY')?.trim() || undefined;
  }

  async getMeta(gameKey: string, title: string): Promise<GameMeta> {
    const cached = await this.db.getMeta<GameMeta>(gameKey);
    if (cached) return { ...EMPTY_META(!!this.key), ...cached, configured: !!this.key };

    // RAWG (critic scores, similar, info) and the trophy-guide dataset (platinum difficulty/guide)
    // are independent sources — fetch in parallel and let either fail without losing the other.
    const [rawg, guide] = await Promise.all([
      this.key
        ? this.fetchRawg(title).catch((err) => {
            this.logger.warn(
              `RAWG metadata failed for "${title}": ${err instanceof Error ? err.message : err}`,
            );
            return null;
          })
        : Promise.resolve(null),
      this.trophyGuide.lookup(title).catch(() => null),
    ]);

    const meta: GameMeta = { ...EMPTY_META(!!this.key), ...(rawg ?? {}), configured: !!this.key };
    if (guide) meta.guide = guide;

    // Cache only when a source actually returned data, so a transient miss can be retried later.
    if (rawg || guide) await this.db.setMeta(gameKey, meta);
    return meta;
  }

  private async fetchRawg(title: string): Promise<GameMeta> {
    const search = await axios.get('https://api.rawg.io/api/games', {
      params: { key: this.key, search: title, page_size: 1, search_precise: true },
      timeout: 12000,
    });
    const hit = search.data?.results?.[0];
    if (!hit) return EMPTY_META(true);

    const detail = await axios.get(`https://api.rawg.io/api/games/${hit.id}`, {
      params: { key: this.key },
      timeout: 12000,
    });
    const d = detail.data ?? {};

    // Similar games. RAWG's /suggested endpoint needs a paid plan, so we build the "More like this"
    // row from free endpoints, most-relevant first: the game's own series (same franchise), then the
    // most popular games sharing its top genres. We merge, dedupe and cap at 6 — ordering by
    // popularity (-added) keeps the picks recognizable instead of obscure recently-added titles.
    const similar: GameMeta['similar'] = [];
    const seen = new Set<string>([String(hit.id)]);
    const add = (arr: any[]) => {
      for (const g of arr ?? []) {
        if (similar.length >= 6) break;
        const id = String(g?.id ?? '');
        if (!g?.name || (id && seen.has(id))) continue;
        if (id) seen.add(id);
        similar.push({ name: g.name, image: g.background_image ?? undefined });
      }
    };
    const trySource = async (url: string, params: Record<string, unknown>) => {
      if (similar.length >= 6) return;
      try {
        const res = await axios.get(url, { params: { key: this.key, ...params }, timeout: 10000 });
        add(res.data?.results);
      } catch {
        /* endpoint unavailable on this plan or no results — skip */
      }
    };

    // 1) Premium suggestions (best when the plan allows it). 2) Same franchise. 3) Popular in genre.
    await trySource(`https://api.rawg.io/api/games/${hit.id}/suggested`, { page_size: 6 });
    await trySource(`https://api.rawg.io/api/games/${hit.id}/game-series`, { page_size: 6 });
    const genres = (d.genres ?? [])
      .slice(0, 2)
      .map((g: any) => g?.slug)
      .filter(Boolean)
      .join(',');
    if (genres) {
      await trySource('https://api.rawg.io/api/games', {
        genres,
        ordering: '-added',
        page_size: 12,
      });
    }

    return {
      found: true,
      configured: true,
      publisher: d.publishers?.[0]?.name,
      developer: d.developers?.[0]?.name,
      genres: (d.genres ?? []).map((g: any) => g.name).filter(Boolean),
      released: d.released ?? undefined,
      metacritic: typeof d.metacritic === 'number' ? d.metacritic : undefined,
      userScore: typeof d.rating === 'number' && d.rating > 0 ? d.rating : undefined,
      ratingsCount: typeof d.ratings_count === 'number' ? d.ratings_count : undefined,
      modes: deriveModes(d.tags),
      platforms: (d.platforms ?? [])
        .map((p: any) => p.platform?.name)
        .filter((n: unknown): n is string => typeof n === 'string'),
      similar,
      description: cleanDescription(d.description_raw),
      rawgUrl: d.slug ? `https://rawg.io/games/${d.slug}` : undefined,
    };
  }
}

/** Turn RAWG tags into a short play-modes label (e.g. "Single-player · Co-op"). */
function deriveModes(tags?: Array<{ slug?: string }>): string | undefined {
  if (!tags) return undefined;
  const slugs = new Set(tags.map((t) => t.slug));
  const modes: string[] = [];
  if (slugs.has('singleplayer')) modes.push('Single-player');
  if (slugs.has('multiplayer')) modes.push('Multiplayer');
  if (slugs.has('co-op') || slugs.has('cooperative')) modes.push('Co-op');
  return modes.length ? modes.join(' · ') : undefined;
}

function cleanDescription(text?: string): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 420) return clean;
  return clean.slice(0, 420).replace(/\s+\S*$/, '') + '…';
}
