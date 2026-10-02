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
 * 2. ATTENTION_NEEDED — a queue item is genuinely stuck. A concrete failure
 *    (trackedDownloadStatus 'error' or trackedDownloadState 'importfailed')
 *    raises this immediately; a mere 'warning' / 'importblocked' item only
 *    does once it has persisted for at least ATTENTION_PERSIST_MS, because
 *    transient warnings during import are common and a two-minute hiccup
 *    should not look like a stuck download.
 *
 * 3. IMPORTING — download is "complete" from the torrent/usenet client's
 *    perspective but the file has not yet been imported into the media
 *    library. Detected via trackedDownloadState ∈ { importPending,
 *    importing, importblocked } or status === 'completed'. Usually brief.
 *
 * 4. DOWNLOADING — active queue item(s) without an error or import state.
 *    Progress (0-100) is aggregated over every queue item of the request
 *    (total downloaded bytes / total size) so the label, the progress bar
 *    and the episode tag all describe the same set of downloads.
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
 * Season-awareness:
 * - When `requestedSeasons` is passed, only queue items belonging to those
 *   seasons are considered, so an S03 download no longer marks an S01
 *   request as "Downloading". Queue items without episode info are kept.
 *
 * Limitations:
 * - We do not make live TMDB / *arr calls. All information comes from
 *   already-synced data (Media entity + DownloadTracker cache).
 * - "Waiting for release" and "Waiting for a match" share the same
 *   MediaStatus.PROCESSING bucket; distinguishing them precisely would
 *   require the release date from TMDB, which is out of scope here.
 * - The persistence check behind ATTENTION_NEEDED relies on the
 *   DownloadTracker's per-download state tracking and resets when Seerr
 *   restarts.
 */

import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
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

export interface EnhancedStatusEpisode {
  seasonNumber: number;
  /**
   * Only set when the download is a single episode; season packs and
   * multi-episode downloads report the season only.
   */
  episodeNumber?: number;
}

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
  /**
   * Representative episode/season for the badge: SxxEyy for a single
   * episode, Sxx only for season packs / multi-episode sets.
   */
  episode?: EnhancedStatusEpisode;
}

export interface ComputeEnhancedStatusOptions {
  /**
   * Season numbers of the request this status is computed for (TV only).
   * When set, queue items for other seasons are ignored.
   */
  requestedSeasons?: number[];
  /** Injectable clock (epoch ms) for deterministic tests. */
  now?: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * How long a 'warning' / 'importblocked' state must persist before it is
 * treated as "stuck" rather than a transient hiccup.
 */
const ATTENTION_PERSIST_MS = 30 * 60 * 1000;

/**
 * States that indicate the download is finished but not yet imported.
 * All values are stored lowercase; comparisons use `.toLowerCase()` so
 * camelCase values from Radarr/Sonarr (e.g. 'importPending') are matched
 * correctly. 'importfailed' is NOT listed here — it is a hard failure and
 * is surfaced via ATTENTION_NEEDED instead.
 */
const IMPORTING_STATES = new Set([
  'importpending',
  'importing',
  'importblocked',
]);

function calcProgress(item: DownloadingItem): number {
  if (!item.size || item.size === 0) return 0;
  return Math.min(
    100,
    Math.round(((item.size - item.sizeLeft) / item.size) * 100)
  );
}

/** A concrete failure signal from the *arr queue item. */
function isErrored(item: DownloadingItem): boolean {
  return (
    (item.trackedDownloadStatus ?? '').toLowerCase() === 'error' ||
    (item.trackedDownloadState ?? '').toLowerCase() === 'importfailed'
  );
}

/** A warning signal that only counts as "stuck" once it has persisted. */
function isPersistentlyWarned(item: DownloadingItem, now: number): boolean {
  const warned =
    (item.trackedDownloadStatus ?? '').toLowerCase() === 'warning' ||
    (item.trackedDownloadState ?? '').toLowerCase() === 'importblocked';
  return warned && now - (item.stateSince ?? now) >= ATTENTION_PERSIST_MS;
}

/**
 * Pick a representative episode/season label for a set of queue items:
 * - single item → SxxEyy
 * - several items from one download (season pack) → Sxx
 * - several items from different downloads → Sxx when they all share a
 *   season, otherwise no label (mixed seasons describe no single request).
 */
function pickEpisode(
  items: DownloadingItem[]
): EnhancedStatusEpisode | undefined {
  const first = items[0];
  if (!first) return undefined;

  if (
    items.length > 1 &&
    items.every((d) => d.downloadId === first.downloadId)
  ) {
    return first.episode
      ? { seasonNumber: first.episode.seasonNumber }
      : undefined;
  }
  if (items.length === 1) {
    return first.episode
      ? {
          seasonNumber: first.episode.seasonNumber,
          episodeNumber: first.episode.episodeNumber,
        }
      : undefined;
  }
  const seasons = new Set(
    items
      .map((d) => d.episode?.seasonNumber)
      .filter((s): s is number => s !== undefined)
  );
  if (seasons.size === 1) {
    return { seasonNumber: [...seasons][0] };
  }
  return undefined;
}

/** Aggregate progress over all queue items (0 when sizes are unknown). */
function aggregateProgress(items: DownloadingItem[]): number {
  const totalSize = items.reduce((sum, d) => sum + (d.size || 0), 0);
  if (totalSize === 0) return 0;
  const totalLeft = items.reduce(
    (sum, d) => sum + Math.min(Math.max(d.sizeLeft || 0, 0), d.size || 0),
    0
  );
  return Math.min(100, Math.round(((totalSize - totalLeft) / totalSize) * 100));
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
 * @param opts           Season filter and injectable clock (see
 *                       {@link ComputeEnhancedStatusOptions}).
 */
export function computeEnhancedStatus(
  requestStatus: MediaRequestStatus,
  mediaStatus: MediaStatus,
  downloads: DownloadingItem[],
  recentlyDownloaded = false,
  opts: ComputeEnhancedStatusOptions = {}
): EnhancedStatus {
  const now = opts.now ?? Date.now();

  // ── Season filter ───────────────────────────────────────────────────────
  // Only consider queue items belonging to the requested season(s); items
  // without episode info (e.g. failed grabs) are always kept.
  const items =
    opts.requestedSeasons && opts.requestedSeasons.length > 0
      ? downloads.filter(
          (d) =>
            !d.episode ||
            opts.requestedSeasons!.includes(d.episode.seasonNumber)
        )
      : downloads;

  // ── 1. Fully available ──────────────────────────────────────────────────
  if (mediaStatus === MediaStatus.AVAILABLE) {
    return { status: 'available', label: 'Available' };
  }

  // ── 2-4. Active queue items ──────────────────────────────────────────────
  // Checked BEFORE PARTIALLY_AVAILABLE so that a show with some seasons
  // already available still shows download progress for new seasons.
  if (items.length > 0) {
    // 2. Attention needed: concrete failure immediately, warning only when it
    // has persisted (transient warnings mid-import are common)
    const attentionItem =
      items.find(isErrored) ?? items.find((d) => isPersistentlyWarned(d, now));
    if (attentionItem) {
      return {
        status: 'attention_needed',
        label: 'Attention Needed',
        trackedDownloadState: attentionItem.trackedDownloadState,
      };
    }

    // 3. Importing: download finished, waiting for *arr to import the file
    const isImporting = items.some(
      (d) =>
        IMPORTING_STATES.has((d.trackedDownloadState ?? '').toLowerCase()) ||
        (d.status ?? '').toLowerCase() === 'completed'
    );
    if (isImporting) {
      const item =
        items.find(
          (d) =>
            IMPORTING_STATES.has(
              (d.trackedDownloadState ?? '').toLowerCase()
            ) || (d.status ?? '').toLowerCase() === 'completed'
        ) ?? items[0];
      return {
        status: 'importing',
        label: 'Importing',
        trackedDownloadState: item.trackedDownloadState,
      };
    }

    // 4. Actively downloading — aggregate progress across all queue items so
    // the label, the progress bar and the episode tag describe the same set
    const bestItem = [...items].sort(
      (a, b) => calcProgress(b) - calcProgress(a)
    )[0];
    const progress = aggregateProgress(items);

    return {
      status: 'downloading',
      label: `Downloading${progress > 0 ? ` ${progress}%` : ''}`,
      progress,
      sizeLeft: bestItem.sizeLeft,
      timeLeft: bestItem.timeLeft || undefined,
      eta: bestItem.estimatedCompletionTime || undefined,
      trackedDownloadState: bestItem.trackedDownloadState,
      episode: pickEpisode(items),
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
