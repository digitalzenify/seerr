import type { User } from '@server/entity/User';
import type { TautulliSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { proxyRequestInterceptor } from '@server/utils/customProxyAgent';
import { userAgentRequestInterceptor } from '@server/utils/userAgent';
import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { uniqWith } from 'lodash';

// Paging for full show history lookups.
const HISTORY_PAGE_SIZE = 500;
const HISTORY_MAX_RECORDS = 4000;

export interface TautulliHistoryRecord {
  date: number;
  duration: number;
  friendly_name: string;
  full_title: string;
  grandparent_rating_key: number;
  grandparent_title: string;
  original_title: string;
  group_count: number;
  group_ids?: string;
  guid: string;
  ip_address: string;
  live: number;
  machine_id: string;
  media_index: number;
  media_type: string;
  originally_available_at: string;
  parent_media_index: number;
  parent_rating_key: number;
  parent_title: string;
  paused_counter: number;
  percent_complete: number;
  play_duration: number;
  platform: string;
  product: string;
  player: string;
  rating_key: number;
  reference_id?: number;
  row_id?: number;
  session_key?: string;
  started: number;
  state?: string;
  stopped: number;
  thumb: string;
  title: string;
  transcode_decision: string;
  user: string;
  user_id: number;
  watched_status: number;
  year: number;
}

interface TautulliHistoryResponse {
  response: {
    result: string;
    message?: string;
    data: {
      draw: number;
      recordsTotal: number;
      recordsFiltered: number;
      total_duration: string;
      filter_duration: string;
      data: TautulliHistoryRecord[];
    };
  };
}

interface TautulliWatchStats {
  query_days: number;
  total_time: number;
  total_plays: number;
}

interface TautulliWatchStatsResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchStats[];
  };
}

interface TautulliWatchUser {
  friendly_name: string;
  user_id: number;
  user_thumb: string;
  username: string;
  total_plays: number;
  total_time: number;
}

interface TautulliWatchUsersResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliWatchUser[];
  };
}

interface TautulliMetadata {
  media_type?: string;
  title?: string;
  guid?: string;
  guids?: string[];
  rating_key?: number;
  year?: number;
  genres?: string[];
  directors?: string[];
  actors?: string[];
  duration?: string;
}

export interface TautulliLibrary {
  section_id: string;
  section_name: string;
  section_type: string;
  count: string;
  parent_count?: string;
  child_count?: string;
}

interface TautulliLibrariesResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliLibrary[];
  };
}

interface TautulliMetadataResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliMetadata;
  };
}

interface TautulliInfo {
  tautulli_install_type: string;
  tautulli_version: string;
  tautulli_branch: string;
  tautulli_commit: string;
  tautulli_platform: string;
  tautulli_platform_release: string;
  tautulli_platform_version: string;
  tautulli_platform_linux_distro: string;
  tautulli_platform_device_name: string;
  tautulli_python_version: string;
}

interface TautulliInfoResponse {
  response: {
    result: string;
    message?: string;
    data: TautulliInfo;
  };
}

class TautulliAPI {
  private axios: AxiosInstance;

  constructor(settings: TautulliSettings) {
    this.axios = axios.create({
      baseURL: `${settings.useSsl ? 'https' : 'http'}://${settings.hostname}:${
        settings.port
      }${settings.urlBase ?? ''}`,
      params: { apikey: settings.apiKey },
    });
    this.axios.interceptors.request.use(proxyRequestInterceptor);
    this.axios.interceptors.request.use(userAgentRequestInterceptor);
  }

  public async getInfo(): Promise<TautulliInfo> {
    try {
      return (
        await this.axios.get<TautulliInfoResponse>('/api/v2', {
          params: { cmd: 'get_tautulli_info' },
        })
      ).data.response.data;
    } catch (e) {
      logger.error('Something went wrong fetching Tautulli server info', {
        label: 'Tautulli API',
        errorMessage: e.message,
      });
      throw new Error(
        `[Tautulli] Failed to fetch Tautulli server info: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getMediaWatchStats(
    ratingKey: string
  ): Promise<TautulliWatchStats[]> {
    try {
      return (
        await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_item_watch_time_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch stats: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getMediaWatchUsers(
    ratingKey: string
  ): Promise<TautulliWatchUser[]> {
    try {
      return (
        await this.axios.get<TautulliWatchUsersResponse>('/api/v2', {
          params: {
            cmd: 'get_item_user_stats',
            rating_key: ratingKey,
            grouping: 1,
          },
        })
      ).data.response.data;
    } catch (e) {
      logger.error(
        'Something went wrong fetching media watch users from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          ratingKey,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch media watch users: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getMetadata(ratingKey: string): Promise<TautulliMetadata> {
    try {
      return (
        await this.axios.get<TautulliMetadataResponse>('/api/v2', {
          params: { cmd: 'get_metadata', rating_key: ratingKey },
        })
      ).data.response.data;
    } catch (e) {
      logger.error('Something went wrong fetching metadata from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
        ratingKey,
      });
      throw new Error(`[Tautulli] Failed to fetch metadata: ${e.message}`, {
        cause: e,
      });
    }
  }

  /**
   * Every play for one user, ungrouped, oldest first. Watch statistics need
   * individual plays (a binge is several rows, not one grouped session), which
   * is why this does not go through `getUserWatchHistory`.
   */
  public async getUserHistory(
    user: User,
    /* Tautulli takes YYYY-MM-DD strings here; an epoch timestamp silently
       matches nothing, which is a quiet way to return zero plays. */
    opts: { after?: string; before?: string } = {}
  ): Promise<TautulliHistoryRecord[]> {
    const records: TautulliHistoryRecord[] = [];
    const pageSize = 1000;

    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      let start = 0;

      for (;;) {
        const page = (
          await this.axios.get<TautulliHistoryResponse>('/api/v2', {
            params: {
              cmd: 'get_history',
              order_column: 'date',
              order_dir: 'asc',
              user_id: user.plexId,
              media_type: 'movie,episode',
              length: pageSize,
              start,
              after: opts.after,
              before: opts.before,
            },
          })
        ).data.response.data.data;

        records.push(...page);

        if (page.length < pageSize || records.length >= HISTORY_MAX_RECORDS) {
          break;
        }
        start += pageSize;
      }

      return records;
    } catch (e) {
      logger.error(
        'Something went wrong fetching full user history from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(`[Tautulli] Failed to fetch user history: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getLibraries(): Promise<TautulliLibrary[]> {
    try {
      return (
        await this.axios.get<TautulliLibrariesResponse>('/api/v2', {
          params: { cmd: 'get_libraries' },
        })
      ).data.response.data;
    } catch (e) {
      logger.error('Something went wrong fetching libraries from Tautulli', {
        label: 'Tautulli API',
        errorMessage: e.message,
      });
      throw new Error(`[Tautulli] Failed to fetch libraries: ${e.message}`, {
        cause: e,
      });
    }
  }

  public async getUserWatchStats(user: User): Promise<TautulliWatchStats> {
    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      return (
        await this.axios.get<TautulliWatchStatsResponse>('/api/v2', {
          params: {
            cmd: 'get_user_watch_time_stats',
            user_id: user.plexId,
            query_days: 0,
            grouping: 1,
          },
        })
      ).data.response.data[0];
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch stats from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch stats: ${e.message}`,
        { cause: e }
      );
    }
  }

  public async getUserWatchHistory(
    user: User
  ): Promise<TautulliHistoryRecord[]> {
    let results: TautulliHistoryRecord[] = [];

    try {
      if (!user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      const take = 100;
      let start = 0;

      while (results.length < 20) {
        const tautulliData = (
          await this.axios.get<TautulliHistoryResponse>('/api/v2', {
            params: {
              cmd: 'get_history',
              grouping: 1,
              order_column: 'date',
              order_dir: 'desc',
              user_id: user.plexId,
              media_type: 'movie,episode',
              length: take,
              start,
            },
          })
        ).data.response.data.data;

        if (!tautulliData.length) {
          return results;
        }

        results = uniqWith(results.concat(tautulliData), (recordA, recordB) =>
          recordA.grandparent_rating_key && recordB.grandparent_rating_key
            ? recordA.grandparent_rating_key === recordB.grandparent_rating_key
            : recordA.parent_rating_key && recordB.parent_rating_key
              ? recordA.parent_rating_key === recordB.parent_rating_key
              : recordA.rating_key === recordB.rating_key
        );

        start += take;
      }

      return results.slice(0, 20);
    } catch (e) {
      logger.error(
        'Something went wrong fetching user watch history from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch user watch history: ${e.message}`,
        { cause: e }
      );
    }
  }

  /**
   * Watch history for a whole show. Pass a user to narrow it to that user's
   * plays; omit it to get every user's plays in one call, which is what the
   * auto-season job needs since the watcher is not always the requester.
   */
  public async getShowWatchHistory(
    grandparentRatingKey: string,
    user?: User
  ): Promise<TautulliHistoryRecord[]> {
    let results: TautulliHistoryRecord[] = [];

    try {
      if (user && !user.plexId) {
        throw new Error('User does not have an associated Plex ID');
      }

      const take = HISTORY_PAGE_SIZE;
      let start = 0;

      while (start < HISTORY_MAX_RECORDS) {
        const tautulliData = (
          await this.axios.get<TautulliHistoryResponse>('/api/v2', {
            params: {
              cmd: 'get_history',
              grouping: 0,
              order_column: 'date',
              order_dir: 'desc',
              ...(user?.plexId ? { user_id: user.plexId } : {}),
              media_type: 'episode',
              grandparent_rating_key: grandparentRatingKey,
              length: take,
              start,
            },
          })
        ).data.response.data.data;

        results = results.concat(
          tautulliData.filter(
            (record) =>
              String(record.grandparent_rating_key) ===
              String(grandparentRatingKey)
          )
        );

        if (tautulliData.length < take) {
          break;
        }

        start += take;
      }

      return results;
    } catch (e) {
      logger.error(
        'Something went wrong fetching show watch history from Tautulli',
        {
          label: 'Tautulli API',
          errorMessage: e.message,
          user: user?.displayName,
        }
      );
      throw new Error(
        `[Tautulli] Failed to fetch show watch history: ${e.message}`,
        { cause: e }
      );
    }
  }
}

export default TautulliAPI;
