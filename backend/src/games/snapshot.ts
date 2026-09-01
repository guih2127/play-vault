import type { ProviderStatus, TrophyProfile } from '../domain/game.model.js';
import type { AggregatedGame } from './aggregation.js';

export interface SnapshotPayload {
  providers: ProviderStatus[];
  games: AggregatedGame[];
  trophyProfile?: TrophyProfile;
}
