import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

// ---------------------------------------------------------------------------
// Mock @server/lib/settings so PlexAPI constructor doesn't need a real config
// ---------------------------------------------------------------------------

const mockPlexSettings = {
  name: 'Test Plex',
  ip: '127.0.0.1',
  port: 32400,
  useSsl: false,
  libraries: [],
  authToken: 'settings-token',
};

const mockGetSettings = () => ({
  plex: mockPlexSettings,
  clientId: 'test-client-id',
  save: async () => {},
});

await mock.module('@server/lib/settings', {
  namedExports: { getSettings: mockGetSettings },
});

// Import PlexAPI AFTER mocking settings
const { default: PlexAPI } = await import('@server/api/plexapi');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(tokenOverride?: string | null, ipOverride?: string) {
  const settings = { ...mockPlexSettings };
  if (ipOverride) settings.ip = ipOverride;

  const client = new PlexAPI({
    plexToken: tokenOverride,
    plexSettings: settings as any,
  });
  return client;
}

function patchAxios(client: InstanceType<typeof PlexAPI>, data: unknown) {
  (client as any).axios = {
    get: async (_url: string, _config?: unknown) => ({ data }),
  };
}

function patchAxiosError(
  client: InstanceType<typeof PlexAPI>,
  status: number
) {
  const err = Object.assign(new Error(`HTTP ${status}`), {
    response: { status },
  });
  (client as any).axios = {
    get: async () => { throw err; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlexAPI', () => {
  beforeEach(() => {
    // Clear circuit breaker state between tests by using unique IPs
  });

  describe('getToken', () => {
    it('returns the explicit token when provided', () => {
      const client = makeClient('explicit-token');
      assert.equal(client.getToken(), 'explicit-token');
    });

    it('falls back to authToken from plexSettings', () => {
      const client = makeClient(null);
      assert.equal(client.getToken(), 'settings-token');
    });

    it('falls back to empty string when no token available', () => {
      const client = new PlexAPI({
        plexSettings: { ...mockPlexSettings, authToken: undefined } as any,
      });
      assert.equal(client.getToken(), '');
    });
  });

  describe('getIdentity', () => {
    it('returns identity with machineIdentifier', async () => {
      const client = makeClient('tok', '10.0.0.1');
      patchAxios(client, {
        MediaContainer: {
          machineIdentifier: 'abc123',
          friendlyName: 'My Plex',
          version: '1.32.0',
          platform: 'Linux',
          platformVersion: '5.10',
        },
      });
      const result = await client.getIdentity();
      assert.equal(result.MediaContainer.machineIdentifier, 'abc123');
      assert.equal(result.MediaContainer.friendlyName, 'My Plex');
    });
  });

  describe('getStatus', () => {
    it('returns status with machineIdentifier', async () => {
      const client = makeClient('tok', '10.0.0.2');
      patchAxios(client, {
        MediaContainer: { machineIdentifier: 'xyz', friendlyName: 'Plex' },
      });
      const result = await client.getStatus();
      assert.equal(result.MediaContainer.machineIdentifier, 'xyz');
    });
  });

  describe('getLibraries', () => {
    it('returns the Directory array', async () => {
      const client = makeClient('tok', '10.0.0.3');
      patchAxios(client, {
        MediaContainer: {
          Directory: [
            { type: 'movie', key: '1', title: 'Movies', agent: 'tv.plex.agents.movie' },
            { type: 'show', key: '2', title: 'TV', agent: 'tv.plex.agents.series' },
          ],
        },
      });
      const libs = await client.getLibraries();
      assert.equal(libs.length, 2);
      assert.equal(libs[0].type, 'movie');
      assert.equal(libs[1].key, '2');
    });
  });

  describe('getLibraryContents', () => {
    it('returns totalSize and items', async () => {
      const client = makeClient('tok', '10.0.0.4');
      patchAxios(client, {
        MediaContainer: {
          totalSize: 42,
          Metadata: [
            { ratingKey: '1', title: 'Film', type: 'movie', guid: 'g1', addedAt: 0, updatedAt: 0, Media: [] },
          ],
        },
      });
      const result = await client.getLibraryContents('1');
      assert.equal(result.totalSize, 42);
      assert.equal(result.items[0].ratingKey, '1');
    });

    it('returns empty items array when Metadata is absent', async () => {
      const client = makeClient('tok', '10.0.0.5');
      patchAxios(client, {
        MediaContainer: { totalSize: 0 },
      });
      const result = await client.getLibraryContents('1');
      assert.deepEqual(result.items, []);
    });
  });

  describe('getSessions', () => {
    it('returns empty array when no Metadata', async () => {
      const client = makeClient('tok', '10.0.0.6');
      patchAxios(client, { MediaContainer: { size: 0 } });
      const sessions = await client.getSessions();
      assert.deepEqual(sessions, []);
    });

    it('returns sessions when present', async () => {
      const client = makeClient('tok', '10.0.0.7');
      patchAxios(client, {
        MediaContainer: {
          size: 1,
          Metadata: [{ ratingKey: '9', title: 'Active Movie', type: 'movie' }],
        },
      });
      const sessions = await client.getSessions();
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].ratingKey, '9');
    });
  });

  describe('getPlaylists', () => {
    it('returns empty array when no Metadata', async () => {
      const client = makeClient('tok', '10.0.0.8');
      patchAxios(client, { MediaContainer: { size: 0 } });
      assert.deepEqual(await client.getPlaylists(), []);
    });

    it('returns playlists when present', async () => {
      const client = makeClient('tok', '10.0.0.9');
      patchAxios(client, {
        MediaContainer: {
          size: 1,
          Metadata: [{ ratingKey: 'p1', title: 'My Playlist', type: 'playlist', leafCount: 5, duration: 3600, addedAt: 0, updatedAt: 0 }],
        },
      });
      const lists = await client.getPlaylists();
      assert.equal(lists[0].title, 'My Playlist');
    });
  });

  describe('getHubs', () => {
    it('returns hub array', async () => {
      const client = makeClient('tok', '10.0.0.10');
      patchAxios(client, {
        MediaContainer: {
          size: 1,
          Hub: [{ key: '/hubs/home', title: 'Recently Added', type: 'mixed', hubKey: '/hubs/home', size: 3 }],
        },
      });
      const hubs = await client.getHubs();
      assert.equal(hubs.length, 1);
      assert.equal(hubs[0].title, 'Recently Added');
    });
  });

  describe('getPrefs', () => {
    it('normalises Setting array to key-value map', async () => {
      const client = makeClient('tok', '10.0.0.11');
      patchAxios(client, {
        MediaContainer: {
          Setting: [
            { id: 'FriendlyName', value: 'My Server' },
            { id: 'AllowMediaDeletion', value: true },
            { id: 'MaxConnections', value: 10 },
          ],
        },
      });
      const prefs = await client.getPrefs();
      assert.equal(prefs['FriendlyName'], 'My Server');
      assert.equal(prefs['AllowMediaDeletion'], true);
      assert.equal(prefs['MaxConnections'], 10);
    });

    it('returns empty object when no Setting', async () => {
      const client = makeClient('tok', '10.0.0.12');
      patchAxios(client, { MediaContainer: {} });
      assert.deepEqual(await client.getPrefs(), {});
    });
  });

  describe('circuit breaker', () => {
    it('opens after repeated 5xx and throws circuit breaker error', async () => {
      // Use a unique IP to avoid interfering with other tests
      const client = makeClient('tok', 'circuit-host-unique');
      patchAxiosError(client, 500);

      let circuitOpened = false;
      // Keep calling with maxRetries=0 until circuit opens
      for (let i = 0; i < 20; i++) {
        try {
          await (client as any).withRetry(() => client.getStatus(), 0);
        } catch (e: any) {
          if (e.message?.includes('circuit breaker')) {
            circuitOpened = true;
            break;
          }
        }
      }
      assert.ok(circuitOpened, 'Circuit breaker should open after repeated 5xx');
    });

    it('does not retry on 4xx errors', async () => {
      const client = makeClient('tok', '10.0.0.13');
      let callCount = 0;
      const err = Object.assign(new Error('Unauthorized'), {
        response: { status: 401 },
      });
      (client as any).axios = {
        get: async () => {
          callCount += 1;
          throw err;
        },
      };

      await assert.rejects(
        () => (client as any).withRetry(() => client.getStatus(), 3),
        /Unauthorized/
      );
      // Should not retry on 4xx - only one call
      assert.equal(callCount, 1);
    });
  });
});

