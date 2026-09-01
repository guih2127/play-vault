import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SearchResult {
  name: string;
  released?: string;
  backgroundImage?: string;
  platforms: string[];
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly config: ConfigService) {}

  private get rawgKey(): string | undefined {
    return this.config.get<string>('RAWG_API_KEY')?.trim() || undefined;
  }

  isConfigured(): boolean {
    return true;
  }

  async search(query: string): Promise<{ configured: boolean; results: SearchResult[] }> {
    const q = query.trim();
    if (q.length < 2) return { configured: true, results: [] };

    const [rawg, nintendo] = await Promise.allSettled([this.rawg(q), this.nintendo(q)]);
    const merged = [
      ...(rawg.status === 'fulfilled' ? rawg.value : []),
      ...(nintendo.status === 'fulfilled' ? nintendo.value : []),
    ];

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const r of merged) {
      const key = r.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(r);
      if (results.length >= 12) break;
    }
    return { configured: true, results };
  }

  /** Broad search (all platforms) for the backlog — uses RAWG. */
  async searchAll(query: string): Promise<{ configured: boolean; results: SearchResult[] }> {
    const q = query.trim();
    if (q.length < 2) return { configured: !!this.rawgKey, results: [] };
    if (!this.rawgKey) return { configured: false, results: [] };
    try {
      const { data } = await axios.get('https://api.rawg.io/api/games', {
        params: { key: this.rawgKey, search: q, page_size: 16 },
        timeout: 12000,
      });
      const results: SearchResult[] = (data?.results ?? [])
        .map((g: any) => ({
          name: String(g.name ?? '').trim(),
          released: g.released ?? undefined,
          backgroundImage: g.background_image ?? undefined,
          platforms: (g.platforms ?? [])
            .map((p: any) => p?.platform?.name)
            .filter((n: unknown): n is string => typeof n === 'string'),
        }))
        .filter((r: SearchResult) => r.name);
      return { configured: true, results: results.slice(0, 12) };
    } catch (err) {
      this.logger.warn(`Broad RAWG search failed: ${err instanceof Error ? err.message : err}`);
      return { configured: true, results: [] };
    }
  }

  private async rawg(q: string): Promise<SearchResult[]> {
    if (!this.rawgKey) return [];
    try {
      const { data } = await axios.get('https://api.rawg.io/api/games', {
        params: { key: this.rawgKey, search: q, page_size: 12 },
        timeout: 12000,
      });
      return (data?.results ?? [])
        .map((g: any) => ({
          name: String(g.name ?? '').trim(),
          released: g.released ?? undefined,
          backgroundImage: g.background_image ?? undefined,
          platforms: (g.platforms ?? [])
            .map((p: any) => p?.platform?.name)
            .filter((n: unknown): n is string => typeof n === 'string'),
        }))
        .filter((r: SearchResult) => r.name && r.platforms.some((p) => /nintendo switch/i.test(p)));
    } catch (err) {
      this.logger.warn(`RAWG search failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  private async nintendo(q: string): Promise<SearchResult[]> {
    try {
      const { data } = await axios.get('https://searching.nintendo-europe.com/en/select', {
        params: { q, fq: 'type:GAME AND system_type:nintendoswitch*', rows: 15, wt: 'json' },
        timeout: 12000,
      });
      const docs: any[] = data?.response?.docs ?? [];
      return docs
        .filter((d) => (d.system_names_txt ?? []).some((s: string) => /switch/i.test(s)))
        .map((d) => ({
          name: String(d.title ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
          released: d.dates_released_dts?.[0] ?? undefined,
          backgroundImage: d.image_url || undefined,
          platforms: (d.system_names_txt ?? []).filter((s: string) => /switch/i.test(s)),
        }))
        .filter((r) => r.name);
    } catch (err) {
      this.logger.warn(`Nintendo search failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
