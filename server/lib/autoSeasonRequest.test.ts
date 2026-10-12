import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TautulliHistoryRecord } from '@server/api/tautulli';
import {
  furthestWatchedInSeason,
  nextSeasonToRequest,
  shouldRequestNextSeason,
} from '@server/lib/autoSeasonRequest';

const play = (
  seasonNumber: number,
  episodeNumber: number,
  playedAt: number,
  overrides: Partial<TautulliHistoryRecord> = {}
): TautulliHistoryRecord =>
  ({
    parent_media_index: seasonNumber,
    media_index: episodeNumber,
    date: playedAt / 1000,
    watched_status: 1,
    percent_complete: 100,
    ...overrides,
  }) as TautulliHistoryRecord;

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

describe('furthestWatchedInSeason', () => {
  const now = 1_800_000_000_000;
  const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1000;

  it('returns the furthest watched episode of the season', () => {
    const plays = [
      play(1, 1, daysAgo(5)),
      play(1, 14, daysAgo(1)),
      play(2, 3, daysAgo(1)),
    ];
    assert.equal(furthestWatchedInSeason(plays, 1, now), 14);
  });

  it('ignores partial plays and plays from other seasons', () => {
    const plays = [
      play(1, 10, daysAgo(2), { percent_complete: 40, watched_status: 0 }),
      play(2, 20, daysAgo(1)),
    ];
    assert.equal(furthestWatchedInSeason(plays, 1, now), 0);
  });

  it('ignores plays outside the recent window (rewatch from the start)', () => {
    const plays = [play(1, 21, daysAgo(30)), play(1, 2, daysAgo(1))];
    assert.equal(furthestWatchedInSeason(plays, 1, now), 2);
  });

  it('counts plays at or above the percent threshold as watched', () => {
    const plays = [
      play(1, 7, daysAgo(1), { percent_complete: 85, watched_status: 0 }),
    ];
    assert.equal(furthestWatchedInSeason(plays, 1, now), 7);
  });
});

describe('shouldRequestNextSeason', () => {
  const now = 1_800_000_000_000;
  const daysAgo = (days: number) => now - days * 24 * 60 * 60 * 1000;

  it('requests when 3 or fewer episodes remain and the user watched recently', () => {
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 10,
        furthestWatched: 7,
        lastWatchedAt: daysAgo(1),
        now,
      }),
      true
    );
  });

  it('requests based on how far the user got, not on episodes skipped earlier', () => {
    // 17-episode season, user reached E14 while E7-E9 were watched before
    // this server existed (so they have no play history here): 3 left.
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 17,
        furthestWatched: 14,
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
        furthestWatched: 10,
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
        furthestWatched: 6,
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
        furthestWatched: 7,
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
        furthestWatched: 7,
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
        furthestWatched: 7,
        lastWatchedAt: null,
        now,
      }),
      false
    );
    assert.equal(
      shouldRequestNextSeason({
        episodeCount: 0,
        furthestWatched: 0,
        lastWatchedAt: daysAgo(1),
        now,
      }),
      false
    );
  });
});
