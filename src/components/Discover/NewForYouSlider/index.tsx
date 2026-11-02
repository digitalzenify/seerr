import MediaSlider from '@app/components/MediaSlider';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.NewForYouSlider', {
  newforyou: 'New for You',
});

const NewForYouSlider = () => {
  const intl = useIntl();

  return (
    <MediaSlider
      sliderKey="new-for-you"
      title={intl.formatMessage(messages.newforyou)}
      url="/api/v1/discover/new-for-you"
      linkUrl="/discover/new-for-you"
      hideWhenEmpty
    />
  );
};

export default NewForYouSlider;
