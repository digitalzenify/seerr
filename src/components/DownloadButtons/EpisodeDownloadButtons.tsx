import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  LanguageIcon,
} from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages('components.DownloadButtons.Episode', {
  downloadEpisode: 'Download Episode',
  downloadEnSub: 'EN Sub',
  downloadRoSub: 'RO Sub',
  subtitleNotFound: 'No subtitle found for this language.',
  downloadError: 'Download failed. Please try again.',
});

interface EpisodeDownloadButtonsProps {
  mediaId: number;
  seasonNumber: number;
  episodeNumber: number;
}

const EpisodeDownloadButtons = ({
  mediaId,
  seasonNumber,
  episodeNumber,
}: EpisodeDownloadButtonsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const handleEpisodeDownload = () => {
    window.open(
      `/api/v1/media/${mediaId}/episode/${seasonNumber}/${episodeNumber}/download`,
      '_blank'
    );
  };

  const handleSubtitleDownload = async (language: string) => {
    try {
      const response = await fetch(
        `/api/v1/media/${mediaId}/episode/${seasonNumber}/${episodeNumber}/subtitle/${language}/download`
      );

      if (!response.ok) {
        addToast(intl.formatMessage(messages.subtitleNotFound), {
          appearance: 'warning',
          autoDismiss: true,
        });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `S${String(seasonNumber).padStart(2, '0')}E${String(
        episodeNumber
      ).padStart(2, '0')}-${language}.srt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      addToast(intl.formatMessage(messages.downloadError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  return (
    <div className="flex items-center space-x-1">
      <Tooltip content={intl.formatMessage(messages.downloadEpisode)}>
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={handleEpisodeDownload}
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip content={intl.formatMessage(messages.downloadEnSub)}>
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => handleSubtitleDownload('eng')}
        >
          <LanguageIcon className="h-3.5 w-3.5" />
          <span className="ml-0.5 text-xs">EN</span>
        </Button>
      </Tooltip>
      <Tooltip content={intl.formatMessage(messages.downloadRoSub)}>
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => handleSubtitleDownload('rum')}
        >
          <LanguageIcon className="h-3.5 w-3.5" />
          <span className="ml-0.5 text-xs">RO</span>
        </Button>
      </Tooltip>
    </div>
  );
};

export default EpisodeDownloadButtons;
