import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GAME_PROVIDERS } from '../providers/game-provider.interface.js';
import type { GameProvider, ProviderCredentials } from '../providers/game-provider.interface.js';
import type { Platform, ProviderStatus } from '../domain/game.model.js';
import { DatabaseService } from '../db/database.service.js';
import { CryptoService } from '../auth/crypto.service.js';
import { mergeGames, mergeKey } from '../games/aggregation.js';
import type { AggregatedGame } from '../games/aggregation.js';
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
      const prev = await this.db.getLatestSnapshot<SnapshotPayload>(userId);
      const results = await Promise.all(this.providers.map((p) => p.fetch(creds, known)));

      // A configured provider that reports an error failed mid-sync (e.g. a PSN outage) — as
      // opposed to one that's simply not connected. Its result comes back empty, which would
      // otherwise wipe every previously-synced game/trophy for that provider from the snapshot.
      // Detect these so we can preserve the last good data below instead of dropping it.
      const failed = new Set<Platform>();
      const providers = results.map((r, i) => {
        const status = r.status;
        if (status.error && this.providers[i].isConfigured(creds)) {
          failed.add(status.provider);
          const last = prev?.data.providers.find((p) => p.provider === status.provider);
          // Keep last-known counts (games, platinums) so totals stay stable, but surface the error.
          if (last) return { ...last, error: status.error };
        }
        return status;
      });

      let games = mergeGames(results.flatMap((r) => r.games));
      if (failed.size && prev) {
        // Re-attach the failed providers' previously-synced games (that aren't already present
        // from a provider that did succeed), then re-sort by playtime like mergeGames does.
        const freshKeys = new Set(games.map((g) => g.key));
        const preserved = prev.data.games.filter(
          (g) => !freshKeys.has(g.key) && g.providers.some((p) => failed.has(p)),
        );
        if (preserved.length) {
          games = [...games, ...preserved].sort(
            (a, b) => b.totalPlaytimeMinutes - a.totalPlaytimeMinutes,
          );
          this.logger.warn(
            `Preserved ${preserved.length} games from failed provider(s): ${[...failed].join(', ')}`,
          );
        }
      }

      // The trophy profile only comes from PSN today; if PSN failed, keep the previous one.
      const trophyProfile =
        results.find((r) => r.trophyProfile)?.trophyProfile ??
        (failed.size ? prev?.data.trophyProfile : undefined);

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

      await this.reconcileWithLibrary(userId, games);

      return { createdAt, providers, gameCount: games.length };
    } finally {
      this.running.delete(userId);
    }
  }

  /**
   * A manually-added game can later show up in a provider sync with real playtime and trophies.
   * When that happens we fold the manual entry into the synced game so its hours/trophies take
   * over: the manual game hands its playing/beaten flags to the synced game and the manual
   * duplicate is deleted (the synced playtime replaces the hand-entered hours).
   *
   * Backlog entries are intentionally left alone — a synced game keeps its own hours/trophies in
   * the library, but a backlog item stays in the backlog and is never auto-moved to "playing".
   *
   * Matching is by normalized title (the same key aggregation uses), so e.g. a manually-added
   * "Elden Ring" reconciles with the synced PSN/Steam copy.
   */
  private async reconcileWithLibrary(userId: number, games: AggregatedGame[]): Promise<void> {
    const syncedKeys = new Set(games.map((g) => g.key));
    if (syncedKeys.size === 0) return;

    const playing = await this.db.getPlayingKeys(userId);
    const beaten = await this.db.getBeatenKeys(userId);
    for (const m of await this.db.listManualGames(userId)) {
      const key = mergeKey(m.title);
      if (!syncedKeys.has(key)) continue;
      const manualKey = `manual:${m.id}`;
      if (playing.has(manualKey)) await this.db.setPlaying(userId, key, true);
      if (beaten.has(manualKey)) await this.db.setBeaten(userId, key, true);
      await this.db.deleteManualGame(userId, m.id);
      await this.db.setPlaying(userId, manualKey, false);
      await this.db.setBeaten(userId, manualKey, false);
      this.logger.log(`Reconciled manual game "${m.title}" into its synced copy`);
    }
  }
}
