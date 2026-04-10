import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilmIcon,
  FunnelIcon,
  TvIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Calendar', {
  calendar: 'Calendar',
  calendarDescription:
    'Upcoming release dates for movies and TV shows in your collections. Only items with a future release date are shown.',
  filterByList: 'Filter by List',
  allLists: 'All Lists',
  noEvents: 'No upcoming releases found in your collections.',
  noEventsFiltered:
    'No upcoming releases found for the selected lists. Try selecting different lists or clear your filters.',
  today: 'Today',
  movie: 'Movie',
  tvshow: 'TV Show',
});

interface CalendarEvent {
  id: number;
  tmdbId: number;
  mediaType: string;
  title: string;
  date: string;
  posterPath: string | null;
  listId: number;
  listName: string;
  overview: string;
}

interface UserListSummary {
  id: number;
  name: string;
  isDefault: boolean;
  itemCount: number;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarPage = () => {
  const intl = useIntl();
  const { user } = useUser();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedListIds, setSelectedListIds] = useState<number[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null
  );

  const { data: listsData } = useSWR<{ results: UserListSummary[] }>(
    user?.id ? `/api/v1/user/${user.id}/lists` : null
  );

  const listIdsParam =
    selectedListIds.length > 0 ? `?listIds=${selectedListIds.join(',')}` : '';

  const { data: eventsData, isLoading } = useSWR<{ results: CalendarEvent[] }>(
    user?.id
      ? `/api/v1/user/${user.id}/lists/calendar/events${listIdsParam}`
      : null
  );

  const lists = listsData?.results ?? [];
  const events = eventsData?.results ?? [];

  // Calendar grid computation
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  const calendarDays = useMemo(() => {
    const days: Array<{ day: number | null; date: string }> = [];

    // Leading empty cells
    for (let i = 0; i < startDay; i++) {
      days.push({ day: null, date: '' });
    }

    // Month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({ day: d, date: dateStr });
    }

    return days;
  }, [year, month, startDay, daysInMonth]);

  // Map events to dates
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const event of events) {
      const dateKey = event.date.slice(0, 10);
      if (!map[dateKey]) {
        map[dateKey] = [];
      }
      map[dateKey].push(event);
    }
    return map;
  }, [events]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const goToPrevMonth = useCallback(() => {
    setCurrentDate(new Date(year, month - 1, 1));
  }, [year, month]);

  const goToNextMonth = useCallback(() => {
    setCurrentDate(new Date(year, month + 1, 1));
  }, [year, month]);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const toggleListFilter = useCallback(
    (listId: number) => {
      setSelectedListIds((prev) =>
        prev.includes(listId)
          ? prev.filter((id) => id !== listId)
          : [...prev, listId]
      );
    },
    []
  );

  const clearFilters = useCallback(() => {
    setSelectedListIds([]);
  }, []);

  const monthName = currentDate.toLocaleString(intl.locale, { month: 'long' });

  if (!user) return null;

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.calendar)} />
      <div className="mb-4 md:flex md:items-center md:justify-between">
        <Header>{intl.formatMessage(messages.calendar)}</Header>
      </div>

      {/* Description */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-gray-700 bg-gray-800/50 p-4">
        <CalendarDaysIcon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
        <p className="text-sm text-gray-300">
          {intl.formatMessage(messages.calendarDescription)}
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-700 hover:text-white"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <h2 className="min-w-[180px] text-center text-lg font-semibold text-gray-100">
            {monthName} {year}
          </h2>
          <button
            onClick={goToNextMonth}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-700 hover:text-white"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
          <button
            onClick={goToToday}
            className="ml-2 rounded-lg bg-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-600 hover:text-white"
          >
            {intl.formatMessage(messages.today)}
          </button>
        </div>

        {/* Filter */}
        <div className="relative">
          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
              selectedListIds.length > 0
                ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
            }`}
          >
            <FunnelIcon className="h-4 w-4" />
            {intl.formatMessage(messages.filterByList)}
            {selectedListIds.length > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
                {selectedListIds.length}
              </span>
            )}
          </button>

          {showFilterDropdown && (
            <div className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg bg-gray-800 shadow-lg ring-1 ring-gray-700">
              <div className="max-h-64 overflow-y-auto py-1">
                {selectedListIds.length > 0 && (
                  <button
                    onClick={clearFilters}
                    className="flex w-full items-center gap-2 border-b border-gray-700 px-3 py-2 text-left text-sm text-indigo-400 transition hover:bg-gray-700"
                  >
                    <XMarkIcon className="h-4 w-4" />
                    {intl.formatMessage(messages.allLists)}
                  </button>
                )}
                {lists.map((list) => (
                  <button
                    key={list.id}
                    onClick={() => toggleListFilter(list.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 transition hover:bg-gray-700"
                  >
                    <div
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selectedListIds.includes(list.id)
                          ? 'border-indigo-500 bg-indigo-500'
                          : 'border-gray-500'
                      }`}
                    >
                      {selectedListIds.includes(list.id) && (
                        <svg
                          className="h-3 w-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </div>
                    <span className="truncate">{list.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-gray-500">
                      {list.itemCount}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800/30">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-700 bg-gray-800/60">
            {DAYS_OF_WEEK.map((day) => (
              <div
                key={day}
                className="px-1 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-400 sm:px-3 sm:py-3 sm:text-sm"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7">
            {calendarDays.map((cell, idx) => {
              const dayEvents = cell.date ? eventsByDate[cell.date] ?? [] : [];
              const isToday = cell.date === todayStr;
              const isPast =
                cell.date && !isToday && cell.date < todayStr;

              return (
                <div
                  key={idx}
                  className={`min-h-[80px] border-b border-r border-gray-700/50 p-1 sm:min-h-[110px] sm:p-2 ${
                    cell.day === null ? 'bg-gray-900/30' : ''
                  } ${isPast ? 'opacity-50' : ''}`}
                >
                  {cell.day !== null && (
                    <>
                      <div
                        className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium sm:h-7 sm:w-7 sm:text-sm ${
                          isToday
                            ? 'bg-indigo-600 text-white'
                            : 'text-gray-400'
                        }`}
                      >
                        {cell.day}
                      </div>
                      <div className="space-y-0.5 sm:space-y-1">
                        {dayEvents.slice(0, 3).map((event, eventIdx) => (
                          <button
                            key={`${event.tmdbId}-${event.listId}-${eventIdx}`}
                            onClick={() => setSelectedEvent(event)}
                            className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight transition hover:ring-1 hover:ring-indigo-400 sm:text-xs ${
                              event.mediaType === 'movie'
                                ? 'bg-indigo-600/30 text-indigo-300'
                                : 'bg-purple-600/30 text-purple-300'
                            }`}
                            title={event.title}
                          >
                            {event.mediaType === 'movie' ? (
                              <FilmIcon className="hidden h-3 w-3 shrink-0 sm:block" />
                            ) : (
                              <TvIcon className="hidden h-3 w-3 shrink-0 sm:block" />
                            )}
                            <span className="truncate">{event.title}</span>
                          </button>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="px-1 text-[10px] text-gray-500 sm:text-xs">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && events.length === 0 && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-gray-700 bg-gray-800/30 py-16">
          <CalendarDaysIcon className="mb-4 h-16 w-16 text-gray-600" />
          <p className="text-center text-gray-400">
            {selectedListIds.length > 0
              ? intl.formatMessage(messages.noEventsFiltered)
              : intl.formatMessage(messages.noEvents)}
          </p>
        </div>
      )}

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl bg-gray-800 shadow-2xl ring-1 ring-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with poster */}
            <div className="relative flex gap-4 bg-gray-900/50 p-4">
              {selectedEvent.posterPath && (
                <img
                  src={`https://image.tmdb.org/t/p/w92${selectedEvent.posterPath}`}
                  alt={selectedEvent.title}
                  className="h-24 w-16 rounded-lg object-cover shadow-lg"
                />
              )}
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      selectedEvent.mediaType === 'movie'
                        ? 'bg-indigo-600/30 text-indigo-300'
                        : 'bg-purple-600/30 text-purple-300'
                    }`}
                  >
                    {selectedEvent.mediaType === 'movie' ? (
                      <>
                        <FilmIcon className="h-3 w-3" />
                        {intl.formatMessage(messages.movie)}
                      </>
                    ) : (
                      <>
                        <TvIcon className="h-3 w-3" />
                        {intl.formatMessage(messages.tvshow)}
                      </>
                    )}
                  </span>
                </div>
                <Link
                  href={`/${selectedEvent.mediaType === 'movie' ? 'movie' : 'tv'}/${selectedEvent.tmdbId}`}
                  className="text-base font-semibold text-white transition hover:text-indigo-400"
                  onClick={() => setSelectedEvent(null)}
                >
                  {selectedEvent.title}
                </Link>
                <div className="mt-1 text-sm text-gray-400">
                  {new Date(selectedEvent.date.slice(0, 10) + 'T12:00:00').toLocaleDateString(
                    intl.locale,
                    {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    }
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {selectedEvent.listName}
                </div>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="absolute right-2 top-2 rounded-lg p-1 text-gray-400 transition hover:bg-gray-700 hover:text-white"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Overview */}
            {selectedEvent.overview && (
              <div className="border-t border-gray-700 p-4">
                <p className="line-clamp-4 text-sm leading-relaxed text-gray-300">
                  {selectedEvent.overview}
                </p>
              </div>
            )}

            {/* Action */}
            <div className="border-t border-gray-700 p-4">
              <Link
                href={`/${selectedEvent.mediaType === 'movie' ? 'movie' : 'tv'}/${selectedEvent.tmdbId}`}
                className="block w-full rounded-lg bg-indigo-600 py-2 text-center text-sm font-medium text-white transition hover:bg-indigo-500"
                onClick={() => setSelectedEvent(null)}
              >
                View Details
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CalendarPage;
