export type Platform = 'psn' | 'steam' | 'switch';

export interface DlcGroup {
  id: string;
  name: string;
  isBase: boolean;
  earned: number;
  total: number;
  platinumTotal: number;
  platinumEarned: number;
}

export interface NormalizedTrophies {
  id?: string;
  titleName?: string;
  platformLabel?: string;
  earned: number;
  total: number;
  progress: number;
  platinumTotal: number;
  platinumEarned: number;
  platinumIconUrl?: string;
  /** When the most recent trophy for this title was earned (≈ platinum date for 100% titles). */
  lastEarnedAt?: string;
  groups?: DlcGroup[];
}

export interface NormalizedGame {
  provider: Platform;
  externalId: string;
  title: string;
  platformLabel: string;
  iconUrl?: string;
  coverUrl?: string;
  playtimeMinutes: number;
  playtimeKnown: boolean;
  genres?: string[];
  firstPlayed?: string;
  lastPlayed?: string;
  playCount?: number;
  trophySets?: NormalizedTrophies[];
}

export interface ProviderStatus {
  provider: Platform;
  connected: boolean;
  accountName?: string;
  error?: string;
  gameCount?: number;
  platinumEarned?: number;
}

export interface TrophyCounts {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
}

export interface TrophyProfile {
  level: number;
  tier: number;
  progress: number;
  counts: TrophyCounts;
}

export interface RecentTrophy {
  provider: 'psn' | 'steam';
  gameTitle: string;
  gameIconUrl?: string;
  name: string;
  detail?: string;
  iconUrl?: string;
  /** PSN trophy grade. Undefined for Steam achievements (which have no grade). */
  type?: 'bronze' | 'silver' | 'gold' | 'platinum';
  earnedAt?: string;
  /** Percentage of players who earned this trophy/achievement (lower = rarer). */
  rarity?: number;
}

export interface TrophyUpdate {
  npCommId: string;
  lastUpdated?: string;
  trophies: RecentTrophy[];
}

export interface ProviderResult {
  status: ProviderStatus;
  games: NormalizedGame[];
  trophyProfile?: TrophyProfile;
  /** Per-title trophy lists for titles that changed since the last sync (for incremental storage). */
  trophyUpdates?: TrophyUpdate[];
}
