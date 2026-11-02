import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbMovieResult,
  TmdbTvDetails,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import type { TraktFeedItem } from '@server/api/trakt';
import { getTraktClient } from '@server/api/trakt';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';
import {
  mapMovieDetailsToResult,
  mapTvDetailsToResult,
} from '@server/models/Search';

export type TraktRowSource = 'anticipated' | 'trending';

/** Global rows, so a day is plenty; Trakt itself also caches the raw feeds. */
const ROW_TTL = 86400;
const ROW_SIZE = 40;

/**
 * Alternates two ranked feeds so a row mixes "hot right now" with "broadly
 * popular" instead of one list burying the other. Deduped by type + TMDB id.
 */
export const interleaveFeeds = (
  first: TraktFeedItem[],
  second: TraktFeedItem[]
): TraktFeedItem[] => {
  const seen = new Set<string>();
  const merged: TraktFeedItem[] = [];

  for (let i = 0; i < Math.max(first.length, second.length); i++) {
    for (const item of [first[i], second[i]]) {
      if (!item) {
        continue;
      }

      const key = `${item.mediaType}:${item.tmdbId}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
};

const getRowFeed = async (source: TraktRowSource): Promise<TraktFeedItem[]> => {
  const trakt = getTraktClient();

  if (!trakt) {
    return [];
  }

  if (source === 'anticipated') {
    return trakt.getMediaFeed('anticipated', ROW_SIZE);
  }

  const [trending, popular] = await Promise.all([
    trakt.getMediaFeed('trending', ROW_SIZE),
    trakt.getMediaFeed('popular', ROW_SIZE),
  ]);

  return interleaveFeeds(trending, popular);
};

/**
 * Trakt picks and orders the titles, TMDB only supplies the artwork/details
 * Seerr needs (Seerr is keyed by TMDB ids everywhere).
 */
export const getTraktRow = async (
  source: TraktRowSource
): Promise<(TmdbMovieResult | TmdbTvResult)[]> => {
  const cache = cacheManager.getCache('trakt-discover').data;
  const cacheKey = `row:${source}`;
  const cached = cache.get<(TmdbMovieResult | TmdbTvResult)[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const feed = await getRowFeed(source);

  if (feed.length === 0) {
    return [];
  }

  const tmdb = new TheMovieDb();

  const hydrated = await Promise.all(
    feed.map(async (item) => {
      try {
        if (item.mediaType === 'movie') {
          return mapMovieDetailsToResult(
            (await tmdb.getMovie({ movieId: item.tmdbId })) as TmdbMovieDetails
          );
        }

        return mapTvDetailsToResult(
          (await tmdb.getTvShow({ tvId: item.tmdbId })) as TmdbTvDetails
        );
      } catch (e) {
        logger.debug(
          `[Trakt] could not hydrate ${item.mediaType}/${item.tmdbId}`,
          { label: 'Trakt Discovery', errorMessage: e.message }
        );
        return null;
      }
    })
  );

  const results = hydrated
    .filter((item): item is TmdbMovieResult | TmdbTvResult => !!item)
    .slice(0, ROW_SIZE);

  if (results.length > 0) {
    cache.set(cacheKey, results, ROW_TTL);
  }

  return results;
};
