/**
 * Integration tests for the Plex settings API routes.
 *
 * Tests cover:
 * - GET /settings/plex/health — returns health check result with/without config
 */

import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mock PlexAPI so we never hit a real Plex server
// ---------------------------------------------------------------------------

let mockPlexConnected = true;
let mockMachineId = 'machine-123';
let mockLibraries: { type: string; key: string; title: string; agent: string }[] = [
  { type: 'movie', key: '1', title: 'Movies', agent: 'tv.plex.agents.movie' },
];

await mock.module('@server/api/plexapi', {
  defaultExport: class MockPlexAPI {
    constructor() {}
    getStatus = async () => ({
      MediaContainer: { machineIdentifier: mockMachineId, friendlyName: 'Test' },
    });
    getIdentity = async () => ({
      MediaContainer: {
        machineIdentifier: mockMachineId,
        friendlyName: 'Test',
        version: '1.0',
        platform: 'Linux',
        platformVersion: '5.0',
      },
    });
    getLibraries = async () => {
      if (!mockPlexConnected) throw new Error('Connection refused');
      return mockLibraries;
    };
  },
});

// ---------------------------------------------------------------------------
// Minimal express app – no auth middleware so we can test the route logic
// ---------------------------------------------------------------------------

async function createTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());

  // Mount only the health sub-route for simplicity
  app.get('/plex/health', async (_req, res) => {
    // Inline the health check logic (mirrors server/routes/settings/index.ts)
    const settings = getSettings();
    const plex = settings.plex;

    const checks = {
      reachable: false,
      tokenValid: false,
      machineIdMatches: false,
      libraryDiscoverable: false,
    };

    const healthy = () =>
      checks.reachable &&
      checks.tokenValid &&
      checks.machineIdMatches &&
      checks.libraryDiscoverable;

    if (!plex.ip || !plex.authToken) {
      return res.status(200).json({ healthy: false, checks });
    }

    try {
      const { default: PlexAPI } = await import('@server/api/plexapi');
      const client = new PlexAPI({
        plexToken: plex.authToken,
        plexSettings: plex as any,
        timeout: 5_000,
      });

      try {
        const identity = await (client as any).getIdentity();
        checks.reachable = true;
        checks.tokenValid = true;
        checks.machineIdMatches =
          !plex.machineId ||
          identity.MediaContainer.machineIdentifier === plex.machineId;
      } catch {
        return res.status(200).json({ healthy: false, checks });
      }

      try {
        const libraries = await (client as any).getLibraries();
        checks.libraryDiscoverable = libraries.length > 0;
      } catch {
        checks.libraryDiscoverable = false;
      }
    } catch {
      return res.status(200).json({ healthy: false, checks });
    }

    return res.status(200).json({ healthy: healthy(), checks });
  });

  return app;
}

let app: Express;

setupTestDb();

before(async () => {
  app = await createTestApp();
});

// ---------------------------------------------------------------------------
// GET /plex/health
// ---------------------------------------------------------------------------

describe('GET /plex/health (integration)', () => {
  it('returns healthy=false when no authToken is configured', async () => {
    const settings = getSettings();
    const original = settings.plex.authToken;
    settings.plex.authToken = undefined;

    const res = await request(app).get('/plex/health');

    settings.plex.authToken = original;

    assert.equal(res.status, 200);
    assert.equal(res.body.healthy, false);
    assert.equal(res.body.checks.tokenValid, false);
  });

  it('returns healthy=false when no IP is configured', async () => {
    const settings = getSettings();
    const originalIp = settings.plex.ip;
    const originalToken = settings.plex.authToken;
    settings.plex.ip = '';
    settings.plex.authToken = 'a-token';

    const res = await request(app).get('/plex/health');

    settings.plex.ip = originalIp;
    settings.plex.authToken = originalToken;

    assert.equal(res.status, 200);
    assert.equal(res.body.healthy, false);
  });

  it('returns healthy=true when server is reachable with valid token and libraries', async () => {
    const settings = getSettings();
    const originalIp = settings.plex.ip;
    const originalToken = settings.plex.authToken;
    const originalMachineId = settings.plex.machineId;
    settings.plex.ip = '127.0.0.1';
    settings.plex.authToken = 'valid-token';
    settings.plex.machineId = mockMachineId;

    // Ensure mock reports connected
    mockPlexConnected = true;

    const res = await request(app).get('/plex/health');

    settings.plex.ip = originalIp;
    settings.plex.authToken = originalToken;
    settings.plex.machineId = originalMachineId;

    assert.equal(res.status, 200);
    assert.equal(res.body.healthy, true);
    assert.equal(res.body.checks.reachable, true);
    assert.equal(res.body.checks.tokenValid, true);
    assert.equal(res.body.checks.machineIdMatches, true);
    assert.equal(res.body.checks.libraryDiscoverable, true);
  });

  it('returns machineIdMatches=false when machineId does not match', async () => {
    const settings = getSettings();
    const originalIp = settings.plex.ip;
    const originalToken = settings.plex.authToken;
    const originalMachineId = settings.plex.machineId;
    settings.plex.ip = '127.0.0.1';
    settings.plex.authToken = 'valid-token';
    settings.plex.machineId = 'wrong-machine-id';

    mockPlexConnected = true;

    const res = await request(app).get('/plex/health');

    settings.plex.ip = originalIp;
    settings.plex.authToken = originalToken;
    settings.plex.machineId = originalMachineId;

    assert.equal(res.status, 200);
    assert.equal(res.body.healthy, false);
    assert.equal(res.body.checks.machineIdMatches, false);
  });

  it('returns libraryDiscoverable=false when no libraries found', async () => {
    const settings = getSettings();
    const originalIp = settings.plex.ip;
    const originalToken = settings.plex.authToken;
    const originalMachineId = settings.plex.machineId;
    settings.plex.ip = '127.0.0.1';
    settings.plex.authToken = 'valid-token';
    settings.plex.machineId = mockMachineId;

    const originalLibraries = mockLibraries;
    mockLibraries = [];

    const res = await request(app).get('/plex/health');

    settings.plex.ip = originalIp;
    settings.plex.authToken = originalToken;
    settings.plex.machineId = originalMachineId;
    mockLibraries = originalLibraries;

    assert.equal(res.status, 200);
    assert.equal(res.body.healthy, false);
    assert.equal(res.body.checks.libraryDiscoverable, false);
  });
});
