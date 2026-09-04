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
  description?: string;
  rawgUrl?: string;
}

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
    if (!this.key) return { found: false, configured: false, genres: [] };

    const cached = await this.db.getMeta<GameMeta>(gameKey);
    if (cached) return { ...cached, configured: true };

    try {
      const meta = await this.fetchRawg(title);
      await this.db.setMeta(gameKey, meta);
      return { ...meta, configured: true };
    } catch (err) {
      this.logger.warn(
        `RAWG metadata failed for "${title}": ${err instanceof Error ? err.message : err}`,
      );
      return { found: false, configured: true, genres: [] };
    }
  }

  private async fetchRawg(title: string): Promise<GameMeta> {
    const search = await axios.get('https://api.rawg.io/api/games', {
      params: { key: this.key, search: title, page_size: 1, search_precise: true },
      timeout: 12000,
    });
    const hit = search.data?.results?.[0];
    if (!hit) return { found: false, configured: true, genres: [] };

    const detail = await axios.get(`https://api.rawg.io/api/games/${hit.id}`, {
      params: { key: this.key },
      timeout: 12000,
    });
    const d = detail.data ?? {};

    return {
      found: true,
      configured: true,
      publisher: d.publishers?.[0]?.name,
      developer: d.developers?.[0]?.name,
      genres: (d.genres ?? []).map((g: any) => g.name).filter(Boolean),
      released: d.released ?? undefined,
      metacritic: typeof d.metacritic === 'number' ? d.metacritic : undefined,
      description: cleanDescription(d.description_raw),
      rawgUrl: d.slug ? `https://rawg.io/games/${d.slug}` : undefined,
    };
  }
}

function cleanDescription(text?: string): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 420) return clean;
  return clean.slice(0, 420).replace(/\s+\S*$/, '') + '…';
}
