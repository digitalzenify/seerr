import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaStatus } from '@server/constants/media';
import type { RecommendationCandidate } from '@server/lib/recommendationSources';
import {
  MOVIE_NEWNESS_DAYS,
  addCandidate,
  capPerSeed,
  isWorthRecommending,
  passesNewness,
  rankCandidates,
} from '@server/lib/recommendationSources';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const DAY = 86400000;
const iso = (daysAgo: number) =>
  new Date(NOW - daysAgo * DAY).toISOString().split('T')[0];

const input = (
  overrides: Partial<Parameters<typeof addCandidate>[1]> = {}
) => ({
  tmdbId: 1,
  mediaType: 'movie' as const,
  title: 'Example',
  reason: 'Narcos',
  seedPlays: 1,
  topSeed: false,
  ...overrides,
});

const candidate = (
  overrides: Partial<RecommendationCandidate> = {}
): RecommendationCandidate => ({
  tmdbId: 1,
  mediaType: 'movie',
  title: 'Example',
  reason: 'Narcos',
  seedPlays: 1,
  topSeed: false,
  fromTrakt: false,
  fromTmdb: false,
  fromAirDate: false,
  score: 0,
  ...overrides,
});

describe('addCandidate', () => {
  it('accumulates sources instead of overwriting them', () => {
    const map = new Map<string, RecommendationCandidate>();

    addCandidate(map, input(), { trakt: true });
    addCandidate(map, input(), { tmdb: true });

    const merged = map.get('movie:1');

    assert.ok(merged);
    assert.equal(merged.fromTrakt, true);
    assert.equal(merged.fromTmdb, true);
    assert.equal(map.size, 1);
  });

  it('keeps the reason of the most-watched seed and the top-seed flag', () => {
    const map = new Map<string, RecommendationCandidate>();

    addCandidate(map, input({ reason: 'Small Show', seedPlays: 1 }), {
      tmdb: true,
    });
    addCandidate(
      map,
      input({ reason: 'Big Show', seedPlays: 40, topSeed: true }),
      { trakt: true }
    );

    const merged = map.get('movie:1');

    assert.equal(merged?.reason, 'Big Show');
    assert.equal(merged?.topSeed, true);
  });
});

describe('rankCandidates', () => {
  it('prefers agreed hits, then Trakt, then TMDB alone, then air dates alone', () => {
    const both = candidate({ tmdbId: 1, fromTrakt: true, fromTmdb: true });
    const traktOnly = candidate({ tmdbId: 2, fromTrakt: true });
    const tmdbOnly = candidate({ tmdbId: 3, fromTmdb: true });
    const airOnly = candidate({
      tmdbId: 4,
      fromAirDate: true,
      mediaType: 'tv',
    });

    const ranked = rankCandidates([tmdbOnly, traktOnly, airOnly, both]);

    assert.deepEqual(
      ranked.map((entry) => entry.tmdbId),
      [1, 2, 4, 3]
    );
  });

  it('breaks ties by release date, newest first', () => {
    const older = candidate({
      tmdbId: 1,
      fromTrakt: true,
      releaseDate: iso(90),
    });
    const newer = candidate({
      tmdbId: 2,
      fromTrakt: true,
      releaseDate: iso(5),
    });

    const ranked = rankCandidates([older, newer]);

    assert.deepEqual(
      ranked.map((entry) => entry.tmdbId),
      [2, 1]
    );
  });
});

describe('passesNewness', () => {
  it('accepts a movie released inside the window and rejects an older one', () => {
    assert.equal(
      passesNewness(
        { releaseDate: iso(MOVIE_NEWNESS_DAYS - 5), mediaType: 'movie' },
        NOW
      ),
      true
    );
    assert.equal(
      passesNewness(
        { releaseDate: iso(MOVIE_NEWNESS_DAYS + 5), mediaType: 'movie' },
        NOW
      ),
      false
    );
  });

  it('falls back to the year for Trakt-only results', () => {
    assert.equal(passesNewness({ year: 2026, mediaType: 'tv' }, NOW), true);
    assert.equal(passesNewness({ year: 2019, mediaType: 'tv' }, NOW), false);
    assert.equal(passesNewness({ mediaType: 'tv' }, NOW), false);
  });

  it('always keeps an item found by the air-date check', () => {
    assert.equal(
      passesNewness(
        { releaseDate: iso(2000), mediaType: 'tv', fromAirDate: true },
        NOW
      ),
      true
    );
  });
});

describe('capPerSeed', () => {
  it('keeps at most two items per source title', () => {
    const ranked = rankCandidates([
      candidate({ tmdbId: 1, reason: 'Narcos', fromTrakt: true }),
      candidate({ tmdbId: 2, reason: 'Narcos', fromTrakt: true }),
      candidate({ tmdbId: 3, reason: 'Narcos', fromTrakt: true }),
      candidate({ tmdbId: 4, reason: 'Chicago Fire', fromTrakt: true }),
    ]);

    const kept = capPerSeed(ranked, 2);

    assert.equal(kept.filter((entry) => entry.reason === 'Narcos').length, 2);
    assert.equal(kept.length, 3);
  });
});

describe('isWorthRecommending', () => {
  it('hides everything already here, downloading or asked for', () => {
    assert.equal(isWorthRecommending(MediaStatus.AVAILABLE), false);
    assert.equal(isWorthRecommending(MediaStatus.PROCESSING), false);
    assert.equal(isWorthRecommending(MediaStatus.PENDING), false);
    assert.equal(isWorthRecommending(MediaStatus.BLOCKLISTED), false);
  });

  it('keeps unknown and partially available media', () => {
    assert.equal(isWorthRecommending(undefined), true);
    assert.equal(isWorthRecommending(MediaStatus.UNKNOWN), true);
    assert.equal(isWorthRecommending(MediaStatus.PARTIALLY_AVAILABLE), true);
  });
});
