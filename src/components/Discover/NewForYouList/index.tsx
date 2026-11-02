import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import TitleCard from '@app/components/TitleCard';
import useDiscover from '@app/hooks/useDiscover';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { MovieResult, TvResult } from '@server/models/Search';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.NewForYouList', {
  newforyou: 'New for You',
  newforyousub:
    'Recent releases and returning seasons picked from what you watch. Updated every couple of days.',
  becauseyouwatched: 'Because you watched {title}',
  loadmore: 'Load more',
  noresults: 'No suggestions yet. Watch something and check back tomorrow.',
});

type NewForYouItem = (MovieResult | TvResult) & { reason?: string };

const NewForYouList = () => {
  const intl = useIntl();
  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<NewForYouItem>('/api/v1/discover/new-for-you');

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.newforyou)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.newforyou)}</Header>
        <p className="mt-1 text-sm text-gray-400">
          {intl.formatMessage(messages.newforyousub)}
        </p>
      </div>
      {isEmpty && !isLoadingInitialData && (
        <div className="mt-32 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(messages.noresults)}
        </div>
      )}
      <ul className="cards-vertical">
        {titles?.map((item, index) => {
          const isMovie = item.mediaType === 'movie';
          const movie = item as MovieResult;
          const show = item as TvResult;

          return (
            <li key={`${item.mediaType}-${item.id}-${index}`}>
              <TitleCard
                id={item.id}
                image={item.posterPath}
                status={item.mediaInfo?.status}
                summary={item.overview}
                title={isMovie ? movie.title : show.name}
                userScore={item.voteAverage}
                year={isMovie ? movie.releaseDate : show.firstAirDate}
                mediaType={item.mediaType}
                canExpand
              />
              {item.reason && (
                <p className="mt-1 truncate px-1 text-xs text-gray-400">
                  {intl.formatMessage(messages.becauseyouwatched, {
                    title: item.reason,
                  })}
                </p>
              )}
            </li>
          );
        })}
        {isLoadingInitialData &&
          [...Array(20)].map((_item, i) => (
            <li key={`placeholder-${i}`}>
              <TitleCard.Placeholder canExpand />
            </li>
          ))}
      </ul>
      {!isReachingEnd && (titles?.length ?? 0) > 0 && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => fetchMore()}
            disabled={isLoadingMore}
            className="inline-flex items-center rounded-md border border-gray-500 bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {intl.formatMessage(messages.loadmore)}
          </button>
        </div>
      )}
    </>
  );
};

export default NewForYouList;
