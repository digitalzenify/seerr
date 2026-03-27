import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
} from '@server/constants/media';
import { MediaType } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { computeEnhancedStatus } from '@server/lib/enhancedStatus';

// ──────────────────────────────────────────────
// Fixture helpers
// ──────────────────────────────────────────────

const noDownloads: DownloadingItem[] = [];

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
  it('returns partially_available when MediaStatus is PARTIALLY_AVAILABLE', () => {
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PARTIALLY_AVAILABLE,
      noDownloads
    );
    assert.equal(result.status, 'partially_available');
    assert.equal(result.label, 'Partially Available');
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

  it('uses the most-progressed item when multiple downloads exist', () => {
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
    assert.equal(result.progress, 80);
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

  // ── Attention Needed ───────────────────────────────────────────────────
  it('returns attention_needed when trackedDownloadStatus is warning', () => {
    const download = makeDownload({ trackedDownloadStatus: 'warning' });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'attention_needed');
    assert.equal(result.label, 'Attention Needed');
  });

  it('returns attention_needed when trackedDownloadStatus is error', () => {
    const download = makeDownload({ trackedDownloadStatus: 'error' });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'attention_needed');
  });

  it('prioritises attention_needed over importing', () => {
    const download = makeDownload({
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
    });
    const result = computeEnhancedStatus(
      MediaRequestStatus.APPROVED,
      MediaStatus.PROCESSING,
      [download]
    );
    assert.equal(result.status, 'attention_needed');
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
});
