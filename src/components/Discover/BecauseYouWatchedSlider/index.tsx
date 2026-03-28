import MediaSlider from '@app/components/MediaSlider';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages(
  'components.Discover.BecauseYouWatchedSlider',
  {
    becauseyouwatched: 'Because You Watched',
  }
);

const BecauseYouWatchedSlider = () => {
  const intl = useIntl();

  return (
    <MediaSlider
      sliderKey="because-you-watched"
      title={intl.formatMessage(messages.becauseyouwatched)}
      url="/api/v1/discover/because-you-watched"
      linkUrl="/discover/because-you-watched"
      hideWhenEmpty
    />
  );
};

export default BecauseYouWatchedSlider;
