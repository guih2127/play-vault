export type Platform = 'psn' | 'steam' | 'switch' | 'xbox'

export interface User {
  id: number
  email: string | null
  name: string | null
  picture: string | null
}

export interface ProviderStatus {
  provider: Platform
  connected: boolean
  accountName?: string
  error?: string
  gameCount?: number
}

export interface DlcGroup {
  id: string
  name: string
  isBase: boolean
  earned: number
  total: number
  platinumTotal: number
  platinumEarned: number
}

export interface TrophySet {
  label: string
  platformLabel: string
  titleName?: string
  earned: number
  total: number
  progress: number
  platinumTotal: number
  platinumEarned: number
  platinumIconUrl?: string
  groups?: DlcGroup[]
}

export interface AggregatedGame {
  key: string
  title: string
  platformLabels: string[]
  providers: Platform[]
  totalPlaytimeMinutes: number
  playtimeKnown: boolean
  genres: string[]
  firstPlayed?: string
  lastPlayed?: string
  coverUrl?: string
  trophySets: TrophySet[]
  platinum: { earned: number; total: number }
  platinumEarnedAt?: string
  beaten?: boolean
  playing?: boolean
  manual?: boolean
  rating?: number
}

export interface BacklogItem {
  id: number
  title: string
  platform: string
  coverUrl?: string
  priority: number
  notes?: string
  createdAt: string
}

export interface ProviderTrophies {
  earned: number
  total: number
  platinumEarned: number
  platinumTotal: number
  gamesWithTrophies: number
  beaten: number
}

export interface TrophyProfile {
  level: number
  tier: number
  progress: number
  counts: { bronze: number; silver: number; gold: number; platinum: number }
}

export interface RecentCompletion {
  key: string
  title: string
  name?: string
  coverUrl?: string
  platinumIconUrl?: string
  earnedAt?: string
  rarity?: number
}

export interface RecentTrophy {
  provider: 'psn' | 'steam' | 'xbox'
  gameTitle: string
  gameIconUrl?: string
  name: string
  detail?: string
  iconUrl?: string
  type?: 'bronze' | 'silver' | 'gold' | 'platinum'
  earnedAt?: string
  rarity?: number
}

export interface Dashboard {
  lastSyncAt: string | null
  providers: ProviderStatus[]
  totals: {
    games: number
    playtimeMinutes: number
    playtimeHours: number
    trophiesEarned: number
    trophiesTotal: number
    platinumEarned: number
    platinumTotal: number
  }
  counts: {
    beaten: number
    completed: number
    platinum: number
    playtimeHours: number
  }
  byPlatform: Array<{ provider: Platform; games: number; playtimeMinutes: number }>
  recentlyPlayed: AggregatedGame[]
  mostPlayed: AggregatedGame[]
  playingGames: AggregatedGame[]
  beatenGames: AggregatedGame[]
  trophiesByProvider: { psn: ProviderTrophies; steam: ProviderTrophies; xbox: ProviderTrophies }
  recentPlatinums: {
    psn: RecentCompletion[]
    steam: RecentCompletion[]
    xbox: RecentCompletion[]
  }
  recentTrophies: { psn: RecentTrophy[]; steam: RecentTrophy[]; xbox: RecentTrophy[] }
  trophyProfile: TrophyProfile | null
  backlogPreview: BacklogItem[]
  backlogCount: number
}
