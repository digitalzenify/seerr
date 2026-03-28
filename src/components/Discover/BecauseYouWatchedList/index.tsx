import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { MovieResult, TvResult } from '@server/models/Search';
import { useIntl } from 'react-intl';

const messages = defineMessages(
  'components.Discover.BecauseYouWatchedList',
  {
    becauseyouwatched: 'Because You Watched',
  }
);

const BecauseYouWatchedList = () => {
  const intl = useIntl();
  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult | TvResult>(
    '/api/v1/discover/because-you-watched'
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.becauseyouwatched)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.becauseyouwatched)}</Header>
      </div>
      <ListView
        items={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default BecauseYouWatchedList;
