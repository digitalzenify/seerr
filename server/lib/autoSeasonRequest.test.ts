import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  nextSeasonToRequest,
  shouldRequestNextSeason,
} from '@server/lib/autoSeasonRequest';

describe('nextSeasonToRequest', () => {
  const seasons = [
    { season_number: 0, episode_count: 5 },
    { season_number: 1, episode_count: 10 },
    { season_number: 2, episode_count: 8 },
    { season_number: 3, episode_count: 0 },
    { season_number: 4, episode_count: 6 },
  ];

  it('returns the closest following season with episodes', () => {
    assert.equal(nextSeasonToRequest(seasons, 1), 2);
    assert.equal(nextSeasonToRequest(seasons, 2), 4);
  });

  it('returns the first season when evaluating specials', () => {
    assert.equal(nextSeasonToRequest(seasons, 0), 1);
  });

  it('returns null when there is nothing left to request', () => {
    assert.equal(nextSeasonToRequest(seasons, 4), null);
    assert.equal(nextSeasonToRequest([], 1), null);
  });
});

describe('shouldRequestNextSeason', () => {
  const now = 1_800_000_000_000;
  const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1000;

  it('requests when 3 or fewer episodes remain and the user watched recently', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        watchedCount: 7,
        lastWatchedAt: daysAgo(1),
        now,
      }),
      true
    );
  });

  it('requests when the user has finished the season entirely', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        watchedCount: 10,
        lastWatchedAt: daysAgo(2),
        now,
      }),
      true
    );
  });

  it('does not request when more than 3 episodes remain', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        watchedCount: 6,
        lastWatchedAt: daysAgo(1),
        now,
      }),
      false
    );
  });

  it('does not request when the user has not watched recently', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        watchedCount: 7,
        lastWatchedAt: daysAgo(15),
        now,
      }),
      false
    );
  });

  it('treats exactly 14 days ago as recent', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        watchedCount: 7,
        lastWatchedAt: daysAgo(14),
        now,
      }),
      true
    );
  });

  it('does not request without watch history or episode data', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        watchedCount: 7,
        lastWatchedAt: null,
        now,
      }),
      false
    );
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 0,
        watchedCount: 0,
        lastWatchedAt: daysAgo(1),
        now,
      }),
      false
    );
  });
});
