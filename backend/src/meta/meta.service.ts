import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DatabaseService } from '../db/database.service.js';

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
  ) {}

  private get key(): string | undefined {
    return this.config.get<string>('RAWG_API_KEY')?.trim() || undefined;
  }

  async getMeta(gameKey: string, title: string): Promise<GameMeta> {
    if (!this.key) return EMPTY_META(false);

    const cached = await this.db.getMeta<GameMeta>(gameKey);
    if (cached) return { ...EMPTY_META(true), ...cached, configured: true };

    try {
      const meta = await this.fetchRawg(title);
      await this.db.setMeta(gameKey, meta);
      return { ...meta, configured: true };
    } catch (err) {
      this.logger.warn(
        `RAWG metadata failed for "${title}": ${err instanceof Error ? err.message : err}`,
      );
      return EMPTY_META(true);
    }
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

    // Similar games — RAWG's /suggested endpoint needs a paid plan, so it fails soft and we fall
    // back to top games in the same genre (free) so the "More like this" row still has content.
    const toSimilar = (arr: any[]): GameMeta['similar'] =>
      (arr ?? [])
        .filter((g) => g?.id !== hit.id && g?.name)
        .slice(0, 6)
        .map((g: any) => ({ name: g.name, image: g.background_image ?? undefined }));
    let similar: GameMeta['similar'] = [];
    try {
      const sug = await axios.get(`https://api.rawg.io/api/games/${hit.id}/suggested`, {
        params: { key: this.key, page_size: 6 },
        timeout: 10000,
      });
      similar = toSimilar(sug.data?.results);
    } catch {
      /* suggested endpoint not available on this plan — fall through to the genre fallback */
    }
    if (!similar.length && d.genres?.[0]?.slug) {
      try {
        const byGenre = await axios.get('https://api.rawg.io/api/games', {
          params: { key: this.key, genres: d.genres[0].slug, ordering: '-added', page_size: 8 },
          timeout: 10000,
        });
        similar = toSimilar(byGenre.data?.results);
      } catch {
        /* leave empty */
      }
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
