import ExternalAPI from '@server/api/externalapi';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AxiosRequestConfig } from 'axios';

export interface PlexIdentityResponse {
  MediaContainer: {
    machineIdentifier: string;
    friendlyName: string;
    version: string;
    platform: string;
    platformVersion: string;
  };
}

interface PlexStatusResponse {
  MediaContainer: {
    machineIdentifier: string;
    friendlyName: string;
  };
}

export interface PlexLibraryItem {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  guid: string;
  parentGuid?: string;
  grandparentGuid?: string;
  addedAt: number;
  updatedAt: number;
  Guid?: {
    id: string;
  }[];
  type: 'movie' | 'show' | 'season' | 'episode';
  Media: Media[];
}

interface PlexLibraryResponse {
  MediaContainer: {
    totalSize: number;
    Metadata: PlexLibraryItem[];
  };
}

export interface PlexLibrary {
  type: 'show' | 'movie';
  key: string;
  title: string;
  agent: string;
}

interface PlexLibrariesResponse {
  MediaContainer: {
    Directory: PlexLibrary[];
  };
}

export interface PlexMetadata {
  ratingKey: string;
  parentRatingKey?: string;
  guid: string;
  type: 'movie' | 'show' | 'season';
  title: string;
  Guid: {
    id: string;
  }[];
  Children?: {
    size: 12;
    Metadata: PlexMetadata[];
  };
  index: number;
  parentIndex?: number;
  leafCount: number;
  viewedLeafCount: number;
  addedAt: number;
  updatedAt: number;
  Media: Media[];
}

interface Media {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
}

interface PlexMetadataResponse {
  MediaContainer: {
    Metadata: PlexMetadata[];
  };
}

export interface PlexSession {
  ratingKey: string;
  title: string;
  type: string;
  thumb?: string;
  User?: { id: string; title: string };
  Player?: { machineIdentifier: string; state: string; title: string };
  TranscodeSession?: {
    key: string;
    throttled: boolean;
    videoDecision: string;
    audioDecision: string;
  };
}

interface PlexSessionsResponse {
  MediaContainer: {
    size: number;
    Metadata?: PlexSession[];
  };
}

export interface PlexAccount {
  id: number;
  uuid: string;
  username: string;
  email: string;
  thumb: string;
  authToken: string;
}

interface PlexAccountResponse {
  MyPlex: {
    authToken: string;
    username: string;
    signInState: string;
    subscriptionActive: boolean;
  };
}

export interface PlexPlaylist {
  ratingKey: string;
  title: string;
  type: string;
  leafCount: number;
  duration: number;
  addedAt: number;
  updatedAt: number;
}

interface PlexPlaylistsResponse {
  MediaContainer: {
    size: number;
    Metadata?: PlexPlaylist[];
  };
}

export interface PlexHub {
  key: string;
  title: string;
  type: string;
  hubKey: string;
  size: number;
  Metadata?: PlexMetadata[];
}

interface PlexHubsResponse {
  MediaContainer: {
    size: number;
    Hub?: PlexHub[];
  };
}

export interface PlexPrefs {
  [key: string]: string | number | boolean;
}

interface PlexPrefsResponse {
  MediaContainer: {
    Setting?: {
      id: string;
      value: string | number | boolean;
    }[];
  };
}

/** Simple circuit breaker state shared per PlexAPI base URL */
const circuitState = new Map<
  string,
  { failures: number; openUntil: number }
>();

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 30_000;

class PlexAPI extends ExternalAPI {
  private baseUrl: string;
  private token: string;

  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string | null;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    const settingsPlex = plexSettings ?? settings.plex;

    const protocol = settingsPlex.useSsl ? 'https' : 'http';
    const baseUrl = `${protocol}://${settingsPlex.ip}:${settingsPlex.port}`;

    // Prefer the explicitly supplied token, fall back to settings authToken
    const resolvedToken =
      plexToken ?? settingsPlex.authToken ?? '';

    super(
      baseUrl,
      {},
      {
        timeout: timeout ?? 10_000,
        headers: {
          'X-Plex-Token': resolvedToken,
          'X-Plex-Client-Identifier': settings.clientId,
          'X-Plex-Product': 'Seerr',
          'X-Plex-Device-Name': 'Seerr',
          'X-Plex-Platform': 'Seerr',
          Accept: 'application/json',
        },
      }
    );

    this.baseUrl = baseUrl;
    this.token = resolvedToken;
  }

  /** Exponential backoff with jitter, up to maxRetries attempts on 5xx */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    const state = circuitState.get(this.baseUrl) ?? {
      failures: 0,
      openUntil: 0,
    };

    if (Date.now() < state.openUntil) {
      throw new Error(
        `Plex circuit breaker open until ${new Date(state.openUntil).toISOString()}`
      );
    }

    let lastError: Error = new Error('Unknown error');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        // Reset failures on success
        circuitState.set(this.baseUrl, { failures: 0, openUntil: 0 });
        return result;
      } catch (e) {
        lastError = e;
        const status = e?.response?.status ?? 0;
        if (status >= 500) {
          state.failures += 1;
          if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
            state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
            circuitState.set(this.baseUrl, state);
            logger.warn('Plex circuit breaker opened', {
              label: 'Plex API',
              baseUrl: this.baseUrl,
            });
            throw new Error('Plex circuit breaker opened after repeated 5xx');
          }
          circuitState.set(this.baseUrl, state);
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * 2 ** attempt + Math.random() * 200, 10_000);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        // Don't retry on 4xx
        throw e;
      }
    }
    throw lastError;
  }

  private async getWithRetry<T>(
    endpoint: string,
    config?: AxiosRequestConfig
  ): Promise<T> {
    return this.withRetry(() => this.get<T>(endpoint, config));
  }

  /** GET /identity — server identity (no auth required) */
  public async getIdentity(): Promise<PlexIdentityResponse> {
    return this.getWithRetry<PlexIdentityResponse>('/identity');
  }

  /** GET / — server info (same as legacy getStatus) */
  public async getStatus(): Promise<PlexStatusResponse> {
    return this.getWithRetry<PlexStatusResponse>('/');
  }

  /** GET /library/sections */
  public async getLibraries(): Promise<PlexLibrary[]> {
    const response =
      await this.getWithRetry<PlexLibrariesResponse>('/library/sections');
    return response.MediaContainer.Directory;
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const newLibraries: Library[] = libraries
        .filter(
          (library) => library.type === 'movie' || library.type === 'show'
        )
        .filter((library) => library.agent !== 'com.plexapp.agents.none')
        .map((library) => {
          const existing = settings.plex.libraries.find(
            (l) => l.id === library.key && l.name === library.title
          );

          return {
            id: library.key,
            name: library.title,
            enabled: existing?.enabled ?? false,
            type: library.type,
            lastScan: existing?.lastScan,
          };
        });

      settings.plex.libraries = newLibraries;
    } catch (e) {
      logger.error('Failed to fetch Plex libraries', {
        label: 'Plex API',
        message: e.message,
      });

      settings.plex.libraries = [];
    }

    await settings.save();
  }

  /** GET /library/sections/{id}/all */
  public async getLibraryContents(
    id: string,
    { offset = 0, size = 50 }: { offset?: number; size?: number } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const response = await this.getWithRetry<PlexLibraryResponse>(
      `/library/sections/${id}/all?includeGuids=1`,
      {
        headers: {
          'X-Plex-Container-Start': `${offset}`,
          'X-Plex-Container-Size': `${size}`,
        },
      }
    );

    return {
      totalSize: response.MediaContainer.totalSize,
      items: response.MediaContainer.Metadata ?? [],
    };
  }

  /** GET /library/metadata/{ratingKey} */
  public async getMetadata(
    key: string,
    options: { includeChildren?: boolean } = {}
  ): Promise<PlexMetadata> {
    const response = await this.getWithRetry<PlexMetadataResponse>(
      `/library/metadata/${key}${
        options.includeChildren ? '?includeChildren=1' : ''
      }`
    );

    return response.MediaContainer.Metadata[0];
  }

  public async getChildrenMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.getWithRetry<PlexMetadataResponse>(
      `/library/metadata/${key}/children`
    );

    return response.MediaContainer.Metadata;
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = {
      addedAt: Date.now() - 1000 * 60 * 60,
    },
    mediaType: 'movie' | 'show'
  ): Promise<PlexLibraryItem[]> {
    const response = await this.getWithRetry<PlexLibraryResponse>(
      `/library/sections/${id}/all?type=${
        mediaType === 'show' ? '4' : '1'
      }&sort=addedAt%3Adesc&addedAt>>=${Math.floor(options.addedAt / 1000)}`,
      {
        headers: {
          'X-Plex-Container-Start': '0',
          'X-Plex-Container-Size': '500',
        },
      }
    );

    return response.MediaContainer.Metadata;
  }

  /** GET /status/sessions — active Plex sessions */
  public async getSessions(): Promise<PlexSession[]> {
    const response =
      await this.getWithRetry<PlexSessionsResponse>('/status/sessions');
    return response.MediaContainer.Metadata ?? [];
  }

  /** GET /myplex/account — MyPlex account info */
  public async getMyPlexAccount(): Promise<PlexAccountResponse['MyPlex']> {
    const response =
      await this.getWithRetry<PlexAccountResponse>('/myplex/account');
    return response.MyPlex;
  }

  /** GET /playlists */
  public async getPlaylists(): Promise<PlexPlaylist[]> {
    const response =
      await this.getWithRetry<PlexPlaylistsResponse>('/playlists');
    return response.MediaContainer.Metadata ?? [];
  }

  /** GET /hubs */
  public async getHubs(): Promise<PlexHub[]> {
    const response = await this.getWithRetry<PlexHubsResponse>('/hubs');
    return response.MediaContainer.Hub ?? [];
  }

  /** GET /:/prefs — server preferences */
  public async getPrefs(): Promise<PlexPrefs> {
    const response =
      await this.getWithRetry<PlexPrefsResponse>('/:/prefs');
    const prefs: PlexPrefs = {};
    for (const setting of response.MediaContainer.Setting ?? []) {
      prefs[setting.id] = setting.value;
    }
    return prefs;
  }

  /** Return the resolved token being used */
  public getToken(): string {
    return this.token;
  }
}

export default PlexAPI;

