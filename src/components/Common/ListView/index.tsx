import PersonCard from '@app/components/PersonCard';
import TitleCard from '@app/components/TitleCard';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { Permission, useUser } from '@app/hooks/useUser';
import useVerticalScroll from '@app/hooks/useVerticalScroll';
import globalMessages from '@app/i18n/globalMessages';
import { MediaStatus } from '@server/constants/media';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import type {
  CollectionResult,
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

type ListViewProps = {
  items?: (TvResult | MovieResult | PersonResult | CollectionResult)[];
  plexItems?: WatchlistItem[];
  isEmpty?: boolean;
  isLoading?: boolean;
  isReachingEnd?: boolean;
  onScrollBottom: () => void;
  mutateParent?: () => void;
};

const ListView = ({
  items,
  isEmpty,
  isLoading,
  onScrollBottom,
  isReachingEnd,
  plexItems,
  mutateParent,
}: ListViewProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  useVerticalScroll(onScrollBottom, !isLoading && !isEmpty && !isReachingEnd);

  const blocklistVisibility = hasPermission(
    [Permission.MANAGE_BLOCKLIST, Permission.VIEW_BLOCKLIST],
    { type: 'or' }
  );

  // Collect TMDB IDs for rating batch fetch
  const movieIds = (items ?? [])
    .slice(0, 20)
    .filter((t): t is MovieResult => t.mediaType === 'movie')
    .map((t) => t.id);
  const tvIds = (items ?? [])
    .slice(0, 20)
    .filter((t): t is TvResult => t.mediaType === 'tv')
    .map((t) => t.id);

  // Batch fetch IMDB + RT ratings (separate calls for movies and tv)
  const { data: movieRatings } = useSWR<
    Record<number, { imdbRating?: number; rtCriticsRating?: string; rtCriticsScore?: number }>
  >(
    movieIds.length > 0
      ? `/api/v1/discover/ratings?tmdbIds=${movieIds.join(',')}&mediaType=movie`
      : null
  );
  const { data: tvRatings } = useSWR<
    Record<number, { imdbRating?: number; rtCriticsRating?: string; rtCriticsScore?: number }>
  >(
    tvIds.length > 0
      ? `/api/v1/discover/ratings?tmdbIds=${tvIds.join(',')}&mediaType=tv`
      : null
  );

  const discoverRatings = { ...movieRatings, ...tvRatings };

  return (
    <>
      {isEmpty && (
        <div className="mt-64 w-full text-center text-2xl text-gray-400">
          {intl.formatMessage(globalMessages.noresults)}
        </div>
      )}
      <ul className="cards-vertical">
        {plexItems?.map((title, index) => {
          return (
            <li key={`${title.ratingKey}-${index}`}>
              <TmdbTitleCard
                id={title.tmdbId}
                tmdbId={title.tmdbId}
                type={title.mediaType}
                isAddedToWatchlist={true}
                canExpand
                mutateParent={mutateParent}
              />
            </li>
          );
        })}
        {items
          ?.filter((title) => {
            if (!blocklistVisibility)
              return (
                (title as TvResult | MovieResult).mediaInfo?.status !==
                MediaStatus.BLOCKLISTED
              );
            return title;
          })
          .map((title, index) => {
            let titleCard: React.ReactNode;

            switch (title.mediaType) {
              case 'movie':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    image={title.posterPath}
                    status={title.mediaInfo?.status}
                    summary={title.overview}
                    title={title.title}
                    userScore={title.voteAverage}
                    imdbRating={discoverRatings[title.id]?.imdbRating}
                    rtCriticsRating={discoverRatings[title.id]?.rtCriticsRating}
                    rtCriticsScore={discoverRatings[title.id]?.rtCriticsScore}
                    year={title.releaseDate}
                    mediaType={title.mediaType}
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    canExpand
                  />
                );
                break;
              case 'tv':
                titleCard = (
                  <TitleCard
                    key={title.id}
                    id={title.id}
                    isAddedToWatchlist={
                      title.mediaInfo?.watchlists?.length ?? 0
                    }
                    image={title.posterPath}
                    status={title.mediaInfo?.status}
                    summary={title.overview}
                    title={title.name}
                    userScore={title.voteAverage}
                    imdbRating={discoverRatings[title.id]?.imdbRating}
                    rtCriticsRating={discoverRatings[title.id]?.rtCriticsRating}
                    rtCriticsScore={discoverRatings[title.id]?.rtCriticsScore}
                    year={title.firstAirDate}
                    mediaType={title.mediaType}
                    inProgress={
                      (title.mediaInfo?.downloadStatus ?? []).length > 0
                    }
                    canExpand
                  />
                );
                break;
              case 'collection':
                titleCard = (
                  <TitleCard
                    id={title.id}
                    image={title.posterPath}
                    summary={title.overview}
                    title={title.title}
                    mediaType={title.mediaType}
                    canExpand
                  />
                );
                break;
              case 'person':
                titleCard = (
                  <PersonCard
                    personId={title.id}
                    name={title.name}
                    profilePath={title.profilePath}
                    canExpand
                  />
                );
                break;
            }

            return <li key={`${title.id}-${index}`}>{titleCard}</li>;
          })}
        {isLoading &&
          !isReachingEnd &&
          [...Array(20)].map((_item, i) => (
            <li key={`placeholder-${i}`}>
              <TitleCard.Placeholder canExpand />
            </li>
          ))}
      </ul>
    </>
  );
};

export default ListView;
