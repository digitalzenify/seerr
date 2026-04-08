import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { getItemDisplayTitle } from '@app/components/Collections/utils';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowPathIcon,
  ArrowsUpDownIcon,
  FilmIcon,
  TrashIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import type Media from '@server/entity/Media';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';
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
      const response = await fetch(
        `/api/v1/user/${userId}/lists/random/pick?listId=${listId}`
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
  }, [userId, listId]);

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

        {/* Sort and view controls */}
        {sortedItems.length > 0 && (
          <div className="mt-4 flex items-center gap-3">
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
            <div className="flex rounded-lg bg-gray-800">
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
        {sortedItems.length === 0 ? (
          <div className="mt-8 rounded-xl bg-gray-800 p-10 text-center">
            <p className="text-gray-400">
              {intl.formatMessage(messages.noItems)}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {sortedItems.map((item) => (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-lg bg-gray-800"
              >
                <Link
                  href={`/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`}
                  className="block"
                >
                  <div className="aspect-[2/3] bg-gray-700">
                    <div className="flex h-full items-center justify-center">
                      {item.mediaType === 'movie' ? (
                        <FilmIcon className="h-12 w-12 text-gray-600" />
                      ) : (
                        <TvIcon className="h-12 w-12 text-gray-600" />
                      )}
                    </div>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-sm font-medium text-white">
                      {getItemDisplayTitle(item)}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {item.mediaType === 'movie' ? '🎬 Movie' : '📺 TV Show'}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    handleRemoveItem(item.id);
                  }}
                  className="absolute right-2 top-2 rounded bg-black/60 p-1 text-gray-400 opacity-0 transition hover:bg-red-600 hover:text-white group-hover:opacity-100"
                  title={intl.formatMessage(messages.removeItem)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {sortedItems.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-3 rounded-lg bg-gray-800 p-3 transition hover:bg-gray-750"
              >
                <Link
                  href={`/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-700">
                    {item.mediaType === 'movie' ? (
                      <FilmIcon className="h-5 w-5 text-gray-400" />
                    ) : (
                      <TvIcon className="h-5 w-5 text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">
                      {getItemDisplayTitle(item)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.mediaType === 'movie' ? 'Movie' : 'TV Show'} · Added{' '}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  className="shrink-0 rounded p-1.5 text-gray-400 opacity-0 transition hover:bg-red-600 hover:text-white group-hover:opacity-100"
                  title={intl.formatMessage(messages.removeItem)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default ListDetailPage;
