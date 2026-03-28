import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProfileHeader from '@app/components/UserProfile/ProfileHeader';
import { useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import {
  ChartBarIcon,
  ClockIcon,
  FilmIcon,
  FireIcon,
  SparklesIcon,
  StarIcon,
  TvIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import type { UserStatisticsResponse } from '@server/interfaces/api/userInterfaces';
import { useRouter } from 'next/router';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.UserStatistics', {
  statistics: 'Statistics',
  viewingActivity: 'Viewing Activity',
  moviesWatched: 'Movies Watched',
  episodesWatched: 'Episodes Watched',
  totalWatchTime: 'Total Watch Time',
  avgPerWeek: 'Average per Week',
  preferences: 'Preferences & Patterns',
  topGenres: 'Top Genres',
  favoriteDecade: 'Favorite Decade',
  topActors: 'Top Actors',
  topDirectors: 'Top Directors',
  mostWatchedShow: 'Most Watched Show',
  funStats: 'Fun Stats',
  currentStreak: 'Current Streak',
  longestStreak: 'Longest Streak',
  requestsStats: 'Requests',
  requestsFulfilled: '{count} fulfilled',
  mostRecentWatch: 'Most Recent Watch',
  timeInsights: 'Time-Based Insights',
  preferredTime: 'Preferred Watching Time',
  mostActiveDay: 'Most Active Day',
  days: '{count, plural, one {# day} other {# days}}',
  episodes: '{count, plural, one {# episode} other {# episodes}}',
  noData: 'No viewing data available yet. Start watching to see your stats!',
});

function formatWatchTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0
    ? `${days}d ${remainingHours}h`
    : `${days}d`;
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function formatHourRange(hour: number): string {
  const start = formatHour(hour);
  const end = formatHour((hour + 3) % 24);
  return `${start} – ${end}`;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtext?: string;
}

const StatCard = ({ icon, label, value, subtext }: StatCardProps) => (
  <div className="flex items-center gap-3 rounded-xl bg-gray-800 p-4">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="text-sm text-gray-400">{label}</div>
      <div className="truncate text-lg font-bold text-white">{value}</div>
      {subtext && <div className="text-xs text-gray-500">{subtext}</div>}
    </div>
  </div>
);

interface BarChartItem {
  name: string;
  count: number;
}

const HorizontalBarChart = ({
  items,
  color = 'indigo',
}: {
  items: BarChartItem[];
  color?: string;
}) => {
  const max = Math.max(...items.map((i) => i.count), 1);
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-500',
    purple: 'bg-purple-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };
  const bgColor = colorMap[color] ?? 'bg-indigo-500';

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.name} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-sm text-gray-300">
            {item.name}
          </span>
          <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-gray-700">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${bgColor} transition-all duration-500`}
              style={{ width: `${(item.count / max) * 100}%` }}
            />
            <span className="absolute inset-y-0 right-2 flex items-center text-xs font-medium text-white">
              {item.count}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

const UserStatistics = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user: currentUser } = useUser();
  const userId = router.query.userId
    ? Number(router.query.userId)
    : currentUser?.id;
  const { user, error: userError } = useUser({ id: userId });

  const { data: stats, error: statsError } = useSWR<UserStatisticsResponse>(
    userId ? `/api/v1/user/${userId}/statistics` : null
  );

  const isLoading = (!stats && !statsError) || (!user && !userError);

  if (userError) {
    return <ErrorPage statusCode={userError.status} />;
  }

  if (isLoading || !user) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.statistics)} />
        <div className="mt-6 flex justify-center">
          <LoadingSpinner />
        </div>
      </>
    );
  }

  const isEmpty =
    !stats ||
    (stats.totalMoviesWatched === 0 &&
      stats.totalEpisodesWatched === 0 &&
      stats.requestsMade === 0);

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.statistics)} />
      <ProfileHeader user={user} />
      <div className="mt-6">
        <Header>{intl.formatMessage(messages.statistics)}</Header>
      </div>

      {isEmpty ? (
        <div className="mt-8 flex flex-col items-center justify-center rounded-xl bg-gray-800 p-10 text-center">
          <SparklesIcon className="mb-4 h-12 w-12 text-gray-600" />
          <p className="text-lg text-gray-400">
            {intl.formatMessage(messages.noData)}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-8">
          {/* Viewing Activity */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
              <FilmIcon className="h-5 w-5 text-indigo-400" />
              {intl.formatMessage(messages.viewingActivity)}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<FilmIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.moviesWatched)}
                value={stats?.totalMoviesWatched ?? 0}
              />
              <StatCard
                icon={<TvIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.episodesWatched)}
                value={stats?.totalEpisodesWatched ?? 0}
              />
              <StatCard
                icon={<ClockIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.totalWatchTime)}
                value={formatWatchTime(stats?.totalWatchTimeMinutes ?? 0)}
              />
              <StatCard
                icon={<ChartBarIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.avgPerWeek)}
                value={formatWatchTime(
                  stats?.averageWatchTimePerWeekMinutes ?? 0
                )}
              />
            </div>
          </section>

          {/* Preferences & Patterns */}
          {(stats?.topGenres?.length ?? 0) > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <StarIcon className="h-5 w-5 text-amber-400" />
                {intl.formatMessage(messages.preferences)}
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {(stats?.topGenres?.length ?? 0) > 0 && (
                  <div className="rounded-xl bg-gray-800 p-4">
                    <h3 className="mb-3 text-sm font-medium text-gray-400">
                      {intl.formatMessage(messages.topGenres)}
                    </h3>
                    <HorizontalBarChart
                      items={stats?.topGenres ?? []}
                      color="indigo"
                    />
                  </div>
                )}
                <div className="space-y-3">
                  {stats?.favoriteDecade && (
                    <StatCard
                      icon={<SparklesIcon className="h-5 w-5" />}
                      label={intl.formatMessage(messages.favoriteDecade)}
                      value={stats.favoriteDecade}
                    />
                  )}
                  {stats?.mostWatchedShow && (
                    <StatCard
                      icon={<TvIcon className="h-5 w-5" />}
                      label={intl.formatMessage(messages.mostWatchedShow)}
                      value={stats.mostWatchedShow.name}
                      subtext={intl.formatMessage(messages.episodes, {
                        count: stats.mostWatchedShow.episodeCount,
                      })}
                    />
                  )}
                </div>
              </div>
              {((stats?.topActors?.length ?? 0) > 0 ||
                (stats?.topDirectors?.length ?? 0) > 0) && (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {(stats?.topActors?.length ?? 0) > 0 && (
                    <div className="rounded-xl bg-gray-800 p-4">
                      <h3 className="mb-3 flex items-center gap-1 text-sm font-medium text-gray-400">
                        <UserGroupIcon className="h-4 w-4" />
                        {intl.formatMessage(messages.topActors)}
                      </h3>
                      <HorizontalBarChart
                        items={stats?.topActors ?? []}
                        color="purple"
                      />
                    </div>
                  )}
                  {(stats?.topDirectors?.length ?? 0) > 0 && (
                    <div className="rounded-xl bg-gray-800 p-4">
                      <h3 className="mb-3 flex items-center gap-1 text-sm font-medium text-gray-400">
                        <StarIcon className="h-4 w-4" />
                        {intl.formatMessage(messages.topDirectors)}
                      </h3>
                      <HorizontalBarChart
                        items={stats?.topDirectors ?? []}
                        color="emerald"
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Fun / Engagement Stats */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
              <FireIcon className="h-5 w-5 text-orange-400" />
              {intl.formatMessage(messages.funStats)}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<FireIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.currentStreak)}
                value={intl.formatMessage(messages.days, {
                  count: stats?.currentStreak ?? 0,
                })}
              />
              <StatCard
                icon={<SparklesIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.longestStreak)}
                value={intl.formatMessage(messages.days, {
                  count: stats?.longestStreak ?? 0,
                })}
              />
              <StatCard
                icon={<ChartBarIcon className="h-5 w-5" />}
                label={intl.formatMessage(messages.requestsStats)}
                value={stats?.requestsMade ?? 0}
                subtext={intl.formatMessage(messages.requestsFulfilled, {
                  count: stats?.requestsFulfilled ?? 0,
                })}
              />
              {stats?.mostRecentWatch && (
                <StatCard
                  icon={<ClockIcon className="h-5 w-5" />}
                  label={intl.formatMessage(messages.mostRecentWatch)}
                  value={stats.mostRecentWatch.title}
                  subtext={
                    stats.mostRecentWatch.date
                      ? new Date(
                          stats.mostRecentWatch.date
                        ).toLocaleDateString()
                      : ''
                  }
                />
              )}
            </div>
          </section>

          {/* Time-Based Insights */}
          {(stats?.preferredWatchingHour != null ||
            stats?.mostActiveDay) && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <ClockIcon className="h-5 w-5 text-cyan-400" />
                {intl.formatMessage(messages.timeInsights)}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {stats?.preferredWatchingHour != null && (
                  <StatCard
                    icon={<ClockIcon className="h-5 w-5" />}
                    label={intl.formatMessage(messages.preferredTime)}
                    value={formatHourRange(stats.preferredWatchingHour)}
                  />
                )}
                {stats?.mostActiveDay && (
                  <StatCard
                    icon={<ChartBarIcon className="h-5 w-5" />}
                    label={intl.formatMessage(messages.mostActiveDay)}
                    value={stats.mostActiveDay}
                  />
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
};

export default UserStatistics;
