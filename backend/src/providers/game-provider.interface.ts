import type { Platform, ProviderResult } from '../domain/game.model.js';

export const GAME_PROVIDERS = 'GAME_PROVIDERS';

export interface ProviderCredentials {
  psnNpsso?: string;
  steamApiKey?: string;
  steamId?: string;
}

export interface GameProvider {
  readonly platform: Platform;
  isConfigured(creds: ProviderCredentials): boolean;
  fetch(
    creds: ProviderCredentials,
    knownTrophyState?: Map<string, string>,
  ): Promise<ProviderResult>;
}
