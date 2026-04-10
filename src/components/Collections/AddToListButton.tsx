import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  BookmarkIcon,
  CheckIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Collections.AddToListButton', {
  addToList: 'Add to List',
  addedToList: 'In List',
  createNewList: '+ Create New List',
  addToDefault: 'Add to Watchlist',
});

interface AddToListButtonProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title?: string;
}

interface UserListSummary {
  id: number;
  name: string;
  isDefault: boolean;
  itemCount: number;
}

const AddToListButton = ({
  tmdbId,
  mediaType,
  title,
}: AddToListButtonProps) => {
  const intl = useIntl();
  const { user } = useUser();
  const [showDropdown, setShowDropdown] = useState(false);
  const [addedToLists, setAddedToLists] = useState<Set<number>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [showNewListInput, setShowNewListInput] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: listsData, mutate } = useSWR<{ results: UserListSummary[] }>(
    user?.id ? `/api/v1/user/${user.id}/lists` : null
  );

  const lists = listsData?.results ?? [];

  // Check which lists already contain this item
  useEffect(() => {
    if (!user?.id || lists.length === 0) return;

    const checkLists = async () => {
      const inLists = new Set<number>();
      for (const list of lists) {
        try {
          const res = await fetch(
            `/api/v1/user/${user.id}/lists/${list.id}`
          );
          if (res.ok) {
            const data = await res.json();
            const found = data.items?.some(
              (item: { tmdbId: number; mediaType: string }) =>
                item.tmdbId === tmdbId && item.mediaType === mediaType
            );
            if (found) {
              inLists.add(list.id);
            }
          }
        } catch {
          // Ignore errors
        }
      }
      setAddedToLists(inLists);
    };

    checkLists();
  }, [user?.id, lists, tmdbId, mediaType]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
        setShowNewListInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddToList = useCallback(
    async (listId: number) => {
      if (!user?.id || isAdding) return;
      setIsAdding(true);

      try {
        if (addedToLists.has(listId)) {
          // Remove from list - need to find the item ID first
          const res = await fetch(
            `/api/v1/user/${user.id}/lists/${listId}`
          );
          if (res.ok) {
            const data = await res.json();
            const item = data.items?.find(
              (i: { tmdbId: number; mediaType: string }) =>
                i.tmdbId === tmdbId && i.mediaType === mediaType
            );
            if (item) {
              await fetch(
                `/api/v1/user/${user.id}/lists/${listId}/items/${item.id}`,
                { method: 'DELETE' }
              );
              setAddedToLists((prev) => {
                const next = new Set(prev);
                next.delete(listId);
                return next;
              });
            }
          }
        } else {
          // Add to list
          const res = await fetch(
            `/api/v1/user/${user.id}/lists/${listId}/items`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tmdbId, mediaType, title }),
            }
          );
          if (res.ok) {
            setAddedToLists((prev) => new Set(prev).add(listId));
          }
        }
      } catch {
        // Handle error silently
      } finally {
        setIsAdding(false);
      }
    },
    [user?.id, tmdbId, mediaType, title, isAdding, addedToLists]
  );

  const handleQuickAdd = useCallback(async () => {
    // Quick add to default list
    const defaultList = lists.find((l) => l.isDefault);
    if (defaultList) {
      await handleAddToList(defaultList.id);
    } else if (lists.length > 0) {
      await handleAddToList(lists[0].id);
    } else {
      // No lists yet — auto-create a "Default" list and add to it
      if (!user?.id) return;
      try {
        const res = await fetch(`/api/v1/user/${user.id}/lists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Default' }),
        });
        if (res.ok) {
          const newList = await res.json();
          mutate();
          await handleAddToList(newList.id);
        }
      } catch {
        // Handle error silently
      }
    }
  }, [lists, handleAddToList, user?.id, mutate]);

  const handleCreateAndAdd = useCallback(async () => {
    if (!user?.id || !newListName.trim()) return;
    try {
      const res = await fetch(`/api/v1/user/${user.id}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (res.ok) {
        const newList = await res.json();
        mutate();
        await handleAddToList(newList.id);
        setNewListName('');
        setShowNewListInput(false);
      }
    } catch {
      // Handle error silently
    }
  }, [user?.id, newListName, mutate, handleAddToList]);

  const handleMouseDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setShowDropdown(true);
    }, 500);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  }, []);

  const isInAnyList = addedToLists.size > 0;

  if (!user) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex">
        {/* Main button - quick add to default */}
        <button
          onClick={handleQuickAdd}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          className={`flex items-center gap-1.5 rounded-l-lg px-3 py-2 text-sm font-medium transition ${
            isInAnyList
              ? 'bg-indigo-600 text-white hover:bg-indigo-500'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
          }`}
          title={intl.formatMessage(messages.addToDefault)}
        >
          {isInAnyList ? (
            <BookmarkSolidIcon className="h-4 w-4" />
          ) : (
            <BookmarkIcon className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">
            {isInAnyList
              ? intl.formatMessage(messages.addedToList)
              : intl.formatMessage(messages.addToList)}
          </span>
        </button>

        {/* Dropdown toggle */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className={`rounded-r-lg border-l border-gray-600 px-2 py-2 transition ${
            isInAnyList
              ? 'bg-indigo-600 text-white hover:bg-indigo-500'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
          }`}
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg bg-gray-800 shadow-lg ring-1 ring-gray-700">
          <div className="max-h-64 overflow-y-auto py-1">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => handleAddToList(list.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 transition hover:bg-gray-700"
              >
                {addedToLists.has(list.id) ? (
                  <CheckIcon className="h-4 w-4 shrink-0 text-indigo-400" />
                ) : (
                  <div className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate">{list.name}</span>
                {list.isDefault && (
                  <span className="ml-auto shrink-0 text-xs text-indigo-400">
                    ★
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-gray-700 p-2">
            {showNewListInput ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateAndAdd();
                    if (e.key === 'Escape') setShowNewListInput(false);
                  }}
                  placeholder="List name..."
                  className="flex-1 rounded border-0 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-400 focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
                <button
                  onClick={handleCreateAndAdd}
                  disabled={!newListName.trim()}
                  className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewListInput(true)}
                className="w-full rounded px-2 py-1.5 text-left text-sm text-indigo-400 transition hover:bg-gray-700"
              >
                {intl.formatMessage(messages.createNewList)}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AddToListButton;
