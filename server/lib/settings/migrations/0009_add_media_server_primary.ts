import { MediaServerType } from '@server/constants/server';
import type { AllSettings } from '@server/lib/settings';

const addMediaServerPrimary = (settings: any): AllSettings => {
  if (
    Array.isArray(settings.migrations) &&
    settings.migrations.includes('0009_add_media_server_primary')
  ) {
    return settings;
  }

  // Default to 'plex' for new installs and Plex servers.
  // Default to 'jellyfin' for existing Jellyfin/Emby installs so their
  // behaviour is unchanged after upgrading.
  if (settings.main?.mediaServerPrimary === undefined) {
    const serverType = settings.main?.mediaServerType;
    if (
      serverType === MediaServerType.JELLYFIN ||
      serverType === MediaServerType.EMBY
    ) {
      settings.main.mediaServerPrimary = 'jellyfin';
    } else {
      settings.main.mediaServerPrimary = 'plex';
    }
  }

  if (!Array.isArray(settings.migrations)) {
    settings.migrations = [];
  }
  settings.migrations.push('0009_add_media_server_primary');

  return settings;
};

export default addMediaServerPrimary;
