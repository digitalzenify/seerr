import { MediaStatus } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';

/** Statuses that indicate the media is still being processed and polling should continue. */
const TRANSITIONAL_STATUSES = new Set([
  MediaStatus.PROCESSING,
  MediaStatus.PENDING,
]);

export const refreshIntervalHelper = (
  downloadItem: {
    downloadStatus: DownloadingItem[] | undefined;
    downloadStatus4k: DownloadingItem[] | undefined;
    status?: MediaStatus;
    status4k?: MediaStatus;
  },
  timer: number
) => {
  // Poll when there are active download queue items
  if (
    (downloadItem.downloadStatus ?? []).length > 0 ||
    (downloadItem.downloadStatus4k ?? []).length > 0
  ) {
    return timer;
  }

  // Keep polling when media is in a transitional state (e.g. downloading
  // just finished, import in progress, or waiting for library scan).
  // This prevents the UI from getting stuck on stale statuses like
  // "Waiting for Release" after a download completes.
  if (
    TRANSITIONAL_STATUSES.has(downloadItem.status ?? MediaStatus.UNKNOWN) ||
    TRANSITIONAL_STATUSES.has(downloadItem.status4k ?? MediaStatus.UNKNOWN)
  ) {
    return timer;
  }

  return 0;
};
