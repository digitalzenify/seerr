import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TautulliHistoryRecord } from '@server/api/tautulli';
import type { User } from '@server/entity/User';
import {
  collectWatchAggregate,
  toStatisticsResponse,
  toWrappedResponse,
} from '@server/lib/userWatchStats';

const user = { plexId: 1, displayName: 'tester' } as User;

const play = (
  isoDate: string,
  overrides: Partial<TautulliHistoryRecord> = {}
): TautulliHistoryRecord =>
  ({
    date: Math.floor(new Date(isoDate).getTime() / 1000),
    play_duration: 1800,
    media_type: 'episode',
    rating_key: 10,
    grandparent_rating_key: 1,
    grandparent_title: 'Show A',
    title: 'Episode',
    platform: 'Android',
    ...overrides,
  }) as TautulliHistoryRecord;

/** Fake Tautulli: fixed history plus metadata by rating key. */
const fakeApi = (history: TautulliHistoryRecord[], range: string[] = []) => ({
  getUserHistory: async (
    _u: User,
    opts: { after?: string; before?: string } = {}
  ) => {
    range.push(opts.after ?? 'all');
    return history;
  },
  getMetadata: async (ratingKey: string) =>
    ratingKey === '1'
      ? {
          title: 'Show A',
          year: 2007,
          genres: ['Comedy', 'Romance'],
          actors: ['Actor One', 'Actor Two'],
          directors: ['Director One'],
        }
      : {
          title: 'Film B',
          year: 1999,
          genres: ['Drama'],
          actors: ['Actor Three'],
        },
});

describe('collectWatchAggregate', () => {
  it('counts plays, watch time and per-title aggregates', async () => {
    const range: string[] = [];
    const agg = await collectWatchAggregate(
      fakeApi(
        [
          play('2026-03-01T20:00:00Z'),
          play('2026-03-01T21:00:00Z'),
          play('2026-03-02T20:00:00Z'),
          play('2026-03-05T20:00:00Z', {
            media_type: 'movie',
            rating_key: 2,
            title: 'Film B',
            play_duration: 5400,
          }),
        ],
        range
      ),
      user,
      { year: 2026 }
    );

    assert.equal(agg.plays, 4);
    assert.equal(agg.episodePlays, 3);
    assert.equal(agg.moviePlays, 1);
    assert.equal(Math.round(agg.totalMinutes), 180);
    assert.equal(agg.shows.get('Show A'), 3);
    assert.equal(agg.uniqueMovies.size, 1);
    assert.deepEqual(range, ['2026-01-01']);
    assert.equal(agg.genres.get('Comedy'), 3);
    assert.equal(agg.genres.get('Drama'), 1);
    assert.equal(agg.actors.get('Actor One'), 3);
    assert.equal(agg.decades.get('2000s'), 3);
  });

  it('finds the biggest single-day binge and the longest streak', async () => {
    const agg = await collectWatchAggregate(
      fakeApi([
        play('2026-05-01T18:00:00Z'),
        play('2026-05-01T19:00:00Z'),
        play('2026-05-01T20:00:00Z'),
        play('2026-05-02T20:00:00Z'),
        play('2026-05-03T20:00:00Z'),
        play('2026-05-09T20:00:00Z'),
      ]),
      user,
      { year: 2026 }
    );

    // Three plays on 1 May beats the single plays on the other days.
    assert.equal(agg.longestBinge?.episodes, 3);
    assert.equal(agg.longestBinge?.show, 'Show A');
    // 1-3 May is a three-day run; 9 May starts a new one.
    assert.equal(agg.longestStreak?.days, 3);
    assert.equal(agg.longestStreak?.days >= 3, true);
  });

  it('survives a user with no plays', async () => {
    const agg = await collectWatchAggregate(fakeApi([]), user, { year: 2026 });
    assert.equal(agg.plays, 0);
    const wrapped = toWrappedResponse(agg, 2026);
    assert.equal(wrapped.plays, 0);
    assert.equal(wrapped.topShow, null);
    assert.equal(toStatisticsResponse(agg, null).totalWatchTimeMinutes, 0);
  });
});

describe('toWrappedResponse', () => {
  it('reports the top show share of plays and a personality', async () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      play(`2026-06-0${(i % 9) + 1}T20:00:00Z`)
    );
    const agg = await collectWatchAggregate(fakeApi(history), user, {
      year: 2026,
    });
    const wrapped = toWrappedResponse(agg, 2026);

    assert.equal(wrapped.topShow?.episodes, 10);
    assert.equal(wrapped.topShow?.share, 100);
    assert.equal(wrapped.topShow?.ratingKey, '1');
    assert.equal(wrapped.genres[0].name, 'Comedy');
    assert.equal(wrapped.actors.length, 2);
    assert.equal(wrapped.personality.key, 'comfort-rewatcher');
  });
});

describe('toStatisticsResponse', () => {
  it('maps Tautulli aggregates onto the fields the statistics page reads', async () => {
    const agg = await collectWatchAggregate(
      fakeApi([play('2026-07-01T20:00:00Z'), play('2026-07-02T20:00:00Z')]),
      user,
      { year: 2026 }
    );
    const stats = toStatisticsResponse(agg, [
      {
        section_id: '1',
        section_name: 'Movies',
        section_type: 'movie',
        count: '100',
      },
      {
        section_id: '2',
        section_name: 'TV Shows',
        section_type: 'show',
        count: '10',
        child_count: '500',
      },
    ]);

    assert.equal(stats.totalEpisodesWatched, 2);
    assert.equal(stats.totalWatchTimeMinutes, 60);
    assert.equal(stats.mostWatchedShow?.name, 'Show A');
    assert.equal(stats.favoriteDecade, '2000s');
    assert.equal(stats.topGenres[0].name, 'Comedy');
    assert.equal(stats.libraryUtilization?.totalMovies, 100);
    assert.equal(stats.libraryUtilization?.totalEpisodes, 500);
    assert.equal(stats.libraryUtilization?.watchedShows, 1);
    assert.equal(stats.genresByMonth.length, 1);
  });
});
