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
}

export const getTraktClient = (): TraktAPI | undefined => {
  const clientId = process.env.TRAKT_CLIENT_ID;

  return clientId ? new TraktAPI(clientId) : undefined;
};

export default TraktAPI;
