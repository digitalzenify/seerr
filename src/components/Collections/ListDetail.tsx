import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import { getItemDisplayTitle } from '@app/components/Collections/utils';
import TmdbTitleCard from '@app/components/TitleCard/TmdbTitleCard';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowPathIcon,
  ArrowsUpDownIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Collections.ListDetail', {
  back: '← Back to Collections',
  items: '{count, plural, one {# item} other {# items}}',
  noItems: 'This list is empty. Add movies or TV shows from their detail pages!',
  removeItem: 'Remove',
  pickFromList: 'Pick From This List',
  pickResult: 'You should watch:',
  pickAgain: 'Pick Again',
  nothingToPick: 'No items to pick from!',
  picking: 'Picking...',
  sortDateAdded: 'Date Added',
  sortAlpha: 'A-Z',
  sortType: 'Type',
  viewGrid: 'Grid',
  viewList: 'List',
  inLibraryOnly: 'In Library Only',
  filterLibrary: 'In Library',
  shownOf: '{shown} of {total} shown',
});

interface ListItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  sortOrder: number;
  createdAt: string;
  media?: Media;
}

interface ListDetail {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  items: ListItem[];
}

interface PickedItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
}

// Helper to check if a media item is in the library
const isInLibrary = (status?: MediaStatus): boolean =>
  status === MediaStatus.AVAILABLE || status === MediaStatus.PARTIALLY_AVAILABLE;

// Horizontal list-view row that lazily fetches TMDB details
interface ListItemRowProps {
  item: ListItem;
  onRemove: (id: number) => void;
  removeLabel: string;
}

const ListItemRow = ({ item, onRemove, removeLabel }: ListItemRowProps) => {
  const { ref, inView } = useInView({ triggerOnce: true });
  const url =
    item.mediaType === 'movie'
      ? `/api/v1/movie/${item.tmdbId}`
      : `/api/v1/tv/${item.tmdbId}`;
  const { data: tmdbData } = useSWR<MovieDetails | TvDetails>(
    inView ? url : null
  );

  const isMovieData = (d: MovieDetails | TvDetails): d is MovieDetails =>
    (d as MovieDetails).title !== undefined;

  const posterPath = tmdbData?.posterPath;
  const displayTitle = tmdbData
    ? isMovieData(tmdbData)
      ? tmdbData.title
      : tmdbData.name
    : getItemDisplayTitle(item);
  const year = tmdbData
    ? isMovieData(tmdbData)
      ? tmdbData.releaseDate?.slice(0, 4)
      : (tmdbData as TvDetails).firstAirDate?.slice(0, 4)
    : undefined;
  const overview = tmdbData?.overview;
  const status = tmdbData?.mediaInfo?.status ?? item.media?.status;
  const href = `/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`;

  return (
    <div
      ref={ref}
      className="group flex items-center gap-3 rounded-lg bg-gray-800 p-3 transition hover:bg-gray-700"
    >
      {/* Poster thumbnail */}
      <Link href={href} className="shrink-0">
        <div className="relative h-20 w-14 overflow-hidden rounded bg-gray-700">
          {posterPath ? (
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/w92${posterPath}`}
              alt=""
              fill
              style={{ objectFit: 'cover' }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-600">
              <span className="text-xl">
                {item.mediaType === 'movie' ? '🎬' : '📺'}
              </span>
            </div>
          )}
          {status && status !== MediaStatus.UNKNOWN && (
            <div className="absolute bottom-0.5 right-0.5">
              <StatusBadgeMini status={status} shrink />
            </div>
          )}
        </div>
      </Link>

      {/* Content */}
      <Link href={href} className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="truncate font-medium text-white">{displayTitle}</p>
          {year && (
            <span className="shrink-0 text-xs text-gray-500">{year}</span>
          )}
        </div>
        {overview && (
          <p
            className="text-xs text-gray-400"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {overview}
          </p>
        )}
      </Link>

      {/* Remove button */}
      <button
        onClick={() => onRemove(item.id)}
        className="shrink-0 rounded p-1.5 text-gray-400 opacity-0 transition hover:bg-red-600 hover:text-white group-hover:opacity-100"
        title={removeLabel}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

const ListDetailPage = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser } = useUser();
  const userId = router.query.userId
    ? Number(router.query.userId)
    : currentUser?.id;
  const listId = router.query.listId
    ? Number(router.query.listId)
    : undefined;

  const {
    data: list,
    error,
    mutate,
  } = useSWR<ListDetail>(
    userId && listId ? `/api/v1/user/${userId}/lists/${listId}` : null
  );

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'dateAdded' | 'alpha' | 'type'>(
    'dateAdded'
  );
  const [isPickingRandom, setIsPickingRandom] = useState(false);
  const [pickedItem, setPickedItem] = useState<PickedItem | null>(null);
  const [showPickResult, setShowPickResult] = useState(false);
  const [pickInLibraryOnly, setPickInLibraryOnly] = useState(false);
  const [filterLibraryOnly, setFilterLibraryOnly] = useState(false);

  const isLoading = !list && !error;

  const handleRemoveItem = useCallback(
    async (itemId: number) => {
      if (!userId || !listId) return;
      try {
        await fetch(
          `/api/v1/user/${userId}/lists/${listId}/items/${itemId}`,
          { method: 'DELETE' }
        );
        mutate();
      } catch {
        // Handle error silently
      }
    },
    [userId, listId, mutate]
  );

  const handlePickFromList = useCallback(async () => {
    if (!userId || !listId) return;
    setIsPickingRandom(true);
    setShowPickResult(false);
    setPickedItem(null);

    try {
      const params = new URLSearchParams({ listId: String(listId) });
      if (pickInLibraryOnly) {
        params.set('inLibraryOnly', 'true');
      }
      const response = await fetch(
        `/api/v1/user/${userId}/lists/random/pick?${params.toString()}`
      );
      if (response.ok) {
        const item = await response.json();
        setTimeout(() => {
          setPickedItem(item);
          setShowPickResult(true);
          setIsPickingRandom(false);
        }, 800);
      } else {
        setIsPickingRandom(false);
        setPickedItem(null);
        setShowPickResult(true);
      }
    } catch {
      setIsPickingRandom(false);
      setPickedItem(null);
      setShowPickResult(true);
    }
  }, [userId, listId, pickInLibraryOnly]);

  // Sort items
  const sortedItems = [...(list?.items ?? [])].sort((a, b) => {
    switch (sortBy) {
      case 'alpha':
        return (a.title || '').localeCompare(b.title || '');
      case 'type':
        return a.mediaType.localeCompare(b.mediaType);
      case 'dateAdded':
      default:
        return a.sortOrder - b.sortOrder;
    }
  });

  // Apply library filter
  const filteredItems = filterLibraryOnly
    ? sortedItems.filter((item) => isInLibrary(item.media?.status))
    : sortedItems;

  if (isLoading) {
    return (
      <div className="mt-6 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !list) {
    return (
      <div className="mt-6 text-center text-gray-400">List not found.</div>
    );
  }

  const backHref = router.query.userId
    ? `/users/${router.query.userId}/collections`
    : '/profile/collections';

  return (
    <>
      <PageTitle title={list.name} />
      <div className="mt-6">
        <Link
          href={backHref}
          className="text-sm text-indigo-400 transition hover:text-indigo-300"
        >
          {intl.formatMessage(messages.back)}
        </Link>
        <div className="mt-4 flex items-center justify-between">
          <div>
            <Header>{list.name}</Header>
            {list.description && (
              <p className="mt-1 text-sm text-gray-400">{list.description}</p>
            )}
            <p className="mt-1 text-sm text-gray-500">
              {intl.formatMessage(messages.items, {
                count: sortedItems.length,
              })}
            </p>
          </div>

          {/* Pick from this list */}
          {sortedItems.length > 0 && (
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={handlePickFromList}
                disabled={isPickingRandom}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50"
              >
                <ArrowPathIcon
                  className={`h-4 w-4 ${isPickingRandom ? 'animate-spin' : ''}`}
                />
                {isPickingRandom
                  ? intl.formatMessage(messages.picking)
                  : intl.formatMessage(messages.pickFromList)}
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-400">
                <input
                  type="checkbox"
                  checked={pickInLibraryOnly}
                  onChange={(e) => setPickInLibraryOnly(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                />
                {intl.formatMessage(messages.inLibraryOnly)}
              </label>
            </div>
          )}
        </div>

        {/* Pick result */}
        {showPickResult && (
          <div className="mt-4 rounded-lg bg-purple-900/30 p-4 text-center">
            {pickedItem ? (
              <div>
                <p className="text-sm text-gray-400">
                  {intl.formatMessage(messages.pickResult)}
                </p>
                <Link
                  href={`/${pickedItem.mediaType === 'movie' ? 'movie' : 'tv'}/${pickedItem.tmdbId}`}
                  className="mt-1 inline-block text-xl font-bold text-indigo-400 transition hover:text-indigo-300"
                >
                  {getItemDisplayTitle(pickedItem)}
                </Link>
                <button
                  onClick={handlePickFromList}
                  className="ml-3 text-sm text-purple-400 hover:text-purple-300"
                >
                  {intl.formatMessage(messages.pickAgain)}
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                {intl.formatMessage(messages.nothingToPick)}
              </p>
            )}
          </div>
        )}

        {/* Sort, view and filter controls */}
        {sortedItems.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-gray-400">
              <ArrowsUpDownIcon className="h-4 w-4" />
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as 'dateAdded' | 'alpha' | 'type'
                  )
                }
                className="rounded border-0 bg-gray-800 px-2 py-1 text-sm text-white focus:ring-2 focus:ring-indigo-500"
              >
                <option value="dateAdded">
                  {intl.formatMessage(messages.sortDateAdded)}
                </option>
                <option value="alpha">
                  {intl.formatMessage(messages.sortAlpha)}
                </option>
                <option value="type">
                  {intl.formatMessage(messages.sortType)}
                </option>
              </select>
            </div>
            {/* Library filter */}
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-400">
              <input
                type="checkbox"
                checked={filterLibraryOnly}
                onChange={(e) => setFilterLibraryOnly(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
              />
              {intl.formatMessage(messages.filterLibrary)}
            </label>
            {/* Count label when filter is active */}
            {filterLibraryOnly && (
              <span className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
                {intl.formatMessage(messages.shownOf, {
                  shown: filteredItems.length,
                  total: sortedItems.length,
                })}
              </span>
            )}
            <div className="ml-auto flex rounded-lg bg-gray-800">
              <button
                onClick={() => setViewMode('grid')}
                className={`rounded-l-lg px-3 py-1 text-xs ${
                  viewMode === 'grid'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400'
                }`}
              >
                {intl.formatMessage(messages.viewGrid)}
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`rounded-r-lg px-3 py-1 text-xs ${
                  viewMode === 'list'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400'
                }`}
              >
                {intl.formatMessage(messages.viewList)}
              </button>
            </div>
          </div>
        )}

        {/* Items display */}
        {filteredItems.length === 0 ? (
          <div className="mt-8 rounded-xl bg-gray-800 p-10 text-center">
            <p className="text-gray-400">
              {sortedItems.length === 0
                ? intl.formatMessage(messages.noItems)
                : intl.formatMessage(messages.nothingToPick)}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <ul className="cards-vertical mt-4">
            {filteredItems.map((item) => (
              <li key={item.id} className="group relative">
                <TmdbTitleCard
                  id={item.tmdbId}
                  tmdbId={item.tmdbId}
                  type={item.mediaType}
                  canExpand
                />
                <div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="flex items-center gap-1 rounded bg-red-900/60 px-2 py-0.5 text-xs text-red-300 hover:bg-red-600 hover:text-white"
                    title={intl.formatMessage(messages.removeItem)}
                  >
                    <TrashIcon className="h-3 w-3" />
                    {intl.formatMessage(messages.removeItem)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 space-y-2">
            {filteredItems.map((item) => (
              <ListItemRow
                key={item.id}
                item={item}
                onRemove={handleRemoveItem}
                removeLabel={intl.formatMessage(messages.removeItem)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default ListDetailPage;
