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
  private readonly running = new Set<number>();

  constructor(
    @Inject(GAME_PROVIDERS) private readonly providers: GameProvider[],
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  isRunning(userId: number): boolean {
    return this.running.has(userId);
  }

  private async resolveCredentials(userId: number): Promise<ProviderCredentials> {
    const conn = await this.db.getConnections(userId);
    return {
      psnNpsso: this.safeDecrypt(conn?.psn_npsso),
      steamApiKey: this.config.get<string>('STEAM_API_KEY')?.trim() || undefined,
      steamId: conn?.steam_id ?? undefined,
    };
  }

  /**
   * Decrypt a stored secret, tolerating failure. A token encrypted with a
   * different ENCRYPTION_KEY (e.g. migrated data, or a rotated key) makes
   * AES-GCM throw; swallowing it here keeps one bad credential from failing
   * the whole sync — the provider just reports as not connected, and the user
   * can reconnect to re-encrypt with the current key.
   */
  private safeDecrypt(enc: string | null | undefined): string | undefined {
    if (!enc) return undefined;
    try {
      return this.crypto.decrypt(enc);
    } catch {
      this.logger.warn(
        'Could not decrypt a stored credential (ENCRYPTION_KEY mismatch?); treating it as not connected. Reconnect the account to fix.',
      );
      return undefined;
    }
  }

  async sync(userId: number): Promise<SyncResult> {
    if (this.running.has(userId)) throw new Error('Sync already in progress');
    this.running.add(userId);
    try {
      this.logger.log('Starting sync...');
      const creds = await this.resolveCredentials(userId);
      const known = await this.db.getTrophyTitleState(userId);
      const results = await Promise.all(this.providers.map((p) => p.fetch(creds, known)));
      const providers = results.map((r) => r.status);
      const games = mergeGames(results.flatMap((r) => r.games));
      const trophyProfile = results.find((r) => r.trophyProfile)?.trophyProfile;

      // Persist per-title trophies incrementally (only changed titles were fetched).
      let updated = 0;
      for (const r of results) {
        for (const u of r.trophyUpdates ?? []) {
          await this.db.upsertTitleTrophies(userId, u.npCommId, u.lastUpdated, u.trophies);
          updated++;
        }
      }
      if (updated) this.logger.log(`Stored trophies for ${updated} updated titles`);

      const createdAt = new Date().toISOString();
      const payload: SnapshotPayload = { providers, games, trophyProfile };
      await this.db.saveSnapshot(userId, createdAt, payload);
      this.logger.log(`Sync finished: ${games.length} games`);

      return { createdAt, providers, gameCount: games.length };
    } finally {
      this.running.delete(userId);
    }
  }
}
