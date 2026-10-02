import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { computeEnhancedStatus } from '@server/lib/enhancedStatus';

// ──────────────────────────────────────────────
// Fixture helpers
// ──────────────────────────────────────────────

const noDownloads: DownloadingItem[] = [];

/** Fixed clock so persistence-based assertions are deterministic. */
const NOW = 1_800_000_000_000;
/** A timestamp 31 minutes before NOW — past the 30-minute persistence gate. */
const PERSISTED = NOW - 31 * 60 * 1000;

function makeDownload(
  overrides: Partial<DownloadingItem> = {}
): DownloadingItem {
  return {
    mediaType: MediaType.MOVIE,
    externalId: 1,
    size: 1000,
    sizeLeft: 500,
    status: 'downloading',
    trackedDownloadStatus: 'ok',
    trackedDownloadState: 'downloading',
    timeLeft: '00:10:00',
    estimatedCompletionTime: new Date('2099-01-01'),
    title: 'Test Movie',
    downloadId: 'abc123',
    ...overrides,
  };
}

function makeEpisode(seasonNumber: number, episodeNumber: number) {
  return {
    seasonNumber,
    episodeNumber,
    absoluteEpisodeNumber: episodeNumber,
    id: episodeNumber,
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('computeEnhancedStatus', () => {
  // ── Available ──────────────────────────────────────────────────────────
  it('returns available when MediaStatus is AVAILABLE', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.COMPLETED,
      MediaStatus.AVAILABLE,
      noDownloads
    );
    assert.equal(result.status, 'available');
    assert.equal(result.label, 'Available');
  });

  // ── Partially Available ────────────────────────────────────────────────
  it('returns partially_available when MediaStatus is PARTIALLY_AVAILABLE and no downloads', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PARTIALLY_AVAILABLE,
      noDownloads
    );
    assert.equal(result.status, 'partially_available');
    assert.equal(result.label, 'Partially Available');
  });

  it('returns downloading when PARTIALLY_AVAILABLE but active downloads exist', () => {
    const download = makeDownload({ size: 1000, sizeLeft: 400 }); // 60%
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PARTIALLY_AVAILABLE,
      [download]
    );
    assert.equal(result.status, 'downloading');
    assert.equal(result.progress, 60);
  });

  it('returns importing when PARTIALLY_AVAILABLE and download is in import state', () => {
    const download = makeDownload({
      trackedDownloadState: 'importPending',
      status: 'completed',
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PARTIALLY_AVAILABLE,
      [download]
    );
    assert.equal(result.status, 'importing');
  });

  it('returns attention_needed when PARTIALLY_AVAILABLE and download has a persisted warning', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'warning',
      stateSince: PERSISTED,
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PARTIALLY_AVAILABLE,
      [download],
      false,
      { now: NOW }
    );
    assert.equal(result.status, 'attention_needed');
  });

  // ── Downloading ────────────────────────────────────────────────────────
  it('returns downloading with progress when there is an active queue item', () => {
    const download = makeDownload({ size: 1000, sizeLeft: 580 }); // 42%
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'downloading');
    assert.equal(result.progress, 42);
    assert.ok(result.label.includes('42'));
    assert.equal(result.sizeLeft, 580);
    assert.equal(result.timeLeft, '00:10:00');
  });

  it('returns downloading with 0% progress when size is unknown', () => {
    const download = makeDownload({ size: 0, sizeLeft: 0 });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'downloading');
    assert.equal(result.progress, 0);
  });

  it('aggregates progress across multiple downloads', () => {
    const downloads = [
      makeDownload({ size: 1000, sizeLeft: 900 }), // 10%
      makeDownload({ size: 1000, sizeLeft: 200 }), // 80%
    ];
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      downloads
    );
    assert.equal(result.status, 'downloading');
    // (2000 - 1100) / 2000 = 45%
    assert.equal(result.progress, 45);
  });

  it('weights aggregated progress by item size', () => {
    const downloads = [
      makeDownload({ size: 2000, sizeLeft: 1000 }), // 50% of 2 GB
      makeDownload({ size: 1000, sizeLeft: 0 }), // 100% of 1 GB
    ];
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      downloads
    );
    // (3000 - 1000) / 3000 = 67%
    assert.equal(result.progress, 67);
  });

  // ── Importing ──────────────────────────────────────────────────────────
  it('returns importing when trackedDownloadState is importPending', () => {
    const download = makeDownload({
      trackedDownloadState: 'importPending',
      status: 'completed',
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'importing');
    assert.equal(result.label, 'Importing');
  });

  it('returns importing when trackedDownloadState is importing', () => {
    const download = makeDownload({ trackedDownloadState: 'importing' });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'importing');
  });

  it('returns importing when queue status is completed (file done, not yet imported)', () => {
    const download = makeDownload({
      status: 'completed',
      trackedDownloadState: 'downloading',
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'importing');
  });

  it('returns importing when trackedDownloadState is importblocked (fresh)', () => {
    const download = makeDownload({ trackedDownloadState: 'importblocked' });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { now: NOW }
    );
    assert.equal(result.status, 'importing');
  });

  it('returns importing for a fresh warning during import', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
      stateSince: NOW - 60 * 1000, // 1 minute old
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { now: NOW }
    );
    assert.equal(result.status, 'importing');
  });

  // ── Attention Needed ───────────────────────────────────────────────────
  it('does not raise attention_needed for a fresh warning', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'warning',
      stateSince: NOW - 60 * 1000, // 1 minute old
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { now: NOW }
    );
    assert.notEqual(result.status, 'attention_needed');
  });

  it('raises attention_needed once a warning has persisted for 30+ minutes', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'warning',
      stateSince: PERSISTED,
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { now: NOW }
    );
    assert.equal(result.status, 'attention_needed');
    assert.equal(result.label, 'Attention Needed');
  });

  it('raises attention_needed when importblocked persists for 30+ minutes', () => {
    const download = makeDownload({
      trackedDownloadState: 'importblocked',
      stateSince: PERSISTED,
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { now: NOW }
    );
    assert.equal(result.status, 'attention_needed');
  });

  it('returns attention_needed immediately when trackedDownloadStatus is error', () => {
    const download = makeDownload({ trackedDownloadStatus: 'error' });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'attention_needed');
  });

  it('returns attention_needed immediately when trackedDownloadState is importfailed', () => {
    const download = makeDownload({ trackedDownloadState: 'importfailed' });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'attention_needed');
  });

  it('prioritises attention_needed (error) over importing', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'error',
      trackedDownloadState: 'importPending',
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'attention_needed');
  });

  it('prioritises persisted attention_needed (warning) over importing', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
      stateSince: PERSISTED,
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { now: NOW }
    );
    assert.equal(result.status, 'attention_needed');
  });

  // ── Season filtering ───────────────────────────────────────────────────
  it('ignores downloads for other seasons when requestedSeasons is set', () => {
    const download = makeDownload({
      mediaType: MediaType.TV,
      episode: makeEpisode(3, 5),
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { requestedSeasons: [1] }
    );
    assert.equal(result.status, 'waiting_for_release');
  });

  it('keeps downloads for the requested season', () => {
    const download = makeDownload({
      mediaType: MediaType.TV,
      episode: makeEpisode(1, 5),
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { requestedSeasons: [1] }
    );
    assert.equal(result.status, 'downloading');
  });

  it('keeps queue items without episode info regardless of the season filter', () => {
    const download = makeDownload({ mediaType: MediaType.TV });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { requestedSeasons: [1] }
    );
    assert.equal(result.status, 'downloading');
  });

  it('does not filter when requestedSeasons is empty', () => {
    const download = makeDownload({
      mediaType: MediaType.TV,
      episode: makeEpisode(3, 5),
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download],
      false,
      { requestedSeasons: [] }
    );
    assert.equal(result.status, 'downloading');
  });

  // ── Episode label ──────────────────────────────────────────────────────
  it('reports SxxEyy for a single-episode download', () => {
    const download = makeDownload({
      mediaType: MediaType.TV,
      episode: makeEpisode(2, 7),
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.deepEqual(result.episode, { seasonNumber: 2, episodeNumber: 7 });
  });

  it('reports season only for a multi-episode set from one download', () => {
    const downloads = [
      makeDownload({
        mediaType: MediaType.TV,
        downloadId: 'pack1',
        episode: makeEpisode(2, 7),
      }),
      makeDownload({
        mediaType: MediaType.TV,
        downloadId: 'pack1',
        episode: makeEpisode(2, 8),
      }),
    ];
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      downloads
    );
    assert.deepEqual(result.episode, { seasonNumber: 2 });
  });

  it('reports season only when distinct downloads share one season', () => {
    const downloads = [
      makeDownload({
        mediaType: MediaType.TV,
        downloadId: 'a',
        episode: makeEpisode(2, 7),
      }),
      makeDownload({
        mediaType: MediaType.TV,
        downloadId: 'b',
        episode: makeEpisode(2, 9),
      }),
    ];
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      downloads
    );
    assert.deepEqual(result.episode, { seasonNumber: 2 });
  });

  it('reports no episode label for downloads spanning multiple seasons', () => {
    const downloads = [
      makeDownload({
        mediaType: MediaType.TV,
        downloadId: 'a',
        episode: makeEpisode(1, 7),
      }),
      makeDownload({
        mediaType: MediaType.TV,
        downloadId: 'b',
        episode: makeEpisode(2, 1),
      }),
    ];
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      downloads
    );
    assert.equal(result.episode, undefined);
  });

  // ── Waiting for release ────────────────────────────────────────────────
  it('returns waiting_for_release when PROCESSING and no downloads', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      noDownloads
    );
    assert.equal(result.status, 'waiting_for_release');
    assert.equal(result.label, 'Waiting for Release');
  });

  // ── Recently downloaded → importing (not waiting for release) ──────────
  it('returns importing when PROCESSING, no downloads, but recently downloaded', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      noDownloads,
      true // recentlyDownloaded
    );
    assert.equal(result.status, 'importing');
    assert.equal(result.label, 'Importing');
  });

  it('returns waiting_for_release when PROCESSING, no downloads, and NOT recently downloaded', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      noDownloads,
      false
    );
    assert.equal(result.status, 'waiting_for_release');
  });

  // ── Waiting for a match ────────────────────────────────────────────────
  it('returns waiting_for_match when approved and media status is UNKNOWN', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.UNKNOWN,
      noDownloads
    );
    assert.equal(result.status, 'waiting_for_match');
    assert.equal(result.label, 'Waiting for a Match');
  });

  it('returns waiting_for_match when approved and media status is PENDING', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PENDING,
      noDownloads
    );
    assert.equal(result.status, 'waiting_for_match');
  });

  // ── Requested fallback ─────────────────────────────────────────────────
  it('returns requested when request is PENDING (not yet approved)', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.PENDING,
      MediaStatus.UNKNOWN,
      noDownloads
    );
    assert.equal(result.status, 'requested');
    assert.equal(result.label, 'Requested');
  });

  it('returns requested as fallback for ambiguous/no linked arr item', () => {
    // e.g. DECLINED request with no media state
    const result = computeEnhancedStatus(
      MediaRequestStatus.DECLINED,
      MediaStatus.UNKNOWN,
      noDownloads
    );
    assert.equal(result.status, 'requested');
  });

  it('returns requested for COMPLETED request with UNKNOWN media status', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.COMPLETED,
      MediaStatus.UNKNOWN,
      noDownloads
    );
    assert.equal(result.status, 'requested');
  });

  // ── Available takes precedence over downloads ──────────────────────────
  it('returns available even when download items are present (already in library)', () => {
    const download = makeDownload();
    const result = computeEnhancedStatus(
      MediaRequestStatus.COMPLETED,
      MediaStatus.AVAILABLE,
      [download]
    );
    assert.equal(result.status, 'available');
  });

  // ── Partially available does NOT take precedence over downloads ────────
  it('returns downloading when partially available with active downloads (new season)', () => {
    const download = makeDownload({
      mediaType: MediaType.TV,
      size: 2000,
      sizeLeft: 1000,
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PARTIALLY_AVAILABLE,
      [download]
    );
    assert.equal(result.status, 'downloading');
    assert.equal(result.progress, 50);
  });
});
