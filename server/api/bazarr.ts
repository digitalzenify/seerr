import ExternalAPI from '@server/api/externalapi';
import logger from '@server/logger';

export interface BazarrSubtitle {
  path: string;
  name: string;
  code2: string;
  code3: string;
  forced: boolean;
  hi: boolean;
}

export interface BazarrMovieResponse {
  radarrId: number;
  title: string;
  subtitles: BazarrSubtitle[];
  missing_subtitles: BazarrSubtitle[];
  path: string;
}

export interface BazarrEpisodeResponse {
  sonarrEpisodeId: number;
  sonarrSeriesId: number;
  title: string;
  season: number;
  episode: number;
  subtitles: BazarrSubtitle[];
  missing_subtitles: BazarrSubtitle[];
  path: string;
}

export interface BazarrSystemStatusResponse {
  bazarr_version: string;
  radarr_accessible: boolean;
  sonarr_accessible: boolean;
}

class BazarrAPI extends ExternalAPI {
  constructor(url: string, apiKey: string) {
    super(url, {}, { headers: { 'X-API-KEY': apiKey } });
  }

  public async getSystemStatus(): Promise<BazarrSystemStatusResponse> {
    try {
      const data = await this.get<BazarrSystemStatusResponse>(
        '/api/system/status'
      );
      return data;
    } catch (e) {
      logger.error('Failed to get Bazarr system status', {
        label: 'Bazarr',
        message: e.message,
      });
      throw e;
    }
  }

  public async getMovieSubtitles(
    radarrId: number
  ): Promise<BazarrMovieResponse | undefined> {
    try {
      const data = await this.get<{ data: BazarrMovieResponse[] }>(
        '/api/movies',
        { params: { radarrid: radarrId } },
        0
      );
      return data.data?.[0];
    } catch (e) {
      logger.error('Failed to get movie subtitles from Bazarr', {
        label: 'Bazarr',
        radarrId,
        message: e.message,
      });
      return undefined;
    }
  }

  public async getEpisodeSubtitles(
    sonarrEpisodeId: number
  ): Promise<BazarrEpisodeResponse | undefined> {
    try {
      const data = await this.get<{ data: BazarrEpisodeResponse[] }>(
        '/api/episodes',
        { params: { episodeid: sonarrEpisodeId } },
        0
      );
      return data.data?.[0];
    } catch (e) {
      logger.error('Failed to get episode subtitles from Bazarr', {
        label: 'Bazarr',
        sonarrEpisodeId,
        message: e.message,
      });
      return undefined;
    }
  }

  public async downloadMovieSubtitle(
    radarrId: number,
    language: string
  ): Promise<void> {
    try {
      await this.post('/api/movies/subtitles', {
        radarrId,
        language,
        forced: false,
        hi: false,
      });
    } catch (e) {
      logger.error('Failed to trigger Bazarr movie subtitle download', {
        label: 'Bazarr',
        radarrId,
        language,
        message: e.message,
      });
      throw e;
    }
  }

  public async downloadEpisodeSubtitle(
    sonarrEpisodeId: number,
    language: string
  ): Promise<void> {
    try {
      await this.post('/api/episodes/subtitles', {
        sonarrEpisodeId,
        language,
        forced: false,
        hi: false,
      });
    } catch (e) {
      logger.error('Failed to trigger Bazarr episode subtitle download', {
        label: 'Bazarr',
        sonarrEpisodeId,
        language,
        message: e.message,
      });
      throw e;
    }
  }
}

export default BazarrAPI;
