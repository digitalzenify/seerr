import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TraktFeedItem } from '@server/api/trakt';
import { interleaveFeeds } from '@server/lib/traktDiscovery';

const item = (mediaType: 'movie' | 'tv', tmdbId: number): TraktFeedItem => ({
  mediaType,
  tmdbId,
  title: `title-${tmdbId}`,
  score: 0,
});

describe('interleaveFeeds', () => {
  it('alternates the two ranked feeds', () => {
    const merged = interleaveFeeds(
      [item('tv', 1), item('tv', 2)],
      [item('movie', 3), item('movie', 4)]
    );

    assert.deepEqual(
      merged.map((entry) => entry.tmdbId),
      [1, 3, 2, 4]
    );
  });

  it('drops a title that appears in both feeds', () => {
    const merged = interleaveFeeds(
      [item('tv', 1)],
      [item('tv', 1), item('movie', 2)]
    );

    assert.deepEqual(
      merged.map((entry) => entry.tmdbId),
      [1, 2]
    );
  });

  it('keeps the longer feed once the other runs out', () => {
    const merged = interleaveFeeds(
      [item('tv', 1)],
      [item('movie', 2), item('movie', 3)]
    );

    assert.deepEqual(
      merged.map((entry) => entry.tmdbId),
      [1, 2, 3]
    );
  });
});
