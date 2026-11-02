import PlexTvAPI from '@server/api/plextv';
import IMDBApi from '@server/api/rating/imdbapi';
import RottenTomatoes from '@server/api/rating/rottentomatoes';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb, {
  MovieSortOptionsIterable,
  TvSortOptionsIterable,
} from '@server/api/themoviedb';
import type {
  TmdbKeyword,
  TmdbMovieResult,
} from '@server/api/themoviedb/interfaces';
import type TraktAPI from '@server/api/trakt';
import { getTraktClient } from '@server/api/trakt';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import type {
  GenreSliderItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';
import cacheManager from '@server/lib/cache';
import type {
  RecommendationCandidate,
  RecommendationSeed,
} from '@server/lib/recommendationSources';
import {
  MOVIE_NEWNESS_DAYS,
  TV_NEWNESS_DAYS,
  addCandidate,
  capPerSeed,
  isWorthRecommending,
  passesNewness,
  rankCandidates,
} from '@server/lib/recommendationSources';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { mapProductionCompany } from '@server/models/Movie';
import {
  mapCollectionResult,
  mapMovieResult,
  mapPersonResult,
  mapTvResult,
} from '@server/models/Search';
import { mapNetwork } from '@server/models/Tv';
import { isCollection, isMovie, isPerson } from '@server/utils/typeHelpers';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { sortBy } from 'lodash';
import { z } from 'zod';

export const createTmdbWithRegionLanguage = (user?: User): TheMovieDb => {
  const settings = getSettings();

  const discoverRegion =
    user?.settings?.streamingRegion === 'all'
      ? ''
      : user?.settings?.streamingRegion
        ? user?.settings?.streamingRegion
        : settings.main.discoverRegion;

  const originalLanguage =
    user?.settings?.originalLanguage === 'all'
      ? ''
      : user?.settings?.originalLanguage
        ? user?.settings?.originalLanguage
        : settings.main.originalLanguage;

  return new TheMovieDb({
    discoverRegion,
    originalLanguage,
  });
};

export const createTmdbWithBlocklistSettings = (): TheMovieDb => {
  const settings = getSettings();

  return new TheMovieDb({
    discoverRegion: settings.main.blocklistRegion,
    originalLanguage: settings.main.blocklistLanguage,
  });
};

const discoverRoutes = Router();

const QueryFilterOptions = z.object({
  page: z.coerce.string().optional(),
  primaryReleaseDateGte: z.coerce.string().optional(),
  primaryReleaseDateLte: z.coerce.string().optional(),
  firstAirDateGte: z.coerce.string().optional(),
  firstAirDateLte: z.coerce.string().optional(),
  studio: z.coerce.string().optional(),
  genre: z.coerce.string().optional(),
  keywords: z.coerce.string().optional(),
  excludeKeywords: z.coerce.string().optional(),
  language: z.coerce.string().optional(),
  withRuntimeGte: z.coerce.string().optional(),
  withRuntimeLte: z.coerce.string().optional(),
  voteAverageGte: z.coerce.string().optional(),
  voteAverageLte: z.coerce.string().optional(),
  voteCountGte: z.coerce.string().optional(),
  voteCountLte: z.coerce.string().optional(),
  network: z.coerce.string().optional(),
  watchProviders: z.coerce.string().optional(),
  watchRegion: z.coerce.string().optional(),
  status: z.coerce.string().optional(),
  certification: z.coerce.string().optional(),
  certificationGte: z.coerce.string().optional(),
  certificationLte: z.coerce.string().optional(),
  certificationCountry: z.coerce.string().optional(),
  certificationMode: z.enum(['exact', 'range']).optional(),
});

export type FilterOptions = z.infer<typeof QueryFilterOptions>;
const MovieApiQuerySchema = QueryFilterOptions.omit({
  certificationMode: true,
}).extend({
  sortBy: z.enum(MovieSortOptionsIterable).optional().catch(undefined),
});
const TvApiQuerySchema = QueryFilterOptions.omit({
  certificationMode: true,
}).extend({
  sortBy: z.enum(TvSortOptionsIterable).optional().catch(undefined),
});

discoverRoutes.get('/movies', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = MovieApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;

    const data = await tmdb.getDiscoverMovies({
      page: Number(query.page),
      sortBy: query.sortBy,
      language: req.locale ?? query.language,
      originalLanguage: query.language,
      genre: query.genre,
      studio: query.studio,
      primaryReleaseDateLte: query.primaryReleaseDateLte
        ? new Date(query.primaryReleaseDateLte).toISOString().split('T')[0]
        : undefined,
      primaryReleaseDateGte: query.primaryReleaseDateGte
        ? new Date(query.primaryReleaseDateGte).toISOString().split('T')[0]
        : undefined,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: query.voteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      })),
      { includeActiveRequest: true }
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const splitKeywords = keywords.split(',');

      const keywordResults = await Promise.all(
        splitKeywords.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId: Number(keywordId) });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: data.results.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (req) =>
              req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular movies.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/movies/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        originalLanguage: req.params.language,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/movies/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const genres = await tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      const genre = genres.find(
        (genre) => genre.id === Number(req.params.genreId)
      );

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        genre: req.params.genreId as string,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId: req.params.genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by genre.',
      });
    }
  }
);

discoverRoutes.get<{ studioId: string }>(
  '/movies/studio/:studioId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const studio = await tmdb.getStudio(Number(req.params.studioId));

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        studio: req.params.studioId as string,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        studio: mapProductionCompany(studio),
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by studio', {
        label: 'API',
        errorMessage: e.message,
        studioId: req.params.studioId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by studio.',
      });
    }
  }
);

discoverRoutes.get('/movies/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const data = await tmdb.getDiscoverMovies({
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
      primaryReleaseDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      })),
      { includeActiveRequest: true }
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (med) =>
              med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming movies.',
    });
  }
});

discoverRoutes.get('/tv', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = TvApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;
    const data = await tmdb.getDiscoverTv({
      page: Number(query.page),
      sortBy: query.sortBy,
      language: req.locale ?? query.language,
      genre: query.genre,
      network: query.network ? Number(query.network) : undefined,
      firstAirDateLte: query.firstAirDateLte
        ? new Date(query.firstAirDateLte).toISOString().split('T')[0]
        : undefined,
      firstAirDateGte: query.firstAirDateGte
        ? new Date(query.firstAirDateGte).toISOString().split('T')[0]
        : undefined,
      originalLanguage: query.language,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: query.voteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      withStatus: query.status,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      })),
      { includeActiveRequest: true }
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const splitKeywords = keywords.split(',');

      const keywordResults = await Promise.all(
        splitKeywords.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId: Number(keywordId) });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: data.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular series.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/tv/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        originalLanguage: req.params.language,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/tv/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const genres = await tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      const genre = genres.find(
        (genre) => genre.id === Number(req.params.genreId)
      );

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        genre: req.params.genreId,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId: req.params.genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by genre.',
      });
    }
  }
);

discoverRoutes.get<{ networkId: string }>(
  '/tv/network/:networkId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const network = await tmdb.getNetwork(Number(req.params.networkId));

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        network: Number(req.params.networkId),
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        network: mapNetwork(network),
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by network', {
        label: 'API',
        errorMessage: e.message,
        networkId: req.params.networkId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by network.',
      });
    }
  }
);

discoverRoutes.get('/tv/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const data = await tmdb.getDiscoverTv({
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
      firstAirDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      })),
      { includeActiveRequest: true }
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming series.',
    });
  }
});

discoverRoutes.get('/trending', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const mediaType = (req.query.mediaType as 'all' | 'movie' | 'tv') ?? 'all';
    const timeWindow =
      (req.query.timeWindow as 'day' | 'week') === 'week' ? 'week' : 'day';
    const language = (req.query.language as string) ?? req.locale;
    const page = Number(req.query.page);

    const trendingFetchers = {
      movie: async () => ({
        data: await tmdb.getMovieTrending({ page, language, timeWindow }),
        mapper: mapMovieResult,
        type: MediaType.MOVIE,
      }),
      tv: async () => ({
        data: await tmdb.getTvTrending({ page, language, timeWindow }),
        mapper: mapTvResult,
        type: MediaType.TV,
      }),
      all: async () => ({
        data: await tmdb.getAllTrending({ page, language, timeWindow }),
        mapper: (result: any, media?: Media) => {
          if (isMovie(result)) {
            return mapMovieResult(result, media);
          } else if (isPerson(result)) {
            return mapPersonResult(result);
          } else if (isCollection(result)) {
            return mapCollectionResult(result);
          } else {
            return mapTvResult(result, media);
          }
        },
        type: null,
      }),
    } as const;

    const { data, mapper, type } = await trendingFetchers[mediaType]();

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: isMovie(result) ? MediaType.MOVIE : MediaType.TV,
      })),
      { includeActiveRequest: true }
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) => {
        // - If "type" is set (case: "movie" or "tv"), the mediaType must also match.
        // - If "type" is not set (case: "all"), only filter by tmdbId.
        const selectedMedia = media.find(
          (med) =>
            med.tmdbId === result.id && (type ? med.mediaType === type : true)
        );

        return mapper(result, selectedMedia);
      }),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving trending items', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve trending items.',
    });
  }
});

discoverRoutes.get<{ keywordId: string }>(
  '/keyword/:keywordId/movies',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const data = await tmdb.getMoviesByKeyword({
        keywordId: Number(req.params.keywordId),
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        })),
        { includeActiveRequest: true }
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by keyword', {
        label: 'API',
        errorMessage: e.message,
        keywordId: req.params.keywordId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by keyword.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/movie',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const mappedGenres: GenreSliderItem[] = [];

      const genres = await tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      await Promise.all(
        genres.map(async (genre) => {
          const genreData = await tmdb.getDiscoverMovies({
            genre: genre.id.toString(),
          });

          mappedGenres.push({
            id: genre.id,
            name: genre.name,
            backdrops: genreData.results
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          });
        })
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the movie genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movie genre slider.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/tv',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const mappedGenres: GenreSliderItem[] = [];

      const genres = await tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      await Promise.all(
        genres.map(async (genre) => {
          const genreData = await tmdb.getDiscoverTv({
            genre: genre.id.toString(),
          });

          mappedGenres.push({
            id: genre.id,
            name: genre.name,
            backdrops: genreData.results
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          });
        })
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the series genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series genre slider.',
      });
    }
  }
);

discoverRoutes.get<Record<string, unknown>, WatchlistResponse>(
  '/watchlist',
  async (req, res) => {
    const userRepository = getRepository(User);
    const itemsPerPage = 20;
    const page = req.query.page ? Number(req.query.page) : 1;
    const offset = (page - 1) * itemsPerPage;

    const activeUser = await userRepository.findOne({
      where: { id: req.user?.id },
      select: ['id', 'plexToken'],
    });

    if (activeUser && !activeUser?.plexToken) {
      // Non-Plex users can only see their own watchlist
      const [result, total] = await getRepository(Watchlist).findAndCount({
        where: { requestedBy: { id: activeUser?.id } },
        relations: {
          /*requestedBy: true,media:true*/
        },
        // loadRelationIds: true,
        take: itemsPerPage,
        skip: offset,
      });
      if (total) {
        return res.json({
          page: page,
          totalPages: Math.ceil(total / itemsPerPage),
          totalResults: total,
          results: result,
        });
      }
    }
    if (!activeUser?.plexToken) {
      // We will just return an empty array if the user has no Plex token
      return res.json({
        page: 1,
        totalPages: 1,
        totalResults: 0,
        results: [],
      });
    }

    // List watchlist from Plex
    const plexTV = new PlexTvAPI(activeUser.plexToken);

    const watchlist = await plexTV.getWatchlist({ offset });

    return res.json({
      page,
      totalPages: Math.ceil(watchlist.totalSize / itemsPerPage),
      totalResults: watchlist.totalSize,
      results: watchlist.items.map((item) => ({
        id: item.tmdbId,
        ratingKey: item.ratingKey,
        title: item.title,
        mediaType: item.type === 'show' ? 'tv' : 'movie',
        tmdbId: item.tmdbId,
      })),
    });
  }
);

/**
 * Helper: Get a Tautulli API client from settings, or undefined when not configured.
 */
function getTautulliClient(): TautulliAPI | undefined {
  const tautulli = getSettings().tautulli;
  if (!tautulli.hostname || !tautulli.apiKey) return undefined;
  return new TautulliAPI(tautulli);
}

interface BecauseYouWatchedCacheEntry {
  recommendations: RecommendationRowItem[];
  generatedAt: number;
}

/**
 * GET /discover/because-you-watched
 * Returns personalized recommendations based on the user's Plex watch history (via Tautulli).
 * Per-user caching with 48h TTL.
 */
discoverRoutes.get(
  '/because-you-watched',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const user = req.user;
      if (!user?.plexId) {
        // Fallback: return trending movies for users without watch history
        const tmdb = createTmdbWithRegionLanguage(user);
        const trending = await tmdb.getMovieTrending({ page: 1 });
        const media = await Media.getRelatedMedia(
          req.user,
          trending.results.map((r: TmdbMovieResult) => ({
            tmdbId: r.id,
            mediaType: MediaType.MOVIE,
          }))
        );
        return res.status(200).json({
          page: 1,
          totalPages: 1,
          totalResults: trending.results.length,
          results: trending.results.map((result: TmdbMovieResult) =>
            mapMovieResult(
              result,
              media.find(
                (m) => m.tmdbId === result.id && m.mediaType === MediaType.MOVIE
              )
            )
          ),
        });
      }

      const cache = cacheManager.getCache('because-you-watched').data;
      const cacheKey = `v2-user-${user.id}`;
      const cached = cache.get<BecauseYouWatchedCacheEntry>(cacheKey);

      const page = Number(req.query.page) || 1;
      const pageSize = 20;

      if (cached) {
        const start = (page - 1) * pageSize;
        const paged = cached.recommendations.slice(start, start + pageSize);

        const media = await Media.getRelatedMedia(
          req.user,
          paged.map((r) => ({
            tmdbId: r.id,
            mediaType: r.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
          }))
        );

        return res.status(200).json({
          page,
          totalPages: Math.ceil(cached.recommendations.length / pageSize),
          totalResults: cached.recommendations.length,
          results: paged.map((r) => {
            const mediaInfo = media.find(
              (m) =>
                m.tmdbId === r.id &&
                m.mediaType ===
                  (r.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV)
            );
            if (r.mediaType === 'movie') {
              return {
                ...r,
                mediaInfo,
              };
            }
            return {
              ...r,
              name: r.title,
              mediaInfo,
            };
          }),
        });
      }

      const items = await buildRecommendationRow({
        user,
        tautulli: getTautulliClient(),
        tmdb: createTmdbWithRegionLanguage(user),
        trakt: getTraktClient(),
        newOnly: false,
      });

      if (!items.length) {
        // Nothing personal to work with - fall back to trending movies.
        const tmdb = createTmdbWithRegionLanguage(user);
        const trending = await tmdb.getMovieTrending({ page: 1 });
        const media = await Media.getRelatedMedia(
          req.user,
          trending.results.map((r: TmdbMovieResult) => ({
            tmdbId: r.id,
            mediaType: MediaType.MOVIE,
          }))
        );

        return res.status(200).json({
          page: 1,
          totalPages: 1,
          totalResults: trending.results.length,
          results: trending.results.map((result: TmdbMovieResult) =>
            mapMovieResult(
              result,
              media.find(
                (m) => m.tmdbId === result.id && m.mediaType === MediaType.MOVIE
              )
            )
          ),
        });
      }

      cache.set<BecauseYouWatchedCacheEntry>(cacheKey, {
        recommendations: items,
        generatedAt: Date.now(),
      });

      return respondWithRow(req, res, items, page, pageSize);
    } catch (e) {
      logger.error('Failed to generate Because You Watched recommendations', {
        label: 'Discover',
        message: e.message,
      });
      next({
        status: 500,
        message: 'Failed to generate recommendations.',
      });
    }
  }
);

interface RecommendationRowItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  overview: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage: number;
  voteCount: number;
  genreIds: number[];
  originalLanguage: string;
  popularity: number;
  backdropPath?: string;
  reason?: string;
}

const MAX_SEEDS = 15;
const MIN_MOVIE_VOTES = 20;
const MIN_TV_VOTES = 10;
const NEW_FOR_YOU_MAX_ITEMS = 40;
const BECAUSE_YOU_WATCHED_MAX_ITEMS = 60;

const respondWithRow = async (
  req: Request,
  res: Response,
  items: RecommendationRowItem[],
  page: number,
  pageSize: number
) => {
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  const media = await Media.getRelatedMedia(
    req.user,
    paged.map((item) => ({
      tmdbId: item.id,
      mediaType: item.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
    }))
  );

  return res.status(200).json({
    page,
    totalPages: Math.ceil(items.length / pageSize),
    totalResults: items.length,
    results: paged.map((item) => {
      const mediaInfo = media.find(
        (m) =>
          m.tmdbId === item.id &&
          m.mediaType ===
            (item.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV)
      );

      return item.mediaType === 'movie'
        ? { ...item, mediaInfo }
        : { ...item, name: item.title, mediaInfo };
    }),
  });
};

const hydrateCandidate = async (
  candidate: RecommendationCandidate,
  tmdb: TheMovieDb
): Promise<RecommendationRowItem | null> => {
  try {
    if (candidate.mediaType === 'movie') {
      const movie = await tmdb.getMovie({ movieId: candidate.tmdbId });

      if (movie.adult) {
        return null;
      }

      return {
        id: movie.id,
        mediaType: 'movie',
        title: movie.title,
        posterPath: movie.poster_path,
        overview: movie.overview ?? '',
        releaseDate: movie.release_date,
        voteAverage: movie.vote_average,
        voteCount: movie.vote_count,
        genreIds: movie.genres.map((genre) => genre.id),
        originalLanguage: movie.original_language,
        popularity: movie.popularity,
        backdropPath: movie.backdrop_path,
        reason: candidate.reason,
      };
    }

    const show = await tmdb.getTvShow({ tvId: candidate.tmdbId });

    return {
      id: show.id,
      mediaType: 'tv',
      title: show.name,
      posterPath: show.poster_path,
      overview: show.overview ?? '',
      firstAirDate: show.first_air_date,
      voteAverage: show.vote_average,
      voteCount: show.vote_count,
      genreIds: show.genres.map((genre) => genre.id),
      originalLanguage: show.original_language,
      popularity: show.popularity,
      backdropPath: show.backdrop_path,
      reason: candidate.reason,
    };
  } catch (e) {
    logger.debug(
      `[Discover] failed to hydrate ${candidate.mediaType}/${candidate.tmdbId}`,
      { label: 'Discover', message: e.message }
    );
    return null;
  }
};

/**
 * Shared candidate pipeline for the two personal rows. Trakt, TMDB and the
 * air-date check feed one candidate list; agreement between sources ranks it.
 * `newOnly` keeps just recent releases (New For You) instead of everything
 * similar (Because You Watched).
 */
const buildRecommendationRow = async ({
  user,
  tautulli,
  tmdb,
  trakt,
  newOnly,
}: {
  user: User;
  tautulli?: TautulliAPI;
  tmdb: TheMovieDb;
  trakt?: TraktAPI;
  newOnly: boolean;
}): Promise<RecommendationRowItem[]> => {
  if (!tautulli) {
    return [];
  }

  const history = await tautulli.getUserWatchHistory(user);

  if (!history.length) {
    return [];
  }

  const seeds: RecommendationSeed[] = [];
  const seen = new Set<string>();

  for (const record of history) {
    const isMovie = record.media_type === 'movie';
    const ratingKey = String(
      isMovie ? record.rating_key : record.grandparent_rating_key
    );

    if (!ratingKey || ratingKey === 'undefined' || seen.has(ratingKey)) {
      continue;
    }

    seen.add(ratingKey);
    seeds.push({
      ratingKey,
      tmdbId: 0,
      mediaType: isMovie ? 'movie' : 'tv',
      title: isMovie ? record.title : record.grandparent_title,
      plays: record.group_count || 1,
      lastWatched: record.stopped,
    });

    if (seeds.length >= MAX_SEEDS) {
      break;
    }
  }

  // Resolve TMDB ids; a seed that cannot be matched simply drops out.
  await Promise.allSettled(
    seeds.map(async (seed) => {
      try {
        const metadata = await tautulli.getMetadata(seed.ratingKey);
        const guid = metadata.guids?.find((entry) =>
          entry.startsWith('tmdb://')
        );

        if (guid) {
          seed.tmdbId = Number(guid.replace('tmdb://', ''));
        }
      } catch {
        // ignored - the seed stays unresolved
      }
    })
  );

  const resolved = seeds.filter((seed) => seed.tmdbId > 0);

  if (!resolved.length) {
    return [];
  }

  const topSeeds = new Set(
    [...resolved]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5)
      .map((seed) => seed.ratingKey)
  );

  const candidates = new Map<string, RecommendationCandidate>();
  const now = Date.now();

  const buildFromSeed = async (seed: RecommendationSeed) => {
    const shared = {
      reason: seed.title,
      seedPlays: seed.plays,
      topSeed: topSeeds.has(seed.ratingKey),
    };
    const tasks: Promise<unknown>[] = [];

    if (trakt) {
      tasks.push(
        (async () => {
          const related = await trakt.getRelated(seed.tmdbId, seed.mediaType);

          for (const item of related) {
            if (!item.ids.tmdb) {
              continue;
            }

            addCandidate(
              candidates,
              {
                tmdbId: item.ids.tmdb,
                mediaType: seed.mediaType,
                title: item.title,
                year: item.year,
                ...shared,
              },
              { trakt: true }
            );
          }
        })()
      );
    }

    if (seed.mediaType === 'movie') {
      tasks.push(
        (async () => {
          const recs = await tmdb.getMovieRecommendations({
            movieId: seed.tmdbId,
          });

          for (const rec of recs.results.slice(0, 10)) {
            addCandidate(
              candidates,
              {
                tmdbId: rec.id,
                mediaType: 'movie',
                title: rec.title,
                releaseDate: rec.release_date,
                ...shared,
              },
              { tmdb: true }
            );
          }
        })()
      );
    } else {
      tasks.push(
        (async () => {
          const recs = await tmdb.getTvRecommendations({ tvId: seed.tmdbId });

          for (const rec of recs.results.slice(0, 10)) {
            addCandidate(
              candidates,
              {
                tmdbId: rec.id,
                mediaType: 'tv',
                title: rec.name,
                releaseDate: rec.first_air_date,
                ...shared,
              },
              { tmdb: true }
            );
          }
        })()
      );

      // A show the household watches that has aired something since the last
      // play. Catches returning seasons without trusting season numbering.
      if (newOnly) {
        tasks.push(
          (async () => {
            const show = await tmdb.getTvShow({ tvId: seed.tmdbId });
            const lastAir = show.last_air_date
              ? Date.parse(show.last_air_date) / 1000
              : 0;
            const nextAir = show.next_episode_to_air?.air_date
              ? Date.parse(show.next_episode_to_air.air_date) / 1000
              : 0;

            if (Math.max(lastAir, nextAir) > seed.lastWatched) {
              addCandidate(
                candidates,
                {
                  tmdbId: seed.tmdbId,
                  mediaType: 'tv',
                  title: show.name,
                  releaseDate: show.first_air_date,
                  ...shared,
                },
                { airDate: true }
              );
            }
          })()
        );
      }
    }

    await Promise.allSettled(tasks);
  };

  await Promise.allSettled(resolved.map(buildFromSeed));

  if (!candidates.size) {
    return [];
  }

  let ranked = rankCandidates(Array.from(candidates.values()));

  if (newOnly) {
    ranked = ranked.filter((candidate) => passesNewness(candidate, now));
  }

  ranked = capPerSeed(ranked, 2);

  const limit = newOnly ? NEW_FOR_YOU_MAX_ITEMS : BECAUSE_YOU_WATCHED_MAX_ITEMS;
  const mediaRows = await Media.getRelatedMedia(
    user,
    ranked.slice(0, limit * 2).map((candidate) => ({
      tmdbId: candidate.tmdbId,
      mediaType:
        candidate.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
    }))
  );

  const statusFor = (candidate: RecommendationCandidate) =>
    mediaRows.find(
      (row) =>
        row.tmdbId === candidate.tmdbId &&
        row.mediaType ===
          (candidate.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV)
    )?.status;

  ranked = ranked
    .filter((candidate) => {
      const status = statusFor(candidate);

      // A show the household already follows only earns a slot when it has
      // aired something since the last play - never just because Trakt or
      // TMDB proposed a title that is already sitting in the library.
      if (status === MediaStatus.PARTIALLY_AVAILABLE) {
        return candidate.fromAirDate;
      }

      return isWorthRecommending(status);
    })
    .slice(0, limit);

  const hydrated = await Promise.allSettled(
    ranked.map((candidate) => hydrateCandidate(candidate, tmdb))
  );

  const items: RecommendationRowItem[] = [];

  hydrated.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) {
      return;
    }

    const item = result.value;
    const candidate = ranked[index];
    const minVotes =
      item.mediaType === 'movie' ? MIN_MOVIE_VOTES : MIN_TV_VOTES;

    if (item.voteCount < minVotes) {
      return;
    }

    if (
      newOnly &&
      !passesNewness(
        {
          releaseDate: item.releaseDate ?? item.firstAirDate,
          year: candidate.year,
          fromAirDate: candidate.fromAirDate,
          mediaType: item.mediaType,
        },
        now
      )
    ) {
      return;
    }

    items.push(item);
  });

  return items;
};

/** Plain "new and popular" list for accounts with no watch history yet. */
const fallbackNewReleases = async (
  tmdb: TheMovieDb
): Promise<RecommendationRowItem[]> => {
  const isoDate = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  try {
    const [movies, shows] = await Promise.all([
      tmdb.getDiscoverMovies({
        sortBy: 'popularity.desc',
        primaryReleaseDateGte: isoDate(MOVIE_NEWNESS_DAYS),
        voteCountGte: String(MIN_MOVIE_VOTES),
      }),
      tmdb.getDiscoverTv({
        sortBy: 'popularity.desc',
        firstAirDateGte: isoDate(TV_NEWNESS_DAYS),
        voteCountGte: String(MIN_TV_VOTES),
      }),
    ]);

    const items: RecommendationRowItem[] = [
      ...movies.results.slice(0, 20).map((movie) => ({
        id: movie.id,
        mediaType: 'movie' as const,
        title: movie.title,
        posterPath: movie.poster_path,
        overview: movie.overview ?? '',
        releaseDate: movie.release_date,
        voteAverage: movie.vote_average,
        voteCount: movie.vote_count,
        genreIds: movie.genre_ids,
        originalLanguage: movie.original_language,
        popularity: movie.popularity,
        backdropPath: movie.backdrop_path,
      })),
      ...shows.results.slice(0, 20).map((show) => ({
        id: show.id,
        mediaType: 'tv' as const,
        title: show.name,
        posterPath: show.poster_path,
        overview: show.overview,
        firstAirDate: show.first_air_date,
        voteAverage: show.vote_average,
        voteCount: show.vote_count,
        genreIds: show.genre_ids,
        originalLanguage: show.original_language,
        popularity: show.popularity,
        backdropPath: show.backdrop_path,
      })),
    ];

    return items
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, NEW_FOR_YOU_MAX_ITEMS);
  } catch (e) {
    logger.error('Failed to build the New For You fallback list', {
      label: 'Discover',
      message: e.message,
    });
    return [];
  }
};

/**
 * GET /discover/new-for-you
 * Recent releases (and new seasons of shows the user follows) matched to the
 * account's own watch history. Per-user 48h cache, nothing is requested.
 */
discoverRoutes.get(
  '/new-for-you',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const user = req.user;
      const page = Number(req.query.page) || 1;
      const pageSize = 20;

      if (!user?.plexId) {
        const fallback = await fallbackNewReleases(
          createTmdbWithRegionLanguage(user)
        );
        return respondWithRow(req, res, fallback, page, pageSize);
      }

      const cache = cacheManager.getCache('new-for-you').data;
      const cacheKey = `v2-user-${user.id}`;
      const cached = cache.get<BecauseYouWatchedCacheEntry>(cacheKey);

      if (cached) {
        return respondWithRow(req, res, cached.recommendations, page, pageSize);
      }

      const items = await buildRecommendationRow({
        user,
        tautulli: getTautulliClient(),
        tmdb: createTmdbWithRegionLanguage(user),
        trakt: getTraktClient(),
        newOnly: true,
      });

      // A taste list can be short in a quiet week; top it up with plain new
      // releases so the row never looks broken. Personalised items stay first.
      if (items.length < 20) {
        const topUps = await fallbackNewReleases(
          createTmdbWithRegionLanguage(user)
        );
        const taken = new Set(
          items.map((item) => `${item.mediaType}:${item.id}`)
        );
        const owned = await Media.getRelatedMedia(
          user,
          topUps.map((item) => ({
            tmdbId: item.id,
            mediaType:
              item.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
          }))
        );

        for (const candidate of topUps) {
          if (items.length >= 20) {
            break;
          }

          const key = `${candidate.mediaType}:${candidate.id}`;
          const status = owned.find(
            (row) =>
              row.tmdbId === candidate.id &&
              row.mediaType ===
                (candidate.mediaType === 'movie'
                  ? MediaType.MOVIE
                  : MediaType.TV)
          )?.status;

          if (taken.has(key) || !isWorthRecommending(status)) {
            continue;
          }

          taken.add(key);
          items.push(candidate);
        }
      }

      if (!items.length) {
        const fallback = await fallbackNewReleases(
          createTmdbWithRegionLanguage(user)
        );
        return respondWithRow(req, res, fallback, page, pageSize);
      }

      cache.set<BecauseYouWatchedCacheEntry>(cacheKey, {
        recommendations: items,
        generatedAt: Date.now(),
      });

      return respondWithRow(req, res, items, page, pageSize);
    } catch (e) {
      logger.error('Failed to generate New For You recommendations', {
        label: 'Discover',
        message: e.message,
      });
      next({
        status: 500,
        message: 'Failed to generate recommendations.',
      });
    }
  }
);

/**
 * GET /discover/ratings
 * Batch-fetch IMDB ratings for a list of TMDB IDs.
 * Caches results per TMDB ID for 1 week to minimize API calls.
 * Query params: tmdbIds (comma-separated), mediaType ('movie' | 'tv')
 */
discoverRoutes.get('/ratings', async (req, res, next) => {
  try {
    const tmdbIdsParam = req.query.tmdbIds as string | undefined;
    if (!tmdbIdsParam) {
      return res.status(200).json({});
    }

    const tmdbIds = tmdbIdsParam
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => !isNaN(id) && id > 0)
      .slice(0, 20); // Limit to 20 items per request

    const mediaType = (req.query.mediaType as string) || 'movie';
    const imdbCache = cacheManager.getCache('imdb-discover').data;
    const rtCache = cacheManager.getCache('rt-discover').data;
    const tmdb = createTmdbWithRegionLanguage(req.user);
    const imdbApi = new IMDBApi();
    const rtApi = new RottenTomatoes();

    const ratings: Record<
      number,
      { imdbRating?: number; rtCriticsRating?: string; rtCriticsScore?: number }
    > = {};

    await Promise.allSettled(
      tmdbIds.map(async (tmdbId) => {
        const imdbCacheKey = `imdb-${mediaType}-${tmdbId}`;
        const rtCacheKey = `rt-${mediaType}-${tmdbId}`;
        const cachedImdb = imdbCache.get<number | null>(imdbCacheKey);
        const cachedRt = rtCache.get<{
          criticsRating: string;
          criticsScore: number;
        } | null>(rtCacheKey);

        // If both are cached, use cached values
        if (cachedImdb !== undefined && cachedRt !== undefined) {
          const entry: {
            imdbRating?: number;
            rtCriticsRating?: string;
            rtCriticsScore?: number;
          } = {};
          if (cachedImdb !== null) {
            entry.imdbRating = cachedImdb;
          }
          if (cachedRt !== null) {
            entry.rtCriticsRating = cachedRt.criticsRating;
            entry.rtCriticsScore = cachedRt.criticsScore;
          }
          if (Object.keys(entry).length > 0) {
            ratings[tmdbId] = entry;
          }
          return;
        }

        try {
          let imdbId: string | undefined;
          let title: string | undefined;
          let year: number | undefined;

          if (mediaType === 'movie') {
            const movie = await tmdb.getMovie({ movieId: tmdbId });
            imdbId = movie.imdb_id;
            title = movie.title;
            year = movie.release_date
              ? new Date(movie.release_date).getFullYear()
              : undefined;
          } else {
            const tvShow = await tmdb.getTvShow({ tvId: tmdbId });
            imdbId = tvShow.external_ids?.imdb_id;
            title = tvShow.name;
            year = tvShow.first_air_date
              ? new Date(tvShow.first_air_date).getFullYear()
              : undefined;
          }

          const entry: {
            imdbRating?: number;
            rtCriticsRating?: string;
            rtCriticsScore?: number;
          } = {};

          // Fetch IMDB rating (only if not already cached)
          if (cachedImdb === undefined) {
            try {
              if (imdbId) {
                const imdbRating = await imdbApi.getMovieRatings(imdbId);
                if (imdbRating?.criticsScore) {
                  entry.imdbRating = imdbRating.criticsScore;
                  imdbCache.set(imdbCacheKey, imdbRating.criticsScore);
                } else {
                  imdbCache.set(imdbCacheKey, null);
                }
              } else {
                imdbCache.set(imdbCacheKey, null);
              }
            } catch (e) {
              logger.debug(`Failed to fetch IMDB rating for TMDB ${tmdbId}`, {
                label: 'Discover Ratings',
                message: e.message,
              });
            }
          } else if (cachedImdb !== null) {
            entry.imdbRating = cachedImdb;
          }

          // Fetch RT rating (only if not already cached)
          if (cachedRt === undefined) {
            try {
              if (title) {
                const rtRating =
                  mediaType === 'movie'
                    ? await rtApi.getMovieRatings(title, year ?? 0)
                    : await rtApi.getTVRatings(title, year);
                if (rtRating) {
                  entry.rtCriticsRating = rtRating.criticsRating;
                  entry.rtCriticsScore = rtRating.criticsScore;
                  rtCache.set(rtCacheKey, {
                    criticsRating: rtRating.criticsRating,
                    criticsScore: rtRating.criticsScore,
                  });
                } else {
                  rtCache.set(rtCacheKey, null);
                }
              } else {
                rtCache.set(rtCacheKey, null);
              }
            } catch (e) {
              logger.debug(`Failed to fetch RT rating for TMDB ${tmdbId}`, {
                label: 'Discover Ratings',
                message: e.message,
              });
            }
          } else if (cachedRt !== null) {
            entry.rtCriticsRating = cachedRt.criticsRating;
            entry.rtCriticsScore = cachedRt.criticsScore;
          }

          if (Object.keys(entry).length > 0) {
            ratings[tmdbId] = entry;
          }
        } catch (e) {
          logger.debug(`Failed to fetch ratings for TMDB ${tmdbId}`, {
            label: 'Discover Ratings',
            message: e.message,
          });
          // Don't cache errors - allow retry on next request
        }
      })
    );

    return res.status(200).json(ratings);
  } catch (e) {
    logger.error('Failed to fetch batch ratings', {
      label: 'Discover Ratings',
      message: e.message,
    });
    next({ status: 500, message: 'Failed to fetch ratings.' });
  }
});

export default discoverRoutes;
