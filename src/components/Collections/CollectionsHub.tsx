import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProfileHeader from '@app/components/UserProfile/ProfileHeader';
import { getItemDisplayTitle } from '@app/components/Collections/utils';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowPathIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Collections', {
  collections: 'Collections',
  createList: 'Create List',
  pickForMe: 'Pick For Me',
  noLists:
    'You don\'t have any lists yet. Create one to start organizing your watchlist!',
  items: '{count, plural, one {# item} other {# items}}',
  defaultList: 'Default',
  deleteConfirm: 'Are you sure you want to delete this list?',
  newListName: 'New List',
  rename: 'Rename',
  cancel: 'Cancel',
  save: 'Save',
  pickResult: 'You should watch:',
  pickAgain: 'Pick Again',
  nothingToPick: 'Add some items to your lists first!',
  picking: 'Picking...',
  filterAll: 'All',
  filterMovies: 'Movies Only',
  filterTv: 'TV Only',
  inLibraryOnly: 'In Library Only',
});

interface UserListSummary {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  isDefault: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

interface PickedItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
}

const CollectionsHub = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser } = useUser();
  const userId = router.query.userId
    ? Number(router.query.userId)
    : currentUser?.id;
  const { user } = useUser({ id: userId });

  const {
    data: listsData,
    error,
    mutate,
  } = useSWR<{ results: UserListSummary[] }>(
    userId ? `/api/v1/user/${userId}/lists` : null
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [editingListId, setEditingListId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [isPickingRandom, setIsPickingRandom] = useState(false);
  const [pickedItem, setPickedItem] = useState<PickedItem | null>(null);
  const [pickFilter, setPickFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [pickInLibraryOnly, setPickInLibraryOnly] = useState(false);
  const [showPickResult, setShowPickResult] = useState(false);

  const isLoading = !listsData && !error;
  const lists = listsData?.results ?? [];

  const totalItems = lists.reduce((sum, l) => sum + l.itemCount, 0);

  const handleCreateList = useCallback(async () => {
    if (!userId || !newListName.trim()) return;
    try {
      await fetch(`/api/v1/user/${userId}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newListName.trim(),
          description: newListDesc.trim(),
        }),
      });
      setShowCreateModal(false);
      setNewListName('');
      setNewListDesc('');
      mutate();
    } catch {
      // Handle error silently
    }
  }, [userId, newListName, newListDesc, mutate]);

  const handleDeleteList = useCallback(
    async (listId: number) => {
      if (!userId) return;
      if (!confirm(intl.formatMessage(messages.deleteConfirm))) return;
      try {
        await fetch(`/api/v1/user/${userId}/lists/${listId}`, {
          method: 'DELETE',
        });
        mutate();
      } catch {
        // Handle error silently
      }
    },
    [userId, intl, mutate]
  );

  const handleRenameList = useCallback(
    async (listId: number) => {
      if (!userId || !editName.trim()) return;
      try {
        await fetch(`/api/v1/user/${userId}/lists/${listId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName.trim() }),
        });
        setEditingListId(null);
        setEditName('');
        mutate();
      } catch {
        // Handle error silently
      }
    },
    [userId, editName, mutate]
  );

  const handlePickForMe = useCallback(async () => {
    if (!userId) return;
    setIsPickingRandom(true);
    setShowPickResult(false);
    setPickedItem(null);

    try {
      const params = new URLSearchParams();
      if (pickFilter !== 'all') {
        params.set('mediaType', pickFilter);
      }
      if (pickInLibraryOnly) {
        params.set('inLibraryOnly', 'true');
      }
      const response = await fetch(
        `/api/v1/user/${userId}/lists/random/pick?${params.toString()}`
      );
      if (response.ok) {
        const item = await response.json();
        // Add a brief delay for dramatic effect
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
  }, [userId, pickFilter, pickInLibraryOnly]);

  if (isLoading || !user) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.collections)} />
        <div className="mt-6 flex justify-center">
          <LoadingSpinner />
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.collections)} />
      <ProfileHeader user={user} />
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <Header>{intl.formatMessage(messages.collections)}</Header>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            <PlusIcon className="h-4 w-4" />
            {intl.formatMessage(messages.createList)}
          </button>
        </div>
      </div>

      {/* Pick For Me Section */}
      {totalItems > 0 && (
        <div className="mt-6 rounded-xl bg-gradient-to-br from-purple-900/40 to-indigo-900/40 p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <div className="text-center sm:text-left">
              <h3 className="text-lg font-bold text-white">
                🎲 {intl.formatMessage(messages.pickForMe)}
              </h3>
              <p className="mt-1 text-sm text-gray-400">
                Can&apos;t decide what to watch? Let us pick for you!
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              {/* Filter select */}
              <select
                value={pickFilter}
                onChange={(e) =>
                  setPickFilter(e.target.value as 'all' | 'movie' | 'tv')
                }
                className="w-full rounded-lg border-0 bg-gray-800 px-3 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500 sm:w-auto"
              >
                <option value="all">
                  {intl.formatMessage(messages.filterAll)}
                </option>
                <option value="movie">
                  {intl.formatMessage(messages.filterMovies)}
                </option>
                <option value="tv">
                  {intl.formatMessage(messages.filterTv)}
                </option>
              </select>
              {/* Button + checkbox grouped together */}
              <div className="flex items-center gap-3 rounded-lg bg-gray-800/40 px-3 py-2 ring-1 ring-gray-700/50 sm:bg-transparent sm:px-0 sm:py-0 sm:ring-0">
                <button
                  onClick={handlePickForMe}
                  disabled={isPickingRandom}
                  className="flex items-center gap-2 rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-50"
                >
                  <ArrowPathIcon
                    className={`h-5 w-5 ${isPickingRandom ? 'animate-spin' : ''}`}
                  />
                  {isPickingRandom
                    ? intl.formatMessage(messages.picking)
                    : intl.formatMessage(messages.pickForMe)}
                </button>
                {/* In Library Only checkbox */}
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={pickInLibraryOnly}
                    onChange={(e) => setPickInLibraryOnly(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  {intl.formatMessage(messages.inLibraryOnly)}
                </label>
              </div>
            </div>
          </div>

          {/* Pick result */}
          {showPickResult && (
            <div className="mt-4 rounded-lg bg-gray-800/60 p-4 text-center">
              {pickedItem ? (
                <div>
                  <p className="text-sm text-gray-400">
                    {intl.formatMessage(messages.pickResult)}
                  </p>
                  <Link
                    href={`/${pickedItem.mediaType === 'movie' ? 'movie' : 'tv'}/${pickedItem.tmdbId}`}
                    className="mt-2 inline-block text-xl font-bold text-indigo-400 transition hover:text-indigo-300"
                  >
                    {getItemDisplayTitle(pickedItem)}
                  </Link>
                  <div className="mt-1">
                    <span className="inline-block rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                      {pickedItem.mediaType === 'movie' ? '🎬 Movie' : '📺 TV Show'}
                    </span>
                  </div>
                  <button
                    onClick={handlePickForMe}
                    className="mt-3 text-sm text-purple-400 transition hover:text-purple-300"
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
        </div>
      )}

      {/* Lists Grid */}
      {lists.length === 0 ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-xl bg-gray-800 p-10 text-center">
          <p className="text-lg text-gray-400">
            {intl.formatMessage(messages.noLists)}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((list) => (
            <div
              key={list.id}
              className="group relative overflow-hidden rounded-xl bg-gray-800 transition hover:bg-gray-750"
            >
              <Link
                href={
                  router.query.userId
                    ? `/users/${router.query.userId}/collections/${list.id}`
                    : `/profile/collections/${list.id}`
                }
                className="block p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    {editingListId === list.id ? (
                      <div
                        className="flex items-center gap-2"
                        onClick={(e) => e.preventDefault()}
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameList(list.id);
                            if (e.key === 'Escape') setEditingListId(null);
                          }}
                          className="w-full rounded border-0 bg-gray-700 px-2 py-1 text-white focus:ring-2 focus:ring-indigo-500"
                          autoFocus
                        />
                        <button
                          onClick={() => handleRenameList(list.id)}
                          className="text-xs text-indigo-400 hover:text-indigo-300"
                        >
                          {intl.formatMessage(messages.save)}
                        </button>
                        <button
                          onClick={() => setEditingListId(null)}
                          className="text-xs text-gray-400 hover:text-gray-300"
                        >
                          {intl.formatMessage(messages.cancel)}
                        </button>
                      </div>
                    ) : (
                      <h3 className="truncate text-lg font-semibold text-white">
                        {list.name}
                        {list.isDefault && (
                          <span className="ml-2 rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs font-medium text-indigo-400">
                            {intl.formatMessage(messages.defaultList)}
                          </span>
                        )}
                      </h3>
                    )}
                    {list.description && (
                      <p className="mt-1 truncate text-sm text-gray-400">
                        {list.description}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-gray-500">
                      {intl.formatMessage(messages.items, {
                        count: list.itemCount,
                      })}
                    </p>
                  </div>
                </div>
              </Link>

              {/* Action buttons (visible on hover) */}
              {!list.isDefault && (
                <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingListId(list.id);
                      setEditName(list.name);
                    }}
                    className="rounded bg-gray-700 p-1.5 text-gray-400 transition hover:bg-gray-600 hover:text-white"
                    title={intl.formatMessage(messages.rename)}
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteList(list.id);
                    }}
                    className="rounded bg-gray-700 p-1.5 text-gray-400 transition hover:bg-red-600 hover:text-white"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create List Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-gray-800 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white">
              {intl.formatMessage(messages.createList)}
            </h3>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateList();
                }}
                placeholder="List name..."
                className="w-full rounded-lg border-0 bg-gray-700 px-3 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />
              <textarea
                value={newListDesc}
                onChange={(e) => setNewListDesc(e.target.value)}
                placeholder="Description (optional)..."
                rows={2}
                className="w-full rounded-lg border-0 bg-gray-700 px-3 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewListName('');
                  setNewListDesc('');
                }}
                className="rounded-lg bg-gray-700 px-4 py-2 text-sm text-white transition hover:bg-gray-600"
              >
                {intl.formatMessage(messages.cancel)}
              </button>
              <button
                onClick={handleCreateList}
                disabled={!newListName.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {intl.formatMessage(messages.createList)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CollectionsHub;
