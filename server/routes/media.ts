import BazarrAPI from '@server/api/bazarr';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import type {
  MediaResultsResponse,
  MediaWatchDataResponse,
} from '@server/interfaces/api/mediaInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import axios from 'axios';
import { Router } from 'express';
import path from 'path';
import type { FindOneOptions } from 'typeorm';
import { In, IsNull, Not } from 'typeorm';

const mediaRoutes = Router();

/** Map ISO 639-2/B (3-letter) language codes to ISO 639-1 (2-letter). */
const langCodeMap: Record<string, string> = {
  eng: 'en',
  rum: 'ro',
  ron: 'ro',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  dut: 'nl',
  nld: 'nl',
  pol: 'pl',
  hun: 'hu',
  cze: 'cs',
  ces: 'cs',
  swe: 'sv',
  dan: 'da',
  nor: 'no',
  fin: 'fi',
  tur: 'tr',
  ara: 'ar',
  jpn: 'ja',
  kor: 'ko',
  chi: 'zh',
  zho: 'zh',
  hin: 'hi',
  rus: 'ru',
  ukr: 'uk',
  bul: 'bg',
  hrv: 'hr',
  srp: 'sr',
  slv: 'sl',
  tha: 'th',
  vie: 'vi',
  ind: 'id',
  may: 'ms',
  msa: 'ms',
  gre: 'el',
  ell: 'el',
  heb: 'he',
};

/**
 * Get the 2-letter language code for a subtitle file extension.
 * Falls back to the original code if no mapping is found.
 */
function getSubtitleLangCode(lang3: string): string {
  return langCodeMap[lang3] ?? lang3;
}

/**
 * Extract the base filename (without extension) from a Jellyfin media source path.
 * Falls back to an empty string if the path is not available.
 */
function getVideoBaseName(mediaSourcePath?: string): string {
  if (!mediaSourcePath) return '';
  const basename = path.basename(mediaSourcePath);
  const ext = path.extname(basename);
  return ext ? basename.slice(0, -ext.length) : basename;
}

/**
 * Derive the subtitle source/origin tag from file path or display title.
 * Common sources: OpenSubtitles, Lingarr, Whisper, Bazarr, Embedded, etc.
 */
function deriveSubtitleSource(
  filePath?: string,
  displayTitle?: string
): string {
  const text = `${filePath ?? ''} ${displayTitle ?? ''}`.toLowerCase();
  if (text.includes('opensubtitles')) return 'OpenSubtitles';
  if (text.includes('lingarr')) return 'Lingarr';
  if (text.includes('whisper')) return 'Whisper';
  if (text.includes('bazarr')) return 'Bazarr';
  if (text.includes('subscene')) return 'Subscene';
  if (text.includes('addic7ed')) return 'Addic7ed';
  // External files (srt, ass, etc.) that are sidecar files
  if (filePath) return 'External';
  return 'Embedded';
}

mediaRoutes.get('/', async (req, res, next) => {
  const mediaRepository = getRepository(Media);

  const pageSize = req.query.take ? Number(req.query.take) : 20;
  const skip = req.query.skip ? Number(req.query.skip) : 0;

  let statusFilter = undefined;

  switch (req.query.filter) {
    case 'available':
      statusFilter = MediaStatus.AVAILABLE;
      break;
    case 'partial':
      statusFilter = MediaStatus.PARTIALLY_AVAILABLE;
      break;
    case 'allavailable':
      statusFilter = In([
        MediaStatus.AVAILABLE,
        MediaStatus.PARTIALLY_AVAILABLE,
      ]);
      break;
    case 'processing':
      statusFilter = MediaStatus.PROCESSING;
      break;
    case 'pending':
      statusFilter = MediaStatus.PENDING;
      break;
  }

  let sortFilter: FindOneOptions<Media>['order'] = {
    id: 'DESC',
  };

  switch (req.query.sort) {
    case 'modified':
      sortFilter = {
        updatedAt: 'DESC',
      };
      break;
    case 'mediaAdded':
      sortFilter = {
        mediaAddedAt: 'DESC',
      };
  }

  let whereClause: FindOneOptions<Media>['where'];
  if (statusFilter || req.query.sort === 'mediaAdded') {
    whereClause = {};
    if (statusFilter) whereClause.status = statusFilter;
    if (req.query.sort === 'mediaAdded')
      whereClause.mediaAddedAt = Not(IsNull());
  }

  try {
    const [media, mediaCount] = await mediaRepository.findAndCount({
      order: sortFilter,
      where: whereClause,
      take: pageSize,
      skip,
    });
    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(mediaCount / pageSize),
        pageSize,
        results: mediaCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: media,
    } as MediaResultsResponse);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

mediaRoutes.post<
  {
    id: string;
    status: 'available' | 'partial' | 'processing' | 'pending' | 'unknown';
  },
  Media
>(
  '/:id/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const mediaRepository = getRepository(Media);
    const seasonRepository = getRepository(Season);

    const media = await mediaRepository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const is4k = String(req.body.is4k) === 'true';

    switch (req.params.status) {
      case 'available':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;

        if (media.mediaType === MediaType.TV) {
          const expectedSeasons = req.body.seasons ?? [];

          for (const expectedSeason of expectedSeasons) {
            let season = media.seasons.find(
              (s) => s.seasonNumber === expectedSeason?.seasonNumber
            );

            if (!season) {
              // Create the season if it doesn't exist
              season = seasonRepository.create({
                seasonNumber: expectedSeason?.seasonNumber,
              });
              media.seasons.push(season);
            }

            season[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;
          }
        }
        break;
      case 'partial':
        if (media.mediaType === MediaType.MOVIE) {
          return next({
            status: 400,
            message: 'Only series can be set to be partially available',
          });
        }
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PARTIALLY_AVAILABLE;
        break;
      case 'processing':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PROCESSING;
        break;
      case 'pending':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PENDING;
        break;
      case 'unknown':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.UNKNOWN;
    }

    await mediaRepository.save(media);

    return res.status(200).json(media);
  }
);

mediaRoutes.delete(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);

      const media = await mediaRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      if (media.status === MediaStatus.BLOCKLISTED) {
        media.resetServiceData();
        await mediaRepository.save(media);
      } else {
        await mediaRepository.remove(media);
      }

      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 404, message: 'Media not found' });
    }
  }
);

mediaRoutes.delete(
  '/:id/file',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      const is4k = String(req.query.is4k) === 'true';
      const isMovie = media.mediaType === MediaType.MOVIE;

      let serviceSettings;
      if (isMovie) {
        serviceSettings = settings.radarr.find(
          (radarr) => radarr.isDefault && radarr.is4k === is4k
        );
      } else {
        serviceSettings = settings.sonarr.find(
          (sonarr) => sonarr.isDefault && sonarr.is4k === is4k
        );
      }

      const specificServiceId = is4k ? media.serviceId4k : media.serviceId;
      if (
        specificServiceId &&
        specificServiceId >= 0 &&
        serviceSettings?.id !== specificServiceId
      ) {
        if (isMovie) {
          serviceSettings = settings.radarr.find(
            (radarr) => radarr.id === specificServiceId
          );
        } else {
          serviceSettings = settings.sonarr.find(
            (sonarr) => sonarr.id === specificServiceId
          );
        }
      }

      if (!serviceSettings) {
        logger.warn(
          `There is no default ${
            is4k ? '4K ' : '' + isMovie ? 'Radarr' : 'Sonarr'
          }/ server configured. Did you set any of your ${
            is4k ? '4K ' : '' + isMovie ? 'Radarr' : 'Sonarr'
          } servers as default?`,
          {
            label: 'Media Request',
            mediaId: media.id,
          }
        );
        return;
      }

      let service;
      if (isMovie) {
        service = new RadarrAPI({
          apiKey: serviceSettings?.apiKey,
          url: RadarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
      } else {
        service = new SonarrAPI({
          apiKey: serviceSettings?.apiKey,
          url: SonarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
      }

      if (isMovie) {
        await (service as RadarrAPI).removeMovie(media.tmdbId);
      } else {
        const tmdb = new TheMovieDb();
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
        if (!tvdbId) {
          throw new Error('TVDB ID not found');
        }
        await (service as SonarrAPI).removeSeries(tvdbId);
      }

      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong fetching media in delete request', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 404, message: 'Media not found' });
    }
  }
);

mediaRoutes.get<{ id: string }, MediaWatchDataResponse>(
  '/:id/watch_data',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const settings = getSettings().tautulli;

    if (!settings.hostname || !settings.port || !settings.apiKey) {
      return next({
        status: 404,
        message: 'Tautulli API not configured.',
      });
    }

    const media = await getRepository(Media).findOne({
      where: { id: Number(req.params.id) },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    try {
      const tautulli = new TautulliAPI(settings);
      const userRepository = getRepository(User);

      const response: MediaWatchDataResponse = {};

      if (media.ratingKey) {
        const watchStats = await tautulli.getMediaWatchStats(media.ratingKey);
        const watchUsers = await tautulli.getMediaWatchUsers(media.ratingKey);
        const plexIds = watchUsers.map((u) => u.user_id);
        if (!plexIds.length) plexIds.push(-1);

        const users = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId IN (:...plexIds)', { plexIds })
          .getMany();

        const playCount =
          watchStats.find((i) => i.query_days == 0)?.total_plays ?? 0;

        const playCount7Days =
          watchStats.find((i) => i.query_days == 7)?.total_plays ?? 0;

        const playCount30Days =
          watchStats.find((i) => i.query_days == 30)?.total_plays ?? 0;

        response.data = {
          users: users,
          playCount,
          playCount7Days,
          playCount30Days,
        };
      }

      if (media.ratingKey4k) {
        const watchStats4k = await tautulli.getMediaWatchStats(
          media.ratingKey4k
        );
        const watchUsers4k = await tautulli.getMediaWatchUsers(
          media.ratingKey4k
        );
        const plexIds4k = watchUsers4k.map((u) => u.user_id);
        if (!plexIds4k.length) plexIds4k.push(-1);

        const users = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId IN (:...plexIds)', { plexIds: plexIds4k })
          .getMany();

        const playCount =
          watchStats4k.find((i) => i.query_days == 0)?.total_plays ?? 0;

        const playCount7Days =
          watchStats4k.find((i) => i.query_days == 7)?.total_plays ?? 0;

        const playCount30Days =
          watchStats4k.find((i) => i.query_days == 30)?.total_plays ?? 0;

        response.data4k = {
          users,
          playCount,
          playCount7Days,
          playCount30Days,
        };
      }

      return res.status(200).json(response);
    } catch (e) {
      logger.error('Something went wrong fetching media watch data', {
        label: 'API',
        errorMessage: e.message,
        mediaId: req.params.id,
      });
      next({ status: 500, message: 'Failed to fetch watch data.' });
    }
  }
);

/**
 * Helper: build a BazarrAPI instance from the first configured Bazarr server.
 */
function getBazarrClient(): BazarrAPI | undefined {
  const bazarrSettings = getSettings().bazarr[0];
  if (!bazarrSettings) return undefined;
  const url = BazarrAPI.buildUrl(bazarrSettings);
  return new BazarrAPI(url, bazarrSettings.apiKey);
}

/**
 * Helper: build a Jellyfin base URL + API key from settings.
 */
function getJellyfinConnection(): {
  baseUrl: string;
  apiKey: string;
} | undefined {
  const settings = getSettings();
  const jf = settings.jellyfin;
  if (!jf.ip || !jf.apiKey) return undefined;
  const protocol = jf.useSsl ? 'https' : 'http';
  const urlBase = jf.urlBase ? `/${jf.urlBase.replace(/^\//, '')}` : '';
  return {
    baseUrl: `${protocol}://${jf.ip}:${jf.port}${urlBase}`,
    apiKey: jf.apiKey,
  };
}

/**
 * GET /media/:id/download
 * Proxy-streams the media file from Jellyfin to the client.
 */
mediaRoutes.get<{ id: string }>(
  '/:id/download',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const jf = getJellyfinConnection();
      if (!jf) {
        return next({
          status: 500,
          message: 'Jellyfin is not configured.',
        });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      const jellyfinId = media.jellyfinMediaId;
      if (!jellyfinId) {
        return next({
          status: 404,
          message: 'This media has no Jellyfin ID.',
        });
      }

      const downloadUrl = `${jf.baseUrl}/Items/${encodeURIComponent(
        jellyfinId
      )}/Download?api_key=${encodeURIComponent(jf.apiKey)}`;

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 0,
      });

      // Forward relevant headers
      const contentType =
        response.headers['content-type'] ?? 'application/octet-stream';
      const contentLength = response.headers['content-length'];
      const contentDisposition = response.headers['content-disposition'];

      res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      } else {
        // Derive file extension from content-type when possible
        const ext =
          contentType === 'video/x-matroska'
            ? 'mkv'
            : contentType === 'video/mp4'
              ? 'mp4'
              : contentType === 'video/x-msvideo'
                ? 'avi'
                : 'mkv';
        const safeName = (media.tmdbId ?? 'media').toString();
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="media-${safeName}.${ext}"`
        );
      }

      response.data.pipe(res);
    } catch (e) {
      logger.error('Failed to proxy media download', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to download media.' });
    }
  }
);

/**
 * GET /media/:id/subtitles
 * Returns available subtitles for a media item from Bazarr.
 */
mediaRoutes.get<{ id: string }>(
  '/:id/subtitles',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const bazarr = getBazarrClient();
      if (!bazarr) {
        return res.status(200).json({ subtitles: [], missing: [] });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      if (
        media.mediaType === MediaType.MOVIE &&
        media.externalServiceId != null
      ) {
        const data = await bazarr.getMovieSubtitles(media.externalServiceId);
        return res.status(200).json({
          subtitles: data?.subtitles ?? [],
          missing: data?.missing_subtitles ?? [],
        });
      }

      return res.status(200).json({ subtitles: [], missing: [] });
    } catch (e) {
      logger.error('Failed to fetch subtitles', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to fetch subtitles.' });
    }
  }
);

/**
 * GET /media/:id/subtitle-streams
 * Returns all available subtitle streams from Jellyfin for a media item,
 * grouped by language. Used by the unified subtitle download modal.
 */
mediaRoutes.get<{ id: string }>(
  '/:id/subtitle-streams',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const jf = getJellyfinConnection();
      if (!jf) {
        return res.status(200).json({ streams: [] });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      const jellyfinId = media.jellyfinMediaId;
      if (!jellyfinId) {
        return res.status(200).json({ streams: [] });
      }

      const itemUrl = `${jf.baseUrl}/Items?ids=${encodeURIComponent(
        jellyfinId
      )}&fields=MediaSources&api_key=${encodeURIComponent(jf.apiKey)}`;
      const itemResponse = await axios.get(itemUrl);
      const item = itemResponse.data.Items?.[0];

      if (!item?.MediaSources?.length) {
        return res.status(200).json({ streams: [] });
      }

      const mediaSource = item.MediaSources[0];
      const subtitleStreams = (mediaSource.MediaStreams ?? [])
        .filter(
          (stream: { Type: string }) => stream.Type === 'Subtitle'
        )
        .map(
          (stream: {
            Index: number;
            Language?: string;
            DisplayTitle?: string;
            Title?: string;
            Codec?: string;
            IsForced?: boolean;
            IsDefault?: boolean;
            IsExternal?: boolean;
            IsHearingImpaired?: boolean;
            SupportsExternalStream?: boolean;
            Path?: string;
          }) => ({
            index: stream.Index,
            language: stream.Language ?? 'und',
            displayTitle: stream.DisplayTitle ?? stream.Title ?? '',
            codec: stream.Codec ?? '',
            isForced: stream.IsForced ?? false,
            isDefault: stream.IsDefault ?? false,
            isExternal: stream.IsExternal ?? false,
            isHearingImpaired: stream.IsHearingImpaired ?? false,
            // Derive source tag from path or other metadata
            source: deriveSubtitleSource(stream.Path, stream.DisplayTitle),
          })
        );

      return res.status(200).json({ streams: subtitleStreams });
    } catch (e) {
      logger.error('Failed to fetch subtitle streams', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to fetch subtitle streams.' });
    }
  }
);

/**
 * GET /media/:id/episode/:seasonNumber/:episodeNumber/subtitle-streams
 * Returns all available subtitle streams from Jellyfin for a TV episode.
 */
mediaRoutes.get<{
  id: string;
  seasonNumber: string;
  episodeNumber: string;
}>(
  '/:id/episode/:seasonNumber/:episodeNumber/subtitle-streams',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const jf = getJellyfinConnection();
      if (!jf) {
        return res.status(200).json({ streams: [] });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      const jellyfinId = media.jellyfinMediaId;
      if (!jellyfinId) {
        return res.status(200).json({ streams: [] });
      }

      const seasonNumber = Number(req.params.seasonNumber);
      const episodeNumber = Number(req.params.episodeNumber);

      const episodesUrl = `${jf.baseUrl}/Shows/${encodeURIComponent(
        jellyfinId
      )}/Episodes?season=${seasonNumber}&fields=MediaSources&api_key=${encodeURIComponent(
        jf.apiKey
      )}`;
      const episodesResponse = await axios.get(episodesUrl);
      const episode = episodesResponse.data.Items?.find(
        (ep: { IndexNumber?: number; ParentIndexNumber?: number }) =>
          ep.IndexNumber === episodeNumber &&
          ep.ParentIndexNumber === seasonNumber
      );

      if (!episode?.MediaSources?.length) {
        return res.status(200).json({ streams: [] });
      }

      const mediaSource = episode.MediaSources[0];
      const subtitleStreams = (mediaSource.MediaStreams ?? [])
        .filter(
          (stream: { Type: string }) => stream.Type === 'Subtitle'
        )
        .map(
          (stream: {
            Index: number;
            Language?: string;
            DisplayTitle?: string;
            Title?: string;
            Codec?: string;
            IsForced?: boolean;
            IsDefault?: boolean;
            IsExternal?: boolean;
            IsHearingImpaired?: boolean;
            SupportsExternalStream?: boolean;
            Path?: string;
          }) => ({
            index: stream.Index,
            language: stream.Language ?? 'und',
            displayTitle: stream.DisplayTitle ?? stream.Title ?? '',
            codec: stream.Codec ?? '',
            isForced: stream.IsForced ?? false,
            isDefault: stream.IsDefault ?? false,
            isExternal: stream.IsExternal ?? false,
            isHearingImpaired: stream.IsHearingImpaired ?? false,
            source: deriveSubtitleSource(stream.Path, stream.DisplayTitle),
          })
        );

      return res.status(200).json({ streams: subtitleStreams });
    } catch (e) {
      logger.error('Failed to fetch episode subtitle streams', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to fetch subtitle streams.' });
    }
  }
);

/**
 * GET /media/:id/subtitle/:language/download
 * Download a subtitle file for a media item.
 * First checks Jellyfin for existing subtitles, then falls back to Bazarr.
 */
mediaRoutes.get<{ id: string; language: string }>(
  '/:id/subtitle/:language/download',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const jf = getJellyfinConnection();
      if (!jf) {
        return next({
          status: 500,
          message: 'Jellyfin is not configured.',
        });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      const jellyfinId = media.jellyfinMediaId;
      if (!jellyfinId) {
        return next({
          status: 404,
          message: 'This media has no Jellyfin ID.',
        });
      }

      const lang = req.params.language.toLowerCase();

      // Fetch item data from Jellyfin to find subtitle stream index
      const itemUrl = `${jf.baseUrl}/Items?ids=${encodeURIComponent(
        jellyfinId
      )}&fields=MediaSources&api_key=${encodeURIComponent(jf.apiKey)}`;
      const itemResponse = await axios.get(itemUrl);
      const item = itemResponse.data.Items?.[0];

      if (!item?.MediaSources?.length) {
        return next({
          status: 404,
          message: 'No media sources found.',
        });
      }

      const mediaSource = item.MediaSources[0];
      const subtitleStream = mediaSource.MediaStreams?.find(
        (stream: { Type: string; Language?: string }) =>
          stream.Type === 'Subtitle' &&
          stream.Language?.toLowerCase() === lang
      );

      if (!subtitleStream) {
        // If no subtitle found, try to trigger Bazarr download
        const bazarr = getBazarrClient();
        if (bazarr && media.externalServiceId != null) {
          try {
            await bazarr.downloadMovieSubtitle(
              media.externalServiceId,
              lang
            );
            return res.status(202).json({
              message: `Subtitle download for "${lang}" has been triggered. Please try again in a moment.`,
            });
          } catch {
            // Fall through to 404
          }
        }

        return next({
          status: 404,
          message: `No ${lang} subtitle found.`,
        });
      }

      // Stream the subtitle from Jellyfin
      const subtitleUrl = `${jf.baseUrl}/Videos/${encodeURIComponent(
        jellyfinId
      )}/${encodeURIComponent(
        mediaSource.Id
      )}/Subtitles/${subtitleStream.Index}/0/Stream.srt?api_key=${encodeURIComponent(
        jf.apiKey
      )}`;

      const subtitleResponse = await axios.get(subtitleUrl, {
        responseType: 'stream',
      });

      // Name the subtitle after the video file so players auto-detect it
      const videoBase = getVideoBaseName(mediaSource.Path);
      const langCode = getSubtitleLangCode(lang);
      const subtitleFilename = videoBase
        ? `${videoBase}.${langCode}.srt`
        : `subtitle-${langCode}.srt`;

      res.setHeader('Content-Type', 'text/srt; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${subtitleFilename}"`
      );

      subtitleResponse.data.pipe(res);
    } catch (e) {
      logger.error('Failed to download subtitle', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to download subtitle.' });
    }
  }
);

/**
 * GET /media/:id/episode/:seasonNumber/:episodeNumber/download
 * Download a specific TV episode from Jellyfin.
 */
mediaRoutes.get<{
  id: string;
  seasonNumber: string;
  episodeNumber: string;
}>(
  '/:id/episode/:seasonNumber/:episodeNumber/download',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const jf = getJellyfinConnection();
      if (!jf) {
        return next({ status: 500, message: 'Jellyfin is not configured.' });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      const jellyfinId = media.jellyfinMediaId;
      if (!jellyfinId) {
        return next({ status: 404, message: 'This media has no Jellyfin ID.' });
      }

      const seasonNumber = Number(req.params.seasonNumber);
      const episodeNumber = Number(req.params.episodeNumber);

      // Find the episode in Jellyfin
      const episodesUrl = `${jf.baseUrl}/Shows/${encodeURIComponent(
        jellyfinId
      )}/Episodes?season=${seasonNumber}&fields=MediaSources&api_key=${encodeURIComponent(
        jf.apiKey
      )}`;
      const episodesResponse = await axios.get(episodesUrl);
      const episode = episodesResponse.data.Items?.find(
        (ep: { IndexNumber?: number; ParentIndexNumber?: number }) =>
          ep.IndexNumber === episodeNumber &&
          ep.ParentIndexNumber === seasonNumber
      );

      if (!episode) {
        return next({ status: 404, message: 'Episode not found in Jellyfin.' });
      }

      const downloadUrl = `${jf.baseUrl}/Items/${encodeURIComponent(
        episode.Id
      )}/Download?api_key=${encodeURIComponent(jf.apiKey)}`;

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 0,
      });

      const contentType =
        response.headers['content-type'] ?? 'application/octet-stream';
      const contentLength = response.headers['content-length'];
      const contentDisposition = response.headers['content-disposition'];

      res.setHeader('Content-Type', contentType);
      if (contentLength) res.setHeader('Content-Length', contentLength);
      if (contentDisposition) {
        res.setHeader('Content-Disposition', contentDisposition);
      } else {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="S${String(seasonNumber).padStart(
            2,
            '0'
          )}E${String(episodeNumber).padStart(2, '0')}.mkv"`
        );
      }

      response.data.pipe(res);
    } catch (e) {
      logger.error('Failed to proxy episode download', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to download episode.' });
    }
  }
);

/**
 * GET /media/:id/episode/:seasonNumber/:episodeNumber/subtitle/:language/download
 * Download a subtitle for a specific TV episode from Jellyfin.
 */
mediaRoutes.get<{
  id: string;
  seasonNumber: string;
  episodeNumber: string;
  language: string;
}>(
  '/:id/episode/:seasonNumber/:episodeNumber/subtitle/:language/download',
  isAuthenticated(),
  async (req, res, next) => {
    try {
      const jf = getJellyfinConnection();
      if (!jf) {
        return next({ status: 500, message: 'Jellyfin is not configured.' });
      }

      const media = await getRepository(Media).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!media) {
        return next({ status: 404, message: 'Media not found.' });
      }

      const jellyfinId = media.jellyfinMediaId;
      if (!jellyfinId) {
        return next({ status: 404, message: 'This media has no Jellyfin ID.' });
      }

      const seasonNumber = Number(req.params.seasonNumber);
      const episodeNumber = Number(req.params.episodeNumber);
      const lang = req.params.language.toLowerCase();

      // Find the episode in Jellyfin
      const episodesUrl = `${jf.baseUrl}/Shows/${encodeURIComponent(
        jellyfinId
      )}/Episodes?season=${seasonNumber}&fields=MediaSources&api_key=${encodeURIComponent(
        jf.apiKey
      )}`;
      const episodesResponse = await axios.get(episodesUrl);
      const episode = episodesResponse.data.Items?.find(
        (ep: { IndexNumber?: number; ParentIndexNumber?: number }) =>
          ep.IndexNumber === episodeNumber &&
          ep.ParentIndexNumber === seasonNumber
      );

      if (!episode?.MediaSources?.length) {
        return next({ status: 404, message: 'Episode not found.' });
      }

      const mediaSource = episode.MediaSources[0];
      const subtitleStream = mediaSource.MediaStreams?.find(
        (stream: { Type: string; Language?: string }) =>
          stream.Type === 'Subtitle' &&
          stream.Language?.toLowerCase() === lang
      );

      if (!subtitleStream) {
        return next({
          status: 404,
          message: `No ${lang} subtitle found for this episode.`,
        });
      }

      const subtitleUrl = `${jf.baseUrl}/Videos/${encodeURIComponent(
        episode.Id
      )}/${encodeURIComponent(
        mediaSource.Id
      )}/Subtitles/${subtitleStream.Index}/0/Stream.srt?api_key=${encodeURIComponent(
        jf.apiKey
      )}`;

      const subtitleResponse = await axios.get(subtitleUrl, {
        responseType: 'stream',
      });

      // Name the subtitle after the video file so players auto-detect it
      const videoBase = getVideoBaseName(mediaSource.Path);
      const langCode = getSubtitleLangCode(lang);
      const subtitleFilename = videoBase
        ? `${videoBase}.${langCode}.srt`
        : `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}.${langCode}.srt`;

      res.setHeader('Content-Type', 'text/srt; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${subtitleFilename}"`
      );

      subtitleResponse.data.pipe(res);
    } catch (e) {
      logger.error('Failed to download episode subtitle', {
        label: 'Media',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to download subtitle.' });
    }
  }
);

export default mediaRoutes;
