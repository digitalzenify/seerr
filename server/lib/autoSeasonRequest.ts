import type { TautulliHistoryRecord } from '@server/api/tautulli';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import MediaRequest, {
  DuplicateMediaRequestError,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

// Tunables for automatic next-season requests. Keep them conservative: only
// users who are actively watching a season and close to its end trigger an
// automatic request for the season after it.
export const EPISODES_LEFT_THRESHOLD = 3;
export const RECENT_WATCH_DAYS = 14;
const WATCHED_PERCENT_THRESHOLD = 85;

/**
 * Returns the closest season after the given one that has at least one
 * episode, or null if there is nothing left to request.
 */
export const nextSeasonToRequest = (
  seasons: { season_number: number; episode_count: number }[],
  currentSeason: number
): number | null => {
  const candidates = seasons
    .filter(
      (season) =>
        season.season_number > currentSeason && season.episode_count > 0
    )
    .map((season) => season.season_number)
    .sort((a, b) => a - b);

  return candidates[0] ?? null;
};

/**
 * The furthest episode the user has reached in the given season, using only
 * plays from the recent window. This is the progress signal: counting
 * distinct episodes played on this server instead undercounts whenever
 * episodes carry watch state from before this server existed (Plex watch
 * flags follow the account, but leave no play history here) or were skipped
 * outright, which held the request back until the final episode.
 */
export const furthestWatchedInSeason = (
  plays: TautulliHistoryRecord[],
  seasonNumber: number,
  now = Date.now()
): number =>
  plays
    .filter(
      (record) =>
        record.parent_media_index === seasonNumber &&
        (record.watched_status === 1 ||
          record.percent_complete >= WATCHED_PERCENT_THRESHOLD) &&
        record.date * 1000 >= now - RECENT_WATCH_DAYS * 24 * 60 * 60 * 1000
    )
    .reduce((furthest, record) => Math.max(furthest, record.media_index), 0);

/**
 * Decides whether the next season should be requested for a user based on
 * how close to the end of the current season they are and how recently they
 * watched it.
 */
export const shouldRequestNextSeason = ({
  episodeCount,
  furthestWatched,
  lastWatchedAt,
  now = Date.now(),
}: {
  episodeCount: number;
  furthestWatched: number;
  lastWatchedAt: number | null;
  now?: number;
}): boolean => {
  if (episodeCount <= 0) {
    return false;
  }

  if (episodeCount - furthestWatched > EPISODES_LEFT_THRESHOLD) {
    return false;
  }

  if (lastWatchedAt === null) {
    return false;
  }

  return lastWatchedAt >= now - RECENT_WATCH_DAYS * 24 * 60 * 60 * 1000;
};

/**
 * Picks the watchers who are close enough to the end of the given season for
 * the next season to be requested. The requester is not necessarily the person
 * watching (one household member often places every request), so the job has to
 * look at who actually watched, not at who asked for the show.
 */
export const watchersNearSeasonEnd = (
  plays: TautulliHistoryRecord[],
  seasonNumber: number,
  episodeCount: number,
  now = Date.now()
): { plexId: number; furthestWatched: number }[] => {
  const playsByUser = new Map<number, TautulliHistoryRecord[]>();

  for (const record of plays) {
    const userPlays = playsByUser.get(record.user_id);

    if (userPlays) {
      userPlays.push(record);
    } else {
      playsByUser.set(record.user_id, [record]);
    }
  }

  const candidates: { plexId: number; furthestWatched: number }[] = [];

  for (const [plexId, userPlays] of playsByUser) {
    const seasonPlays = userPlays.filter(
      (record) => record.parent_media_index === seasonNumber
    );
    const furthestWatched = furthestWatchedInSeason(
      userPlays,
      seasonNumber,
      now
    );
    const lastWatchedAt = seasonPlays.length
      ? Math.max(...seasonPlays.map((record) => record.date * 1000))
      : null;

    if (
      shouldRequestNextSeason({
        episodeCount,
        furthestWatched,
        lastWatchedAt,
        now,
      })
    ) {
      candidates.push({ plexId, furthestWatched });
    }
  }

  return candidates.sort((a, b) => b.furthestWatched - a.furthestWatched);
};

class AutoSeasonRequest {
  private running = false;

  public status(): { running: boolean } {
    return { running: this.running };
  }

  public async run(): Promise<void> {
    if (this.running) {
      logger.debug('Auto season request is already running', {
        label: 'Auto Season Request',
      });
      return;
    }

    this.running = true;

    try {
      const settings = getSettings();

      if (!settings.tautulli.hostname) {
        logger.debug('Tautulli is not configured; skipping auto requests', {
          label: 'Auto Season Request',
        });
        return;
      }

      const requestRepository = getRepository(MediaRequest);
      const usersByPlexId = new Map<string, User>(
        (await getRepository(User).find())
          .filter((user) => user.plexId)
          .map((user) => [String(user.plexId), user])
      );
      const requests = await requestRepository.find({
        where: {
          type: MediaType.TV,
          is4k: false,
          status: In([
            MediaRequestStatus.APPROVED,
            MediaRequestStatus.COMPLETED,
          ]),
        },
        relations: { media: { seasons: true } },
      });

      const tmdb = new TheMovieDb();
      const tautulli = new TautulliAPI(settings.tautulli);
      const tmdbCache = new Map<
        number,
        Awaited<ReturnType<TheMovieDb['getTvShow']>>
      >();
      const historyCache = new Map<string, TautulliHistoryRecord[]>();
      const seenSeasons = new Set<string>();

      for (const request of requests) {
        const media = request.media;

        if (!media || media.mediaType !== MediaType.TV || !media.ratingKey) {
          continue;
        }

        for (const seasonRequest of request.seasons ?? []) {
          const seasonNumber = seasonRequest.seasonNumber;
          const seasonKey = `${media.id}:${seasonNumber}`;

          if (
            seasonNumber < 1 ||
            seasonRequest.status === MediaRequestStatus.DECLINED ||
            seenSeasons.has(seasonKey)
          ) {
            continue;
          }
          seenSeasons.add(seasonKey);

          const mediaSeason = (media.seasons ?? []).find(
            (season) => season.seasonNumber === seasonNumber
          );

          if (!mediaSeason || mediaSeason.status !== MediaStatus.AVAILABLE) {
            continue;
          }

          try {
            let show = tmdbCache.get(media.tmdbId);

            if (!show) {
              show = await tmdb.getTvShow({ tvId: media.tmdbId });
              tmdbCache.set(media.tmdbId, show);
            }

            const nextSeason = nextSeasonToRequest(show.seasons, seasonNumber);

            if (nextSeason === null) {
              continue;
            }

            // Skip when the next season is already available or requested.
            const nextSeasonRow = (media.seasons ?? []).find(
              (season) => season.seasonNumber === nextSeason
            );

            if (
              nextSeasonRow &&
              nextSeasonRow.status !== MediaStatus.UNKNOWN &&
              nextSeasonRow.status !== MediaStatus.DELETED
            ) {
              continue;
            }

            const existingRequest = await requestRepository
              .createQueryBuilder('request')
              .leftJoin('request.media', 'media')
              .leftJoin('request.seasons', 'season')
              .where('media.id = :mediaId', { mediaId: media.id })
              .andWhere('request.is4k = false')
              .andWhere('request.status != :declined', {
                declined: MediaRequestStatus.DECLINED,
              })
              .andWhere('season.seasonNumber = :seasonNumber', {
                seasonNumber: nextSeason,
              })
              .getCount();

            if (existingRequest > 0) {
              continue;
            }

            const historyKey = String(media.ratingKey);
            let history = historyCache.get(historyKey);

            if (!history) {
              history = await tautulli.getShowWatchHistory(media.ratingKey);
              historyCache.set(historyKey, history);
            }

            const currentSeasonMeta = show.seasons.find(
              (season) => season.season_number === seasonNumber
            );
            const episodeCount = currentSeasonMeta?.episode_count ?? 0;

            // Whoever reached furthest into the season gets the request,
            // whether or not they are the user who requested the show.
            const watcher = watchersNearSeasonEnd(
              history,
              seasonNumber,
              episodeCount
            )
              .map((candidate) => ({
                ...candidate,
                user: usersByPlexId.get(String(candidate.plexId)),
              }))
              .find((candidate) => candidate.user);

            if (!watcher?.user) {
              continue;
            }

            await MediaRequest.request(
              {
                mediaId: media.tmdbId,
                mediaType: MediaType.TV,
                seasons: [nextSeason],
                is4k: false,
              },
              watcher.user,
              { isAutoRequest: true }
            );

            logger.info('Auto-requested next season', {
              label: 'Auto Season Request',
              title: show.name,
              mediaId: media.id,
              seasonNumber,
              nextSeason,
              furthestWatched: watcher.furthestWatched,
              episodeCount,
              userId: watcher.user.id,
            });
          } catch (e) {
            if (
              e instanceof NoSeasonsAvailableError ||
              e instanceof DuplicateMediaRequestError ||
              e instanceof QuotaRestrictedError ||
              e instanceof RequestPermissionError
            ) {
              logger.debug('Skipped auto season request', {
                label: 'Auto Season Request',
                mediaId: media.id,
                seasonNumber,
                errorMessage: e.message,
              });
            } else {
              logger.error('Failed to auto-request next season', {
                label: 'Auto Season Request',
                mediaId: media.id,
                seasonNumber,
                errorMessage: e.message,
              });
            }
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const autoSeasonRequest = new AutoSeasonRequest();

export default autoSeasonRequest;
