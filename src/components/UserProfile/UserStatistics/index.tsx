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
  GlobeAltIcon,
  SparklesIcon,
  StarIcon,
  TvIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import type { UserStatisticsResponse } from '@server/interfaces/api/userInterfaces';
import { useRouter } from 'next/router';
import { useState } from 'react';
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
  genreEvolution: 'Genre Evolution Over Time',
  libraryUtilization: 'Library Exploration',
  libraryUtilizationDesc:
    'Of {totalMovies} movies and {totalShows} TV shows ({totalEpisodes} episodes) on the server, you\'ve watched {watchedMovies} movies and {watchedShows} shows ({watchedEpisodes} episodes).',
  libraryPlayful: 'There\'s a whole world out there.',
  libraryExplored: 'You\'ve explored {percentage}% of the library.',
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

// Color palette for genre lines in the evolution chart
const GENRE_COLORS = [
  { line: 'bg-indigo-500', text: 'text-indigo-400', dot: 'bg-indigo-400' },
  { line: 'bg-emerald-500', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  { line: 'bg-amber-500', text: 'text-amber-400', dot: 'bg-amber-400' },
  { line: 'bg-rose-500', text: 'text-rose-400', dot: 'bg-rose-400' },
  { line: 'bg-purple-500', text: 'text-purple-400', dot: 'bg-purple-400' },
  { line: 'bg-cyan-500', text: 'text-cyan-400', dot: 'bg-cyan-400' },
];

const GenreEvolutionChart = ({
  genresByMonth,
}: {
  genresByMonth: UserStatisticsResponse['genresByMonth'];
}) => {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    week: string;
    genres: Array<{ name: string; count: number; colorIdx: number }>;
  } | null>(null);
  const [showPercentage, setShowPercentage] = useState(false);

  if (!genresByMonth || genresByMonth.length === 0) return null;

  // Determine top 5 genres across all time periods; group the rest as "Other"
  const globalGenreCounts = new Map<string, number>();
  for (const period of genresByMonth) {
    for (const g of period.genres) {
      globalGenreCounts.set(
        g.name,
        (globalGenreCounts.get(g.name) ?? 0) + g.count
      );
    }
  }
  const topGenreNames = Array.from(globalGenreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  const allGenreNames = [...topGenreNames, 'Other'];

  // Take the last 24 periods (weeks) at most
  const recentPeriods = genresByMonth.slice(-24);

  // Parse period keys to actual dates for true time scaling
  const parsePeriodToDate = (key: string): Date => {
    // Support both "YYYY-Www" (weekly) and "YYYY-MM" (monthly) formats
    const weekMatch = key.match(/^(\d{4})-W(\d{2})$/);
    if (weekMatch) {
      const year = parseInt(weekMatch[1], 10);
      const week = parseInt(weekMatch[2], 10);
      // Calculate date from ISO week number (approximate: Jan 1 + (week-1)*7 days)
      const jan1 = new Date(year, 0, 1);
      const dayOffset = (week - 1) * 7 - jan1.getDay() + 1;
      return new Date(year, 0, 1 + dayOffset);
    }
    // Monthly format: "YYYY-MM"
    const [yearStr, monthStr] = key.split('-');
    return new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1);
  };

  const periodDates = recentPeriods.map((p) => parsePeriodToDate(p.month));
  const minDate = periodDates.length > 0 ? periodDates[0].getTime() : 0;
  const maxDate =
    periodDates.length > 0
      ? periodDates[periodDates.length - 1].getTime()
      : 0;
  const dateRange = maxDate - minDate || 1;

  // Build data matrix: for each genre (top 5 + Other), get count per period
  const genreData = allGenreNames.map((genre) =>
    recentPeriods.map((m) => {
      if (genre === 'Other') {
        return m.genres
          .filter((x) => !topGenreNames.includes(x.name))
          .reduce((sum, x) => sum + x.count, 0);
      }
      const g = m.genres.find((x) => x.name === genre);
      return g?.count ?? 0;
    })
  );

  // Compute stacked values and totals per period
  const periodTotals = recentPeriods.map((_, pIdx) =>
    genreData.reduce((sum, gd) => sum + gd[pIdx], 0)
  );

  // For absolute view: max of stacked totals
  const maxStackedVal = Math.max(...periodTotals, 1);

  // SVG dimensions
  const svgWidth = 600;
  const svgHeight = 200;
  const padding = { top: 10, right: 15, bottom: 30, left: 40 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  // X position from date
  const xFromDate = (date: Date) =>
    padding.left + ((date.getTime() - minDate) / dateRange) * chartWidth;

  // Y position from value (0 at bottom, max at top)
  const yFromVal = (val: number) =>
    padding.top + chartHeight - (val / maxStackedVal) * chartHeight;
  const yFromPct = (pct: number) =>
    padding.top + chartHeight - (pct / 100) * chartHeight;

  // Build stacked area paths
  const stackedPaths: string[] = [];
  const cumulativeBottom: number[] = genreData[0].map(() => 0);

  for (let gIdx = 0; gIdx < allGenreNames.length; gIdx++) {
    const topLine: Array<{ x: number; y: number }> = [];
    const bottomLine: Array<{ x: number; y: number }> = [];

    for (let pIdx = 0; pIdx < recentPeriods.length; pIdx++) {
      const x = xFromDate(periodDates[pIdx]);
      const rawVal = genreData[gIdx][pIdx];
      const cumBottom = cumulativeBottom[pIdx];

      if (showPercentage) {
        const total = periodTotals[pIdx] || 1;
        const pctBottom = (cumBottom / total) * 100;
        const pctTop = ((cumBottom + rawVal) / total) * 100;
        topLine.push({ x, y: yFromPct(pctTop) });
        bottomLine.push({ x, y: yFromPct(pctBottom) });
      } else {
        topLine.push({ x, y: yFromVal(cumBottom + rawVal) });
        bottomLine.push({ x, y: yFromVal(cumBottom) });
      }

      cumulativeBottom[pIdx] = cumBottom + rawVal;
    }

    // Build SVG path: top line forward, then bottom line reversed
    const topPath = topLine
      .map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`))
      .join(' ');
    const bottomPath = [...bottomLine]
      .reverse()
      .map((p) => `L${p.x},${p.y}`)
      .join(' ');
    stackedPaths.push(`${topPath} ${bottomPath} Z`);
  }

  // Y-axis tick values
  const yTicks = showPercentage
    ? [0, 25, 50, 75, 100]
    : Array.from({ length: 5 }, (_, i) =>
        Math.round((maxStackedVal / 4) * i)
      );

  // X-axis labels: show ~6 evenly spaced labels
  const labelCount = Math.min(6, recentPeriods.length);
  const labelIndices = Array.from({ length: labelCount }, (_, i) =>
    Math.round((i / (labelCount - 1 || 1)) * (recentPeriods.length - 1))
  );
  const formatDate = (d: Date) => {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  };

  // Generate insight text
  const firstPeriod = recentPeriods[0];
  const lastPeriod = recentPeriods[recentPeriods.length - 1];
  const firstTopGenre = firstPeriod?.genres[0]?.name;
  const lastTopGenre = lastPeriod?.genres[0]?.name;
  const firstLabel = periodDates[0] ? formatDate(periodDates[0]) : '';
  const lastLabel =
    periodDates.length > 0
      ? formatDate(periodDates[periodDates.length - 1])
      : '';
  const insightText =
    firstTopGenre && lastTopGenre && firstTopGenre !== lastTopGenre
      ? `Around ${firstLabel} you were all about ${firstTopGenre}, but by ${lastLabel} you pivoted to ${lastTopGenre}.`
      : firstTopGenre
        ? `${firstTopGenre} has been your consistent favorite.`
        : '';

  // Stacked area fill colors (solid Tailwind classes mapped to hex for SVG)
  const GENRE_HEX = [
    '#6366f1', // indigo-500
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#f43f5e', // rose-500
    '#a855f7', // purple-500
    '#64748b', // slate-500 (for "Other")
  ];

  return (
    <div className="rounded-xl bg-gray-800 p-4">
      {/* Legend + toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {allGenreNames.map((genre, i) => (
          <div key={genre} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: GENRE_HEX[i % GENRE_HEX.length] }}
            />
            <span className="text-xs text-gray-300">{genre}</span>
          </div>
        ))}
        <button
          onClick={() => setShowPercentage(!showPercentage)}
          className="ml-auto rounded-md bg-gray-700 px-2 py-1 text-xs text-gray-300 transition hover:bg-gray-600"
        >
          {showPercentage ? '#' : '%'}
        </button>
      </div>

      {/* Chart area */}
      <div
        className="relative"
        onMouseLeave={() => setTooltip(null)}
      >
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Horizontal grid lines */}
          {yTicks.map((tick) => {
            const y = showPercentage ? yFromPct(tick) : yFromVal(tick);
            return (
              <line
                key={tick}
                x1={padding.left}
                x2={svgWidth - padding.right}
                y1={y}
                y2={y}
                stroke="#374151"
                strokeWidth="0.5"
                strokeDasharray="4 2"
              />
            );
          })}

          {/* Y-axis labels */}
          {yTicks.map((tick) => {
            const y = showPercentage ? yFromPct(tick) : yFromVal(tick);
            return (
              <text
                key={`label-${tick}`}
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-gray-500"
                fontSize="10"
              >
                {showPercentage ? `${tick}%` : tick}
              </text>
            );
          })}

          {/* Y-axis title */}
          <text
            x={12}
            y={padding.top + chartHeight / 2}
            textAnchor="middle"
            className="fill-gray-500"
            fontSize="10"
            transform={`rotate(-90, 12, ${padding.top + chartHeight / 2})`}
          >
            {showPercentage ? '% of titles' : '# of titles watched'}
          </text>

          {/* Stacked area paths */}
          {stackedPaths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill={GENRE_HEX[i % GENRE_HEX.length]}
              fillOpacity={0.7}
              stroke={GENRE_HEX[i % GENRE_HEX.length]}
              strokeWidth="1"
            />
          ))}

          {/* Invisible hover zones for tooltips */}
          {recentPeriods.map((period, pIdx) => {
            const x = xFromDate(periodDates[pIdx]);
            const halfGap =
              recentPeriods.length > 1 ? chartWidth / (recentPeriods.length - 1) / 2 : chartWidth / 2;
            return (
              <rect
                key={pIdx}
                x={x - halfGap}
                y={padding.top}
                width={halfGap * 2}
                height={chartHeight}
                fill="transparent"
                onMouseEnter={(e) => {
                  const svg = e.currentTarget.ownerSVGElement;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  const tooltipX =
                    ((x / svgWidth) * rect.width) + rect.left;
                  const tooltipY = rect.top + padding.top;
                  setTooltip({
                    x: tooltipX,
                    y: tooltipY,
                    week: formatDate(periodDates[pIdx]),
                    genres: allGenreNames.map((name, gIdx) => ({
                      name,
                      count: genreData[gIdx][pIdx],
                      colorIdx: gIdx,
                    })).filter((g) => g.count > 0),
                  });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {/* X-axis labels */}
          {labelIndices.map((idx) => {
            const x = xFromDate(periodDates[idx]);
            return (
              <text
                key={idx}
                x={x}
                y={svgHeight - 5}
                textAnchor="middle"
                className="fill-gray-500"
                fontSize="10"
              >
                {formatDate(periodDates[idx])}
              </text>
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none fixed z-50 rounded-lg bg-gray-900 px-3 py-2 shadow-lg ring-1 ring-gray-700"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="mb-1 text-xs font-medium text-gray-300">
              {tooltip.week}
            </div>
            {tooltip.genres.map((g) => (
              <div key={g.name} className="flex items-center gap-1.5 text-xs">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor:
                      GENRE_HEX[g.colorIdx % GENRE_HEX.length],
                  }}
                />
                <span className="text-gray-400">{g.name}:</span>
                <span className="font-medium text-white">{g.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Insight text */}
      {insightText && (
        <p className="mt-3 text-sm italic text-gray-400">{insightText}</p>
      )}
    </div>
  );
};

const CircularProgress = ({
  percentage,
  size = 100,
  strokeWidth = 8,
}: {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-gray-700"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-indigo-500 transition-all duration-1000"
      />
    </svg>
  );
};

const LibraryUtilizationCard = ({
  utilization,
  intl,
}: {
  utilization: NonNullable<UserStatisticsResponse['libraryUtilization']>;
  intl: ReturnType<typeof useIntl>;
}) => {
  return (
    <div className="rounded-xl bg-gray-800 p-4 sm:p-6">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
        {/* Circular progress */}
        <div className="relative">
          <CircularProgress percentage={utilization.overallPercentage} size={120} strokeWidth={10} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white">
              {utilization.overallPercentage}%
            </span>
          </div>
        </div>

        {/* Text content */}
        <div className="flex-1 text-center sm:text-left">
          <h3 className="text-lg font-bold text-white">
            {intl.formatMessage(messages.libraryExplored, {
              percentage: utilization.overallPercentage,
            })}
          </h3>
          <p className="mt-1 text-sm text-gray-400">
            {intl.formatMessage(messages.libraryUtilizationDesc, {
              totalMovies: utilization.totalMovies,
              totalShows: utilization.totalShows,
              totalEpisodes: utilization.totalEpisodes,
              watchedMovies: utilization.watchedMovies,
              watchedShows: utilization.watchedShows,
              watchedEpisodes: utilization.watchedEpisodes,
            })}
          </p>
          <p className="mt-2 text-sm italic text-gray-500">
            {intl.formatMessage(messages.libraryPlayful)}
          </p>
        </div>
      </div>
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
    return <ErrorPage statusCode={404} />;
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

          {/* Genre Evolution Over Time */}
          {(stats?.genresByMonth?.length ?? 0) > 1 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <ChartBarIcon className="h-5 w-5 text-purple-400" />
                {intl.formatMessage(messages.genreEvolution)}
              </h2>
              <GenreEvolutionChart
                genresByMonth={stats?.genresByMonth ?? []}
              />
            </section>
          )}

          {/* Library Utilization */}
          {stats?.libraryUtilization && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
                <GlobeAltIcon className="h-5 w-5 text-emerald-400" />
                {intl.formatMessage(messages.libraryUtilization)}
              </h2>
              <LibraryUtilizationCard
                utilization={stats.libraryUtilization}
                intl={intl}
              />
            </section>
          )}
        </div>
      )}
    </>
  );
};

export default UserStatistics;
