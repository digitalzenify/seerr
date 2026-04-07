import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import SubtitleModal from '@app/components/SubtitleModal';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownTrayIcon,
  LanguageIcon,
} from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.DownloadButtons.Episode', {
  downloadEpisode: 'Download Episode',
  downloadSubtitle: 'Download Subtitle',
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
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);

  const handleEpisodeDownload = () => {
    window.open(
      `/api/v1/media/${mediaId}/episode/${seasonNumber}/${episodeNumber}/download`,
      '_blank'
    );
  };

  return (
    <>
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
        <Tooltip content={intl.formatMessage(messages.downloadSubtitle)}>
          <Button
            buttonType="ghost"
            buttonSize="sm"
            onClick={() => setShowSubtitleModal(true)}
          >
            <LanguageIcon className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>
      <SubtitleModal
        show={showSubtitleModal}
        onClose={() => setShowSubtitleModal(false)}
        mediaId={mediaId}
        seasonNumber={seasonNumber}
        episodeNumber={episodeNumber}
      />
    </>
  );
};

export default EpisodeDownloadButtons;
