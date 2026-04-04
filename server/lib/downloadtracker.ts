import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { uniqWith } from 'lodash';

interface EpisodeNumberResult {
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber: number;
  id: number;
}
export interface DownloadingItem {
  mediaType: MediaType;
  externalId: number;
  size: number;
  sizeLeft: number;
  status: string;
  /** Radarr/Sonarr trackedDownloadStatus: 'ok' | 'warning' | 'error' */
  trackedDownloadStatus: string;
  /** Radarr/Sonarr trackedDownloadState, e.g. 'downloading', 'importPending', 'importing', 'imported' */
  trackedDownloadState: string;
  timeLeft: string;
  estimatedCompletionTime: Date;
  title: string;
  downloadId: string;
  episode?: EpisodeNumberResult;
}

class DownloadTracker {
  private radarrServers: Record<number, DownloadingItem[]> = {};
  private sonarrServers: Record<number, DownloadingItem[]> = {};
  private lastUpdated = 0;
  private updateInProgress: Promise<void> | null = null;

  /**
   * Tracks media items whose downloads were recently present in the queue
   * but have since disappeared — most likely because the import completed.
   * Key = `${mediaType}:${externalId}`, value = timestamp when the item
   * was last seen in the queue.  Entries older than
   * {@link RECENTLY_COMPLETED_TTL_MS} are pruned on every update.
   */
  private recentlyCompleted: Map<string, number> = new Map();

  /**
   * Optional callback invoked when one or more downloads leave the queue.
   * Used to trigger a targeted media-server library scan so that Seerr
   * can detect the newly imported media faster.
   */
  public onDownloadsCompleted: (() => void) | null = null;

  /**
   * How long a "recently completed" entry is kept (15 minutes).
   *
   * This must be longer than the Jellyfin/Plex recently-added scanner
   * interval (default: every 5 minutes) to bridge the gap between a
   * download leaving the Sonarr/Radarr queue and Seerr updating the
   * MediaStatus to AVAILABLE.  With the previous 5-minute TTL the entry
   * could expire before the library scanner ran, causing the status to
   * fall back to "Waiting for Release".
   */
  private static readonly RECENTLY_COMPLETED_TTL_MS = 15 * 60 * 1000;

  public getMovieProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.radarrServers[serverId]) {
      return [];
    }

    return this.radarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public getSeriesProgress(
    serverId: number,
    externalServiceId: number
  ): DownloadingItem[] {
    if (!this.sonarrServers[serverId]) {
      return [];
    }

    return this.sonarrServers[serverId].filter(
      (item) => item.externalId === externalServiceId
    );
  }

  public async resetDownloadTracker() {
    this.radarrServers = {};
    this.sonarrServers = {};
    this.recentlyCompleted = new Map();
    this.lastUpdated = 0;
  }

  /**
   * Returns true when the given media item was recently tracked in the
   * download queue but has since disappeared.  This bridges the gap between
   * the queue item being removed (import finished in *arr) and Seerr
   * updating the MediaStatus to AVAILABLE.
   */
  public wasRecentlyDownloading(
    mediaType: MediaType,
    externalId: number
  ): boolean {
    const key = `${mediaType}:${externalId}`;
    const ts = this.recentlyCompleted.get(key);
    if (ts === undefined) return false;
    return Date.now() - ts < DownloadTracker.RECENTLY_COMPLETED_TTL_MS;
  }

  /**
   * Ensure the download cache is reasonably fresh.  If the last successful
   * update was more than {@link maxAgeMs} milliseconds ago, a full update is
   * triggered.  Concurrent callers share the same in-flight promise so that
   * we never fire duplicate requests against Radarr / Sonarr.
   *
   * @param maxAgeMs  Maximum age of the cache in milliseconds before a
   *                  refresh is triggered.  Defaults to 30 000 ms (30 s).
   */
  public async updateIfStale(maxAgeMs = 30_000): Promise<void> {
    if (Date.now() - this.lastUpdated <= maxAgeMs) {
      return;
    }
    // Coalesce concurrent callers behind the same promise
    if (!this.updateInProgress) {
      this.updateInProgress = this.updateDownloads().finally(() => {
        this.updateInProgress = null;
      });
    }
    await this.updateInProgress;
  }

  public async updateDownloads() {
    // Snapshot current externalIds so we can detect items that leave the queue
    const prevRadarrIds = this.collectExternalIds(this.radarrServers, MediaType.MOVIE);
    const prevSonarrIds = this.collectExternalIds(this.sonarrServers, MediaType.TV);

    await this.updateRadarrDownloads();
    await this.updateSonarrDownloads();

    // Detect items that left the queue → mark them as recently completed
    const newRadarrIds = this.collectExternalIds(this.radarrServers, MediaType.MOVIE);
    const newSonarrIds = this.collectExternalIds(this.sonarrServers, MediaType.TV);
    const now = Date.now();

    for (const key of prevRadarrIds) {
      if (!newRadarrIds.has(key)) {
        this.recentlyCompleted.set(key, now);
      }
    }
    for (const key of prevSonarrIds) {
      if (!newSonarrIds.has(key)) {
        this.recentlyCompleted.set(key, now);
      }
    }

    // Notify listener when downloads have left the queue so a targeted
    // media-server library scan can be triggered promptly.
    const hasNewCompletions =
      [...prevRadarrIds].some((k) => !newRadarrIds.has(k)) ||
      [...prevSonarrIds].some((k) => !newSonarrIds.has(k));
    if (hasNewCompletions && this.onDownloadsCompleted) {
      try {
        this.onDownloadsCompleted();
      } catch {
        // Fire-and-forget; errors are logged by the callback itself.
      }
    }

    // Items that are back in the queue should be removed from recently completed
    for (const key of newRadarrIds) {
      this.recentlyCompleted.delete(key);
    }
    for (const key of newSonarrIds) {
      this.recentlyCompleted.delete(key);
    }

    // Prune stale entries
    const cutoff = now - DownloadTracker.RECENTLY_COMPLETED_TTL_MS;
    for (const [key, ts] of this.recentlyCompleted) {
      if (ts < cutoff) {
        this.recentlyCompleted.delete(key);
      }
    }

    this.lastUpdated = Date.now();
  }

  /**
   * Collect all unique `${mediaType}:${externalId}` keys from a server map.
   */
  private collectExternalIds(
    servers: Record<number, DownloadingItem[]>,
    mediaType: MediaType
  ): Set<string> {
    const ids = new Set<string>();
    for (const items of Object.values(servers)) {
      for (const item of items) {
        ids.add(`${mediaType}:${item.externalId}`);
      }
    }
    return ids;
  }

  private async updateRadarrDownloads() {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.radarr, (radarrA, radarrB) => {
      return (
        radarrA.hostname === radarrB.hostname &&
        radarrA.port === radarrB.port &&
        radarrA.baseUrl === radarrB.baseUrl
      );
    });

    // Load downloads from Radarr servers
    await Promise.all(
      filteredServers.map(async (server) => {
        const radarr = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });

        // Refresh monitored downloads in a separate try/catch so that a
        // failure here (e.g. insufficient API-key permissions to POST to
        // /command) does NOT prevent the queue from being fetched below.
        try {
          await radarr.refreshMonitoredDownloads();
        } catch (e) {
          logger.warn(
            `Unable to refresh monitored downloads for Radarr server: ${server.name}. Queue will still be fetched. Cause: ${e.message}`,
            { label: 'Download Tracker' }
          );
        }

        try {
          const queueItems = await radarr.getQueue();

          this.radarrServers[server.id] = queueItems.map((item) => ({
            externalId: item.movieId,
            estimatedCompletionTime: new Date(item.estimatedCompletionTime),
            mediaType: MediaType.MOVIE,
            size: item.size,
            sizeLeft: item.sizeleft,
            status: item.status,
            trackedDownloadStatus: item.trackedDownloadStatus,
            trackedDownloadState: item.trackedDownloadState,
            timeLeft: item.timeleft,
            title: item.title,
            downloadId: item.downloadId,
          }));

          if (queueItems.length > 0) {
            logger.debug(
              `Found ${queueItems.length} item(s) in progress on Radarr server: ${server.name}`,
              { label: 'Download Tracker' }
            );
          }
        } catch {
          logger.error(
            `Unable to get queue from Radarr server: ${server.name}`,
            {
              label: 'Download Tracker',
            }
          );
        }

        // Duplicate this data to matching servers
        const matchingServers = settings.radarr.filter(
          (rs) =>
            rs.hostname === server.hostname &&
            rs.port === server.port &&
            rs.baseUrl === server.baseUrl &&
            rs.id !== server.id
        );

        if (matchingServers.length > 0) {
          logger.debug(
            `Matching download data to ${matchingServers.length} other Radarr server(s)`,
            { label: 'Download Tracker' }
          );
        }

        matchingServers.forEach((ms) => {
          this.radarrServers[ms.id] = this.radarrServers[server.id];
        });
      })
    );
  }

  private async updateSonarrDownloads() {
    const settings = getSettings();

    // Remove duplicate servers
    const filteredServers = uniqWith(settings.sonarr, (sonarrA, sonarrB) => {
      return (
        sonarrA.hostname === sonarrB.hostname &&
        sonarrA.port === sonarrB.port &&
        sonarrA.baseUrl === sonarrB.baseUrl
      );
    });

    // Load downloads from Sonarr servers
    await Promise.all(
      filteredServers.map(async (server) => {
        const sonarr = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });

        // Refresh monitored downloads in a separate try/catch so that a
        // failure here (e.g. insufficient API-key permissions to POST to
        // /command) does NOT prevent the queue from being fetched below.
        try {
          await sonarr.refreshMonitoredDownloads();
        } catch (e) {
          logger.warn(
            `Unable to refresh monitored downloads for Sonarr server: ${server.name}. Queue will still be fetched. Cause: ${e.message}`,
            { label: 'Download Tracker' }
          );
        }

        try {
          const queueItems = await sonarr.getQueue();

          this.sonarrServers[server.id] = queueItems.map((item) => ({
            externalId: item.seriesId,
            estimatedCompletionTime: new Date(item.estimatedCompletionTime),
            mediaType: MediaType.TV,
            size: item.size,
            sizeLeft: item.sizeleft,
            status: item.status,
            trackedDownloadStatus: item.trackedDownloadStatus,
            trackedDownloadState: item.trackedDownloadState,
            timeLeft: item.timeleft,
            title: item.title,
            episode: item.episode,
            downloadId: item.downloadId,
          }));

          if (queueItems.length > 0) {
            logger.debug(
              `Found ${queueItems.length} item(s) in progress on Sonarr server: ${server.name}`,
              { label: 'Download Tracker' }
            );
          }
        } catch {
          logger.error(
            `Unable to get queue from Sonarr server: ${server.name}`,
            {
              label: 'Download Tracker',
            }
          );
        }

        // Duplicate this data to matching servers
        const matchingServers = settings.sonarr.filter(
          (ss) =>
            ss.hostname === server.hostname &&
            ss.port === server.port &&
            ss.baseUrl === server.baseUrl &&
            ss.id !== server.id
        );

        if (matchingServers.length > 0) {
          logger.debug(
            `Matching download data to ${matchingServers.length} other Sonarr server(s)`,
            { label: 'Download Tracker' }
          );
        }

        matchingServers.forEach((ms) => {
          this.sonarrServers[ms.id] = this.sonarrServers[server.id];
        });
      })
    );
  }
}

const downloadTracker = new DownloadTracker();

export default downloadTracker;
