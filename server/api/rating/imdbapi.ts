import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';

interface IMDBApiResponse {
  id: string;
  type: string;
  primaryTitle: string;
  rating?: {
    aggregateRating: number;
    voteCount: number;
  };
}

export interface IMDBRating {
  title: string;
  url: string;
  criticsScore: number;
  criticsScoreCount: number;
}

/**
 * Fetches IMDB ratings from the public imdbapi.dev API.
 *
 * Usage: GET https://api.imdbapi.dev/titles/{imdbId}
 * Returns title metadata including an aggregateRating (0-10 scale).
 */
class IMDBApi extends ExternalAPI {
  constructor() {
    super(
      'https://api.imdbapi.dev',
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        nodeCache: cacheManager.getCache('imdb').data,
      }
    );
  }

  public async getMovieRatings(imdbId: string): Promise<IMDBRating | null> {
    try {
      const data = await this.get<IMDBApiResponse>(`/titles/${imdbId}`);

      if (!data?.rating?.aggregateRating) {
        return null;
      }

      return {
        title: data.primaryTitle,
        url: `https://www.imdb.com/title/${data.id}`,
        criticsScore: data.rating.aggregateRating,
        criticsScoreCount: data.rating.voteCount,
      };
    } catch (e) {
      throw new Error(
        `[IMDB API] Failed to retrieve movie ratings: ${e.message}`,
        { cause: e }
      );
    }
  }
}

export default IMDBApi;
