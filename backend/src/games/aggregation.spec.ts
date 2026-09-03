import { mergeGames, mergeKey } from './aggregation.js';
import type { NormalizedGame } from '../domain/game.model.js';

function normalized(over: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    provider: 'steam',
    externalId: '1',
    title: 'Game',
    platformLabel: 'Steam',
    playtimeMinutes: 0,
    playtimeKnown: true,
    ...over,
  };
}

describe('mergeKey', () => {
  it('is case-insensitive', () => {
    expect(mergeKey('Elden Ring')).toBe(mergeKey('ELDEN RING'));
  });

  it('strips edition/remaster words', () => {
    expect(mergeKey('Hades: Definitive Edition')).toBe('hades');
    expect(mergeKey('The Last of Us Part II Remastered')).toBe(
      mergeKey('The Last of Us Part II'),
    );
  });

  it('strips platform tags and parentheticals', () => {
    expect(mergeKey('God of War (PS4)')).toBe('god of war');
    expect(mergeKey('Cyberpunk 2077 PC')).toBe(mergeKey('Cyberpunk 2077'));
  });

  it('normalizes unicode roman numerals', () => {
    expect(mergeKey('Final Fantasy Ⅶ')).toBe('final fantasy vii');
  });
});

describe('mergeGames', () => {
  it('merges the same title across providers and sorts by playtime', () => {
    const celesteSteam = normalized({
      provider: 'steam',
      title: 'Celeste',
      platformLabel: 'Steam',
      playtimeMinutes: 100,
      genres: ['Platformer'],
      lastPlayed: '2024-01-02',
    });
    const celestePsn = normalized({
      provider: 'psn',
      title: 'Celeste',
      platformLabel: 'PS5',
      playtimeMinutes: 50,
      genres: ['Indie'],
      lastPlayed: '2024-03-01',
    });
    const hades = normalized({ title: 'Hades', playtimeMinutes: 500 });

    const merged = mergeGames([celesteSteam, celestePsn, hades]);

    expect(merged).toHaveLength(2);
    // Sorted by total playtime, descending.
    expect(merged[0].title).toBe('Hades');

    const celeste = merged.find((g) => g.key === mergeKey('Celeste'))!;
    expect(celeste.totalPlaytimeMinutes).toBe(150);
    expect(celeste.providers.sort()).toEqual(['psn', 'steam']);
    expect(celeste.genres.sort()).toEqual(['Indie', 'Platformer']);
    expect(celeste.lastPlayed).toBe('2024-03-01');
  });

  it('collects trophy sets from every source and keeps the higher earned count', () => {
    const a = normalized({
      title: 'Solo',
      trophySets: [
        { id: 'dup', platformLabel: 'PS5', earned: 3, total: 10, progress: 30, platinumTotal: 1, platinumEarned: 0 },
      ],
    });
    const b = normalized({
      provider: 'psn',
      title: 'Solo',
      trophySets: [
        { id: 'dup', platformLabel: 'PS5', earned: 7, total: 10, progress: 70, platinumTotal: 1, platinumEarned: 0 },
        { id: 'other', platformLabel: 'Steam', earned: 1, total: 5, progress: 20, platinumTotal: 0, platinumEarned: 0 },
      ],
    });

    const merged = mergeGames([a, b]);
    expect(merged).toHaveLength(1);
    const sets = merged[0].trophySets;
    expect(sets).toHaveLength(2);
    expect(sets.find((s) => s.earned === 7)).toBeTruthy();
    // The lower-earned duplicate was discarded.
    expect(sets.find((s) => s.earned === 3)).toBeUndefined();
  });
});
