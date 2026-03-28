import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import IMDBRadarrProxy from '@server/api/rating/imdbRadarrProxy';
import RottenTomatoes from '@server/api/rating/rottentomatoes';
import type { SortOptions } from '@server/api/themoviedb';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbKeyword,
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import cacheManager from '@server/lib/cache';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Watchlist } from '@server/entity/Watchlist';
import type {
  GenreSliderItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';
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

const discoverRoutes = Router();

const QueryFilterOptions = z.object({
  page: z.coerce.string().optional(),
  sortBy: z.coerce.string().optional(),
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
const ApiQuerySchema = QueryFilterOptions.omit({
  certificationMode: true,
});

discoverRoutes.get('/movies', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = ApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;

    const data = await tmdb.getDiscoverMovies({
      page: Number(query.page),
      sortBy: query.sortBy as SortOptions,
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
      }))
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
        }))
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
        }))
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
        }))
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
      }))
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
    const query = ApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;
    const data = await tmdb.getDiscoverTv({
      page: Number(query.page),
      sortBy: query.sortBy as SortOptions,
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
      }))
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
        }))
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
        }))
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
        }))
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
      }))
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
      }))
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
        }))
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
 * Helper: Get a Jellyfin API client authenticated as the admin user.
 */
function getJellyfinClient(): JellyfinAPI | undefined {
  const settings = getSettings();
  const jf = settings.jellyfin;
  if (!jf.ip || !jf.apiKey) return undefined;
  const protocol = jf.useSsl ? 'https' : 'http';
  const urlBase = jf.urlBase ? `/${jf.urlBase.replace(/^\//, '')}` : '';
  const baseUrl = `${protocol}://${jf.ip}:${jf.port}${urlBase}`;
  return new JellyfinAPI(baseUrl, jf.apiKey);
}

interface BecauseYouWatchedCacheEntry {
  recommendations: Array<{
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
  }>;
  generatedAt: number;
}

/**
 * GET /discover/because-you-watched
 * Returns personalized recommendations based on the user's Jellyfin watch history.
 * Per-user caching with 48h TTL.
 */
discoverRoutes.get(
  '/because-you-watched',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const user = req.user;
      if (!user?.jellyfinUserId) {
        // Fallback: return trending movies for users without Jellyfin history
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
                (m) =>
                  m.tmdbId === result.id &&
                  m.mediaType === MediaType.MOVIE
              )
            )
          ),
        });
      }

      const cache = cacheManager.getCache('because-you-watched').data;
      const cacheKey = `user-${user.id}`;
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
            mediaType:
              r.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
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
                  (r.mediaType === 'movie'
                    ? MediaType.MOVIE
                    : MediaType.TV)
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

      // Fetch watch history from Jellyfin
      const jf = getJellyfinClient();
      if (!jf) {
        return res.status(200).json({
          page: 1,
          totalPages: 0,
          totalResults: 0,
          results: [],
        });
      }

      jf.setUserId(user.jellyfinUserId);
      const recentlyPlayed = await jf.getRecentlyPlayed(15);

      if (!recentlyPlayed.length) {
        // No watch history - return trending movies as fallback
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
                (m) =>
                  m.tmdbId === result.id &&
                  m.mediaType === MediaType.MOVIE
              )
            )
          ),
        });
      }

      // Map Jellyfin items to TMDB IDs, dedup series by SeriesId
      const seenSeries = new Set<string>();
      const watchedTmdbItems: Array<{
        tmdbId: number;
        type: 'movie' | 'tv';
      }> = [];

      for (const item of recentlyPlayed) {
        if (item.Type === 'Episode') {
          // For episodes, use the series TMDB ID
          const seriesId = item.SeriesId;
          if (seriesId && !seenSeries.has(seriesId)) {
            seenSeries.add(seriesId);
            // Need to fetch the series to get TMDB provider ID
            const tmdbId = item.ProviderIds?.Tmdb || item.ProviderIds?.TheMovieDb;
            if (tmdbId) {
              watchedTmdbItems.push({
                tmdbId: Number(tmdbId),
                type: 'tv',
              });
            } else if (seriesId) {
              // Try to get the series data to find TMDB ID
              try {
                const seriesData = await jf.getItemData(seriesId);
                const seriesTmdbId =
                  seriesData?.ProviderIds?.Tmdb ??
                  seriesData?.ProviderIds?.TheMovieDb;
                if (seriesTmdbId) {
                  watchedTmdbItems.push({
                    tmdbId: Number(seriesTmdbId),
                    type: 'tv',
                  });
                }
              } catch {
                // Skip if can't fetch series data
              }
            }
          }
        } else if (item.Type === 'Movie') {
          const tmdbId =
            item.ProviderIds?.Tmdb || item.ProviderIds?.TheMovieDb;
          if (tmdbId) {
            watchedTmdbItems.push({
              tmdbId: Number(tmdbId),
              type: 'movie',
            });
          }
        }
      }

      // Fetch TMDB recommendations for each watched item
      const tmdb = createTmdbWithRegionLanguage(user);
      const recommendationCounts = new Map<
        string,
        {
          count: number;
          item: BecauseYouWatchedCacheEntry['recommendations'][0];
        }
      >();

      await Promise.allSettled(
        watchedTmdbItems.slice(0, 15).map(async ({ tmdbId, type }) => {
          try {
            if (type === 'movie') {
              const recs = await tmdb.getMovieRecommendations({
                movieId: tmdbId,
              });
              for (const rec of recs.results.slice(0, 8)) {
                const key = `movie-${rec.id}`;
                const existing = recommendationCounts.get(key);
                if (existing) {
                  existing.count++;
                } else {
                  recommendationCounts.set(key, {
                    count: 1,
                    item: {
                      id: rec.id,
                      mediaType: 'movie',
                      title: rec.title,
                      posterPath: rec.poster_path,
                      overview: rec.overview,
                      releaseDate: rec.release_date,
                      voteAverage: rec.vote_average,
                      voteCount: rec.vote_count,
                      genreIds: rec.genre_ids,
                      originalLanguage: rec.original_language,
                      popularity: rec.popularity,
                      backdropPath: rec.backdrop_path,
                    },
                  });
                }
              }
            } else {
              const recs = await tmdb.getTvRecommendations({ tvId: tmdbId });
              for (const rec of recs.results.slice(0, 8)) {
                const key = `tv-${rec.id}`;
                const existing = recommendationCounts.get(key);
                if (existing) {
                  existing.count++;
                } else {
                  recommendationCounts.set(key, {
                    count: 1,
                    item: {
                      id: rec.id,
                      mediaType: 'tv',
                      title: rec.name,
                      posterPath: rec.poster_path,
                      overview: rec.overview,
                      firstAirDate: rec.first_air_date,
                      voteAverage: rec.vote_average,
                      voteCount: rec.vote_count,
                      genreIds: rec.genre_ids,
                      originalLanguage: rec.original_language,
                      popularity: rec.popularity,
                      backdropPath: rec.backdrop_path,
                    },
                  });
                }
              }
            }
          } catch (e) {
            logger.debug(
              `Failed to fetch recommendations for TMDB ${type}/${tmdbId}`,
              { label: 'Discover', message: e.message }
            );
          }
        })
      );

      // Rank by frequency (higher count = higher rank), then by popularity
      const recommendations = Array.from(recommendationCounts.values())
        .sort((a, b) => b.count - a.count || b.item.popularity - a.item.popularity)
        .map((entry) => entry.item);

      // Cache the recommendations
      cache.set<BecauseYouWatchedCacheEntry>(cacheKey, {
        recommendations,
        generatedAt: Date.now(),
      });

      // Return paginated results
      const start = (page - 1) * pageSize;
      const paged = recommendations.slice(start, start + pageSize);

      const media = await Media.getRelatedMedia(
        req.user,
        paged.map((r) => ({
          tmdbId: r.id,
          mediaType:
            r.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
        }))
      );

      return res.status(200).json({
        page,
        totalPages: Math.ceil(recommendations.length / pageSize),
        totalResults: recommendations.length,
        results: paged.map((r) => {
          const mediaInfo = media.find(
            (m) =>
              m.tmdbId === r.id &&
              m.mediaType ===
                (r.mediaType === 'movie'
                  ? MediaType.MOVIE
                  : MediaType.TV)
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
    const imdbApi = new IMDBRadarrProxy();
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
              logger.debug(
                `Failed to fetch IMDB rating for TMDB ${tmdbId}`,
                {
                  label: 'Discover Ratings',
                  message: e.message,
                }
              );
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
          logger.debug(
            `Failed to fetch ratings for TMDB ${tmdbId}`,
            {
              label: 'Discover Ratings',
              message: e.message,
            }
          );
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
