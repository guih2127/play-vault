import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GAME_PROVIDERS } from '../providers/game-provider.interface.js';
import type { GameProvider, ProviderCredentials } from '../providers/game-provider.interface.js';
import type { ProviderStatus } from '../domain/game.model.js';
import { DatabaseService } from '../db/database.service.js';
import { CryptoService } from '../auth/crypto.service.js';
import { mergeGames } from '../games/aggregation.js';
import type { SnapshotPayload } from '../games/snapshot.js';

export interface SyncResult {
  createdAt: string;
  providers: ProviderStatus[];
  gameCount: number;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private running = false;

  constructor(
    @Inject(GAME_PROVIDERS) private readonly providers: GameProvider[],
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  private resolveCredentials(userId: number): ProviderCredentials {
    const conn = this.db.getConnections(userId);
    return {
      psnNpsso: conn?.psn_npsso ? this.crypto.decrypt(conn.psn_npsso) : undefined,
      steamApiKey: this.config.get<string>('STEAM_API_KEY')?.trim() || undefined,
      steamId: conn?.steam_id ?? undefined,
    };
  }

  async sync(userId: number): Promise<SyncResult> {
    if (this.running) throw new Error('Sync already in progress');
    this.running = true;
    try {
      this.logger.log('Starting sync...');
      const creds = this.resolveCredentials(userId);
      const known = this.db.getTrophyTitleState();
      const results = await Promise.all(this.providers.map((p) => p.fetch(creds, known)));
      const providers = results.map((r) => r.status);
      const games = mergeGames(results.flatMap((r) => r.games));
      const trophyProfile = results.find((r) => r.trophyProfile)?.trophyProfile;

      // Persist per-title trophies incrementally (only changed titles were fetched).
      let updated = 0;
      for (const r of results) {
        for (const u of r.trophyUpdates ?? []) {
          this.db.upsertTitleTrophies(u.npCommId, u.lastUpdated, u.trophies);
          updated++;
        }
      }
      if (updated) this.logger.log(`Stored trophies for ${updated} updated titles`);

      const createdAt = new Date().toISOString();
      const payload: SnapshotPayload = { providers, games, trophyProfile };
      this.db.saveSnapshot(createdAt, payload);
      this.logger.log(`Sync finished: ${games.length} games`);

      return { createdAt, providers, gameCount: games.length };
    } finally {
      this.running = false;
    }
  }
}
