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

const messages = defineMessages('components.DownloadButtons', {
  downloadMedia: 'Download',
  downloadSubtitle: 'Download Subtitle',
});

interface DownloadButtonsProps {
  mediaId: number;
  is4k?: boolean;
}

const DownloadButtons = ({ mediaId }: DownloadButtonsProps) => {
  const intl = useIntl();
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);

  const handleMediaDownload = () => {
    window.open(`/api/v1/media/${mediaId}/download`, '_blank');
  };

  return (
    <>
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
        <Tooltip content={intl.formatMessage(messages.downloadSubtitle)}>
          <Button
            buttonType="ghost"
            buttonSize="sm"
            onClick={() => setShowSubtitleModal(true)}
            className="relative"
          >
            <LanguageIcon className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
      <SubtitleModal
        show={showSubtitleModal}
        onClose={() => setShowSubtitleModal(false)}
        mediaId={mediaId}
      />
    </>
  );
};

export default DownloadButtons;
