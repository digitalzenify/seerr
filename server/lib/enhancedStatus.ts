/**
 * Enhanced request-status computation
 * ====================================
 * Maps the combination of Seerr's internal MediaRequestStatus / MediaStatus
 * and live download-tracker data into a single, user-friendly label that is
 * surfaced on the request list and request-detail pages.
 *
 * Heuristics (evaluated in priority order):
 *
 * 1. FULLY AVAILABLE — driven purely by MediaStatus.AVAILABLE; no download
 *    data is needed.
 *
 * 2. ATTENTION_NEEDED — any queue item whose trackedDownloadStatus is
 *    'warning' or 'error'. Only raised when there is a concrete signal from
 *    the *arr queue; we never guess at failure.
 *
 * 3. IMPORTING — download is "complete" from the torrent/usenet client's
 *    perspective but the file has not yet been imported into the media
 *    library. Detected via trackedDownloadState ∈ { importPending,
 *    importing } or status === 'completed'. This state is usually brief.
 *
 * 4. DOWNLOADING — active queue item(s) without an error or import state.
 *    Progress (0-100), sizeLeft, timeLeft, and ETA are included when
 *    available.
 *
 * 5. PARTIALLY_AVAILABLE — MediaStatus.PARTIALLY_AVAILABLE with no active
 *    downloads. Checked after download states so that a partially available
 *    show with new seasons downloading correctly shows download progress
 *    instead of a misleading "Partially Available".
 *
 * 6. IMPORTING (post-queue) — MediaStatus.PROCESSING + no active downloads +
 *    the item was recently tracked in the download queue.  This bridges the
 *    gap between the queue item being removed (import done in *arr) and
 *    Seerr updating MediaStatus to AVAILABLE.
 *
 * 7. WAITING_FOR_RELEASE — MediaStatus.PROCESSING + no active downloads +
 *    the item was NOT recently in the download queue.
 *    The item has been added to Radarr/Sonarr (monitored) but no file
 *    exists and nothing is in the queue. The most common cause is a future
 *    release date or a release that hasn't been indexed yet.
 *
 * 8. WAITING_FOR_MATCH — MediaStatus.UNKNOWN + request is APPROVED.
 *    The item has not yet been picked up by the *arr scanner, meaning it
 *    either hasn't synced yet or truly has no indexer match.
 *
 * 9. REQUESTED — catch-all for PENDING requests and any edge-cases where
 *    not enough downstream state exists to be more specific.
 *
 * Limitations:
 * - We do not make live TMDB / *arr calls. All information comes from
 *   already-synced data (Media entity + DownloadTracker cache).
 * - "Waiting for release" and "Waiting for a match" share the same
 *   MediaStatus.PROCESSING bucket; distinguishing them precisely would
 *   require the release date from TMDB, which is out of scope here.
 * - TV shows report a single enhanced status for the whole series (or
 *   4K copy); per-season granularity is left to the existing Season entity.
 */

import {
  MediaRequestStatus,
  MediaStatus,
} from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';

// ──────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────

export type EnhancedStatusCode =
  | 'requested'
  | 'waiting_for_release'
  | 'waiting_for_match'
  | 'downloading'
  | 'importing'
  | 'available'
  | 'partially_available'
  | 'attention_needed';

export interface EnhancedStatus {
  /** Machine-readable status code. */
  status: EnhancedStatusCode;
  /** Human-friendly label suitable for direct display (no i18n key needed). */
  label: string;
  /**
   * Download progress as an integer 0-100. Only set when status is
   * 'downloading'.
   */
  progress?: number;
  /** Remaining download size in bytes. Only set when status is 'downloading'. */
  sizeLeft?: number;
  /** Human-readable time-left string from *arr (e.g. "00:42:10"). */
  timeLeft?: string;
  /** Estimated completion timestamp. */
  eta?: Date;
  /**
   * Raw trackedDownloadState from Radarr/Sonarr for the most relevant
   * queue item. Useful for debugging; not shown directly to users.
   */
  trackedDownloadState?: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * States that indicate the download is finished but not yet imported.
 * All values are stored lowercase; comparisons use `.toLowerCase()` so
 * camelCase values from Radarr/Sonarr (e.g. 'importPending') are matched
 * correctly.
 */
const IMPORTING_STATES = new Set([
  'importpending',
  'importing',
  'importblocked',
  'importfailed',
]);

/** trackedDownloadStatus values that represent a real error or warning. */
const ERROR_STATUSES = new Set(['warning', 'error']);

function calcProgress(item: DownloadingItem): number {
  if (!item.size || item.size === 0) return 0;
  return Math.min(100, Math.round(((item.size - item.sizeLeft) / item.size) * 100));
}

// ──────────────────────────────────────────────
// Core computation
// ──────────────────────────────────────────────

/**
 * Compute an {@link EnhancedStatus} for a single request.
 *
 * @param requestStatus  The Seerr MediaRequestStatus (PENDING, APPROVED, …)
 * @param mediaStatus    The MediaStatus of the linked Media entity
 *                       (use status or status4k depending on is4k)
 * @param downloads      DownloadingItem[] from the DownloadTracker for this
 *                       media item
 * @param recentlyDownloaded  When true, indicates the media was recently
 *                       tracked in the download queue.  This bridges the gap
 *                       between the queue item being removed after import and
 *                       Seerr updating MediaStatus to AVAILABLE.
 */
export function computeEnhancedStatus(
  requestStatus: MediaRequestStatus,
  mediaStatus: MediaStatus,
  downloads: DownloadingItem[],
  recentlyDownloaded = false
): EnhancedStatus {
  // ── 1. Fully available ──────────────────────────────────────────────────
  if (mediaStatus === MediaStatus.AVAILABLE) {
    return { status: 'available', label: 'Available' };
  }

  // ── 2-4. Active queue items ──────────────────────────────────────────────
  // Checked BEFORE PARTIALLY_AVAILABLE so that a show with some seasons
  // already available still shows download progress for new seasons.
  if (downloads.length > 0) {
    // 2. Attention needed: any queue item has a concrete error/warning signal
    const hasError = downloads.some((d) =>
      ERROR_STATUSES.has((d.trackedDownloadStatus ?? '').toLowerCase())
    );
    if (hasError) {
      const item = downloads.find((d) =>
        ERROR_STATUSES.has((d.trackedDownloadStatus ?? '').toLowerCase())
      )!;
      return {
        status: 'attention_needed',
        label: 'Attention Needed',
        trackedDownloadState: item.trackedDownloadState,
      };
    }

    // 3. Importing: download finished, waiting for *arr to import the file
    const isImporting = downloads.some(
      (d) =>
        IMPORTING_STATES.has((d.trackedDownloadState ?? '').toLowerCase()) ||
        (d.status ?? '').toLowerCase() === 'completed'
    );
    if (isImporting) {
      const item =
        downloads.find(
          (d) =>
            IMPORTING_STATES.has((d.trackedDownloadState ?? '').toLowerCase()) ||
            (d.status ?? '').toLowerCase() === 'completed'
        ) ?? downloads[0];
      return {
        status: 'importing',
        label: 'Importing',
        trackedDownloadState: item.trackedDownloadState,
      };
    }

    // 4. Actively downloading
    // Use the item with the most progress as the representative item
    const bestItem = [...downloads].sort(
      (a, b) => calcProgress(b) - calcProgress(a)
    )[0];
    const progress = calcProgress(bestItem);

    return {
      status: 'downloading',
      label: `Downloading${progress > 0 ? ` ${progress}%` : ''}`,
      progress,
      sizeLeft: bestItem.sizeLeft,
      timeLeft: bestItem.timeLeft || undefined,
      eta: bestItem.estimatedCompletionTime || undefined,
      trackedDownloadState: bestItem.trackedDownloadState,
    };
  }

  // ── 5. Partially available (no active downloads) ─────────────────────────
  if (mediaStatus === MediaStatus.PARTIALLY_AVAILABLE) {
    return { status: 'partially_available', label: 'Partially Available' };
  }

  // ── 6-8. No active downloads ─────────────────────────────────────────────

  // 6. Recently had a download that just left the queue → import is completing
  if (mediaStatus === MediaStatus.PROCESSING && recentlyDownloaded) {
    return { status: 'importing', label: 'Importing' };
  }

  // 7. In *arr but no file and not downloading → most likely waiting for release
  if (mediaStatus === MediaStatus.PROCESSING) {
    return { status: 'waiting_for_release', label: 'Waiting for Release' };
  }

  // 8. Approved but not yet picked up by the *arr scanner
  if (
    requestStatus === MediaRequestStatus.APPROVED &&
    (mediaStatus === MediaStatus.UNKNOWN || mediaStatus === MediaStatus.PENDING)
  ) {
    return { status: 'waiting_for_match', label: 'Waiting for a Match' };
  }

  // 9. Pending approval or any other fallback
  return { status: 'requested', label: 'Requested' };
}
