import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  LanguageIcon,
} from '@heroicons/react/24/outline';
import { useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages('components.DownloadButtons', {
  downloadMedia: 'Download',
  downloadEnSub: 'EN Sub',
  downloadRoSub: 'RO Sub',
  subtitleRequested:
    'Subtitle download has been triggered. Please try again in a moment.',
  subtitleNotFound: 'No subtitle found for this language.',
  downloadError: 'Download failed. Please try again.',
});

interface DownloadButtonsProps {
  mediaId: number;
  is4k?: boolean;
}

const DownloadButtons = ({ mediaId }: DownloadButtonsProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();

  const handleMediaDownload = () => {
    window.open(`/api/v1/media/${mediaId}/download`, '_blank');
  };

  const handleSubtitleDownload = async (language: string) => {
    try {
      const response = await fetch(
        `/api/v1/media/${mediaId}/subtitle/${language}/download`
      );

      if (response.status === 202) {
        // Bazarr is searching for the subtitle
        addToast(intl.formatMessage(messages.subtitleRequested), {
          appearance: 'info',
          autoDismiss: true,
        });
        return;
      }

      if (!response.ok) {
        addToast(intl.formatMessage(messages.subtitleNotFound), {
          appearance: 'warning',
          autoDismiss: true,
        });
        return;
      }

      // Create a blob from the response and trigger a download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `subtitle-${language}.srt`;
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
      <Tooltip content={intl.formatMessage(messages.downloadMedia)}>
        <Button
          buttonType="ghost"
          buttonSize="md"
          onClick={handleMediaDownload}
          className="ml-2"
        >
          <ArrowDownTrayIcon />
        </Button>
      </Tooltip>
      <Tooltip content={intl.formatMessage(messages.downloadEnSub)}>
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => handleSubtitleDownload('eng')}
          className="relative"
        >
          <LanguageIcon className="h-4 w-4" />
          <span className="ml-0.5 text-xs">EN</span>
        </Button>
      </Tooltip>
      <Tooltip content={intl.formatMessage(messages.downloadRoSub)}>
        <Button
          buttonType="ghost"
          buttonSize="sm"
          onClick={() => handleSubtitleDownload('rum')}
          className="relative"
        >
          <LanguageIcon className="h-4 w-4" />
          <span className="ml-0.5 text-xs">RO</span>
        </Button>
      </Tooltip>
    </div>
  );
};

export default DownloadButtons;
