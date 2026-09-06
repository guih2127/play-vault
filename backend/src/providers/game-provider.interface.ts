import type { Platform, ProviderResult } from '../domain/game.model.js';

export const GAME_PROVIDERS = 'GAME_PROVIDERS';

export interface ProviderCredentials {
  psnNpsso?: string;
  steamApiKey?: string;
  steamId?: string;
  /** Microsoft OAuth refresh token (decrypted) for Xbox Live. */
  xboxRefreshToken?: string;
  /** Cached Xbox user id, when known, to skip re-resolving it. */
  xboxXuid?: string;
}

export interface GameProvider {
  readonly platform: Platform;
  isConfigured(creds: ProviderCredentials): boolean;
  fetch(
    creds: ProviderCredentials,
    knownTrophyState?: Map<string, string>,
  ): Promise<ProviderResult>;
}
