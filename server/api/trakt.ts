import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import logger from '@server/logger';

export interface TraktRelatedItem {
  title: string;
  year?: number;
  ids: {
    trakt: number;
    slug?: string;
    tvdb?: number;
    imdb?: string;
    tmdb?: number;
  };
}

export interface TraktFeedItem {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  score: number;
}

export type TraktFeedSource = 'anticipated' | 'trending' | 'popular';

interface TraktMediaSummary {
  title: string;
  ids?: { trakt?: number; tmdb?: number };
}

interface TraktFeedEntry {
  watchers?: number;
  list_count?: number;
  movie?: TraktMediaSummary;
  show?: TraktMediaSummary;
}

interface TraktSearchResult {
  type: string;
  movie?: { ids?: { trakt?: number } };
  show?: { ids?: { trakt?: number } };
}

const RELATED_TTL = 86400; // Trakt relations barely change; one day is plenty.

/**
 * Minimal Trakt client. Only public read endpoints are used, so a client id is
 * the whole authentication story - no OAuth, no user tokens.
 */
class TraktAPI extends ExternalAPI {
  constructor(clientId: string) {
    super(
      'https://api.trakt.tv',
      {},
      {
        headers: {
          'trakt-api-key': clientId,
          'trakt-api-version': '2',
        },
        nodeCache: cacheManager.getCache('trakt').data,
        timeout: 15000,
      }
    );
  }

  public async getRelated(
    tmdbId: number,
    mediaType: 'movie' | 'tv'
  ): Promise<TraktRelatedItem[]> {
    const type = mediaType === 'movie' ? 'movie' : 'show';

    try {
      const search = await this.get<TraktSearchResult[]>(
        `/search/tmdb/${tmdbId}`,
        { params: { type } },
        RELATED_TTL
      );

      const entry = search?.[0];
      const ids = entry
        ? type === 'movie'
          ? entry.movie?.ids
          : entry.show?.ids
        : undefined;

      if (!ids?.trakt) {
        return [];
      }

      const related = await this.get<TraktRelatedItem[]>(
        type === 'movie'
          ? `/movies/${ids.trakt}/related`
          : `/shows/${ids.trakt}/related`,
        undefined,
        RELATED_TTL
      );

      return Array.isArray(related) ? related : [];
    } catch (e) {
      // A missing relation or a rate limit must never break a discovery row.
      logger.debug(`[Trakt] related lookup failed for ${type}/${tmdbId}`, {
        label: 'Trakt API',
        errorMessage: e.message,
      });
      return [];
    }
  }

  private static toFeedItem(
    mediaType: 'movie' | 'tv',
    media: TraktMediaSummary | undefined,
    score = 0
  ): TraktFeedItem | undefined {
    const tmdbId = media?.ids?.tmdb;

    if (!media || !tmdbId) {
      return undefined;
    }

    return { mediaType, tmdbId, title: media.title, score };
  }

  /**
   * Global discovery feeds (no OAuth). Anticipated and trending come back typed
   * ({ movie } / { show } + a metric); /media/popular drops the wrapper, so the
   * typed per-type endpoints are used instead.
   */
  public async getMediaFeed(
    source: TraktFeedSource,
    limit = 40
  ): Promise<TraktFeedItem[]> {
    const FEED_TTL = 86400; // 24 hours; these rows are global, not per user.

    try {
      if (source === 'popular') {
        const [movies, shows] = await Promise.all([
          this.get<TraktMediaSummary[]>(
            '/movies/popular',
            { params: { limit } },
            FEED_TTL
          ),
          this.get<TraktMediaSummary[]>(
            '/shows/popular',
            { params: { limit } },
            FEED_TTL
          ),
        ]);

        return [
          ...movies.map((media) => TraktAPI.toFeedItem('movie', media)),
          ...shows.map((media) => TraktAPI.toFeedItem('tv', media)),
        ].filter((item): item is TraktFeedItem => !!item);
      }

      const entries = await this.get<TraktFeedEntry[]>(
        `/media/${source}`,
        { params: { limit } },
        FEED_TTL
      );

      if (!Array.isArray(entries)) {
        return [];
      }

      return entries
        .flatMap((entry) => [
          TraktAPI.toFeedItem(
            'movie',
            entry.movie,
            entry.watchers ?? entry.list_count ?? 0
          ),
          TraktAPI.toFeedItem(
            'tv',
            entry.show,
            entry.watchers ?? entry.list_count ?? 0
          ),
        ])
        .filter((item): item is TraktFeedItem => !!item);
    } catch (e) {
      logger.debug(`[Trakt] media feed "${source}" failed`, {
        label: 'Trakt API',
        errorMessage: e.message,
      });
      return [];
    }
  }
}

export const getTraktClient = (): TraktAPI | undefined => {
  const clientId = process.env.TRAKT_CLIENT_ID;

  return clientId ? new TraktAPI(clientId) : undefined;
};

export default TraktAPI;
