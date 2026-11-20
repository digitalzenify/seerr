import type {
  TautulliHistoryRecord,
  TautulliLibrary,
} from '@server/api/tautulli';
import type { User } from '@server/entity/User';
import type {
  UserStatisticsResponse,
  UserWrappedResponse,
} from '@server/interfaces/api/userInterfaces';
import logger from '@server/logger';

/**
 * Everything the statistics page and the yearly wrapped need, computed from
 * Tautulli's play history plus one metadata lookup per distinct title.
 *
 * The metadata lookups are the only slow part (one HTTP call per title), so
 * they are cached in-process for a day; Tautulli's own cache is not reachable
 * from here and genres/actors never change mid-day in practice.
 */
const METADATA_TTL_MS = 12 * 60 * 60 * 1000;
const metadataCache = new Map<
  string,
  { expires: number; data: TautulliMetadataLite }
>();

interface TautulliMetadataLite {
  title?: string;
  year?: number;
  genres?: string[];
  directors?: string[];
  actors?: string[];
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/**
 * ponytail: one timezone for the whole box. Everyone on this server is in
 * Romania, so bucketing "your clock" in UTC would show 20:00 for a 22:00
 * habit. If the server ever serves a second country, move the hour buckets
 * to the client (which knows the viewer's own offset).
 */
const DISPLAY_TIMEZONE = 'Europe/Bucharest';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  hour: 'numeric',
  hour12: false,
});
const weekdayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  weekday: 'short',
});

/** YYYY-MM-DD in the server's display timezone. */
function isoDay(date: Date): string {
  return dayFormatter.format(date);
}

function localHour(date: Date): number {
  return Number(hourFormatter.format(date)) % 24;
}

function localWeekday(date: Date): number {
  const short = weekdayFormatter.format(date);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
}

/** Simplified week key, kept identical to the shape the statistics UI expects. */
function weekKey(date: Date): string {
  const year = date.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayOfYear =
    Math.floor((date.getTime() - jan1.getTime()) / 86400000) + 1;
  return `${year}-W${String(
    Math.ceil((dayOfYear + jan1.getDay()) / 7)
  ).padStart(2, '0')}`;
}

export interface WatchAggregate {
  plays: number;
  moviePlays: number;
  episodePlays: number;
  totalMinutes: number;
  uniqueMovies: Set<string>;
  shows: Map<string, number>;
  showHours: Map<string, number>;
  showKeys: Map<string, string>;
  movies: Map<string, number>;
  movieKeys: Map<string, string>;
  genres: Map<string, number>;
  actors: Map<string, number>;
  directors: Map<string, number>;
  decades: Map<string, number>;
  platform: Map<string, number>;
  dayMinutes: Map<string, number>;
  hourPlays: number[];
  weekdayPlays: number[];
  genresByWeek: Map<string, Map<string, number>>;
  firstPlay: { title: string; date: Date } | null;
  lastPlay: { title: string; date: Date } | null;
  longestStreak: { days: number; start: Date } | null;
  currentStreak: number;
  longestBinge: { date: Date; show: string; episodes: number } | null;
}

/**
 * Fetch every play for the user (optionally limited to a year) and fold it into
 * one aggregate. Metadata is fetched once per distinct title, not per play.
 */
export async function collectWatchAggregate(
  tautulli: {
    getUserHistory: (
      user: User,
      opts?: { after?: string; before?: string }
    ) => Promise<TautulliHistoryRecord[]>;
    getMetadata: (ratingKey: string) => Promise<TautulliMetadataLite>;
  },
  user: User,
  opts: { year?: number } = {}
): Promise<WatchAggregate> {
  const range = opts.year
    ? {
        after: `${opts.year}-01-01`,
        before: `${opts.year + 1}-01-01`,
      }
    : {};

  const plays = await tautulli.getUserHistory(user, range);

  const agg: WatchAggregate = {
    plays: plays.length,
    moviePlays: 0,
    episodePlays: 0,
    totalMinutes: 0,
    uniqueMovies: new Set(),
    shows: new Map(),
    showHours: new Map(),
    showKeys: new Map(),
    movies: new Map(),
    movieKeys: new Map(),
    genres: new Map(),
    actors: new Map(),
    directors: new Map(),
    decades: new Map(),
    platform: new Map(),
    dayMinutes: new Map(),
    hourPlays: Array(24).fill(0),
    weekdayPlays: Array(7).fill(0),
    genresByWeek: new Map(),
    firstPlay: null,
    lastPlay: null,
    longestStreak: null,
    currentStreak: 0,
    longestBinge: null,
  };

  if (!plays.length) {
    return agg;
  }

  // One metadata call per distinct title (a show, for episodes).
  const keys = new Set<string>();
  for (const play of plays) {
    const key =
      play.media_type === 'episode'
        ? play.grandparent_rating_key
        : play.rating_key;
    if (key) keys.add(String(key));
  }
  const metadata = await fetchMetadata(tautulli, Array.from(keys));

  const perDayShow = new Map<string, Map<string, number>>();
  const daySet = new Set<string>();

  for (const play of plays) {
    const date = new Date(play.date * 1000);
    const minutes = (play.play_duration ?? 0) / 60;
    const meta = metadata.get(
      String(
        play.media_type === 'episode'
          ? play.grandparent_rating_key
          : play.rating_key
      )
    );

    agg.totalMinutes += minutes;
    const day = isoDay(date);
    daySet.add(day);
    agg.dayMinutes.set(day, (agg.dayMinutes.get(day) ?? 0) + minutes);
    agg.hourPlays[localHour(date)] += 1;
    agg.weekdayPlays[localWeekday(date)] += 1;
    agg.platform.set(
      play.platform ?? 'Unknown',
      (agg.platform.get(play.platform ?? 'Unknown') ?? 0) + 1
    );

    if (play.media_type === 'episode') {
      agg.episodePlays += 1;
      const show = play.grandparent_title || meta?.title || 'Unknown';
      agg.shows.set(show, (agg.shows.get(show) ?? 0) + 1);
      agg.showHours.set(show, (agg.showHours.get(show) ?? 0) + minutes);
      agg.showKeys.set(show, String(play.grandparent_rating_key ?? ''));

      if (!perDayShow.has(day)) perDayShow.set(day, new Map());
      const dayShows = perDayShow.get(day)!;
      dayShows.set(show, (dayShows.get(show) ?? 0) + 1);
    } else {
      agg.moviePlays += 1;
      const title = play.title || meta?.title || 'Unknown';
      agg.uniqueMovies.add(String(play.rating_key));
      agg.movies.set(title, (agg.movies.get(title) ?? 0) + 1);
      agg.movieKeys.set(title, String(play.rating_key ?? ''));
    }

    for (const genre of meta?.genres ?? []) {
      agg.genres.set(genre, (agg.genres.get(genre) ?? 0) + 1);
      const wk = weekKey(date);
      if (!agg.genresByWeek.has(wk)) agg.genresByWeek.set(wk, new Map());
      const weekGenres = agg.genresByWeek.get(wk)!;
      weekGenres.set(genre, (weekGenres.get(genre) ?? 0) + 1);
    }
    for (const actor of (meta?.actors ?? []).slice(0, 8)) {
      agg.actors.set(actor, (agg.actors.get(actor) ?? 0) + 1);
    }
    for (const director of meta?.directors ?? []) {
      agg.directors.set(director, (agg.directors.get(director) ?? 0) + 1);
    }
    if (meta?.year) {
      const decade = `${Math.floor(meta.year / 10) * 10}s`;
      agg.decades.set(decade, (agg.decades.get(decade) ?? 0) + 1);
    }

    const label =
      play.media_type === 'episode'
        ? `${play.grandparent_title} - ${play.title}`
        : play.title;
    if (!agg.firstPlay || date < agg.firstPlay.date) {
      agg.firstPlay = { title: label, date };
    }
    if (!agg.lastPlay || date > agg.lastPlay.date) {
      agg.lastPlay = { title: label, date };
    }
  }

  // Longest streak over distinct days.
  const days = Array.from(daySet).sort();
  let run = 1;
  let runStart = days[0];
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const curr = new Date(days[i]);
    if (Math.round((curr.getTime() - prev.getTime()) / 86400000) === 1) {
      run += 1;
    } else {
      run = 1;
      runStart = days[i];
    }
    if (!agg.longestStreak || run > agg.longestStreak.days) {
      agg.longestStreak = { days: run, start: new Date(runStart) };
    }
  }
  if (days.length === 1) {
    agg.longestStreak = { days: 1, start: new Date(days[0]) };
  }

  // Current streak (a streak that ended weeks ago is not "current").
  const last = days[days.length - 1];
  const today = isoDay(new Date());
  const yesterday = isoDay(new Date(Date.now() - 86400000));
  if (last === today || last === yesterday) {
    let current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const prev = new Date(days[i - 1]);
      const curr = new Date(days[i]);
      if (Math.round((curr.getTime() - prev.getTime()) / 86400000) === 1) {
        current += 1;
      } else {
        break;
      }
    }
    agg.currentStreak = current;
  }

  // Biggest single-day single-show binge.
  for (const [day, shows] of perDayShow) {
    for (const [show, count] of shows) {
      if (
        !agg.longestBinge ||
        count > agg.longestBinge.episodes ||
        (count === agg.longestBinge.episodes &&
          new Date(day) > agg.longestBinge.date)
      ) {
        agg.longestBinge = { date: new Date(day), show, episodes: count };
      }
    }
  }

  return agg;
}

async function fetchMetadata(
  tautulli: {
    getMetadata: (ratingKey: string) => Promise<TautulliMetadataLite>;
  },
  keys: string[]
): Promise<Map<string, TautulliMetadataLite>> {
  const result = new Map<string, TautulliMetadataLite>();
  const now = Date.now();
  const missing: string[] = [];

  for (const key of keys) {
    const hit = metadataCache.get(key);
    if (hit && hit.expires > now) {
      result.set(key, hit.data);
    } else {
      missing.push(key);
    }
  }

  const chunkSize = 6;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (key) => {
        try {
          const data = await tautulli.getMetadata(key);
          metadataCache.set(key, { expires: now + METADATA_TTL_MS, data });
          result.set(key, data);
        } catch (e) {
          logger.debug('Tautulli metadata lookup failed for a watched title', {
            label: 'Watch Stats',
            ratingKey: key,
            message: e.message,
          });
        }
      })
    );
  }

  return result;
}

const top = (map: Map<string, number>, n: number) =>
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));

const maxOf = (counts: number[]) => counts.indexOf(Math.max(...counts));

/** Map an aggregate onto the existing statistics response (client unchanged). */
export function toStatisticsResponse(
  agg: WatchAggregate,
  libraries: TautulliLibrary[] | null
): UserStatisticsResponse {
  const firstWatch = agg.firstPlay?.date;
  const weeksSinceFirst = firstWatch
    ? Math.max(1, (Date.now() - firstWatch.getTime()) / (7 * 86400000))
    : 1;

  const sortedWeekKeys = Array.from(agg.genresByWeek.keys()).sort();
  const topShow = top(agg.shows, 1)[0];

  let libraryUtilization: UserStatisticsResponse['libraryUtilization'] = null;
  if (libraries?.length) {
    const movieSection = libraries.filter((l) => l.section_type === 'movie');
    const showSection = libraries.filter((l) => l.section_type === 'show');
    const totalMovies = movieSection.reduce(
      (sum, l) => sum + Number(l.count ?? 0),
      0
    );
    const totalShows = showSection.reduce(
      (sum, l) => sum + Number(l.count ?? 0),
      0
    );
    const totalEpisodes = showSection.reduce(
      (sum, l) => sum + Number(l.child_count ?? 0),
      0
    );
    const totalItems = totalMovies + totalShows;
    libraryUtilization = {
      totalMovies,
      totalShows,
      totalEpisodes,
      watchedMovies: agg.uniqueMovies.size,
      watchedShows: agg.shows.size,
      watchedEpisodes: agg.episodePlays,
      overallPercentage:
        totalItems > 0
          ? Math.round(
              ((agg.uniqueMovies.size + agg.shows.size) / totalItems) * 1000
            ) / 10
          : 0,
    };
  }

  return {
    totalMoviesWatched: agg.uniqueMovies.size,
    totalEpisodesWatched: agg.episodePlays,
    totalWatchTimeMinutes: Math.round(agg.totalMinutes),
    averageWatchTimePerWeekMinutes: Math.round(
      agg.totalMinutes / weeksSinceFirst
    ),
    topGenres: top(agg.genres, 5),
    favoriteDecade: top(agg.decades, 1)[0]?.name ?? null,
    topActors: top(agg.actors, 5),
    topDirectors: top(agg.directors, 5),
    mostWatchedShow: topShow
      ? { name: topShow.name, episodeCount: topShow.count }
      : null,
    currentStreak: agg.currentStreak,
    longestStreak: agg.longestStreak?.days ?? 0,
    requestsMade: 0,
    requestsFulfilled: 0,
    mostRecentWatch: agg.lastPlay
      ? { title: agg.lastPlay.title, date: agg.lastPlay.date.toISOString() }
      : null,
    preferredWatchingHour: agg.plays ? maxOf(agg.hourPlays) : null,
    mostActiveDay: agg.plays ? DAY_NAMES[maxOf(agg.weekdayPlays)] : null,
    genresByMonth: sortedWeekKeys.map((month) => ({
      month,
      genres: top(agg.genresByWeek.get(month)!, 5),
    })),
    libraryUtilization,
  };
}

/**
 * Watch personality. Deliberately a handful of rules over data we already
 * have — a scouting report, not a model.
 */
function personalityOf(agg: WatchAggregate): {
  key: string;
  name: string;
  line: string;
} {
  const topShow = top(agg.shows, 1)[0];
  const share = topShow ? topShow.count / Math.max(1, agg.plays) : 0;
  const topGenre = top(agg.genres, 1)[0];
  const genreShare = topGenre ? topGenre.count / Math.max(1, agg.plays) : 0;
  const daysActive = agg.dayMinutes.size;

  if (share >= 0.5) {
    return {
      key: 'comfort-rewatcher',
      name: 'The Comfort Rewatcher',
      line: 'You do not need new shows. You need the one that already works: same hour, same sofa, another episode.',
    };
  }
  if (agg.shows.size > 0 && agg.shows.size <= 8 && daysActive > 0) {
    return {
      key: 'marathoner',
      name: 'The Marathoner',
      line: `Only ${agg.shows.size} shows all year, and you went all the way through them. Depth over variety, every time.`,
    };
  }
  if (agg.longestBinge && agg.longestBinge.episodes >= 10) {
    return {
      key: 'one-sitting-binger',
      name: 'The One-Sitting Binger',
      line: `${agg.longestBinge.episodes} episodes in a single day is not a habit. It is a decision you made once, thoroughly.`,
    };
  }
  if (agg.totalMinutes / 60 >= 100 && agg.shows.size >= 12) {
    return {
      key: 'genre-nomad',
      name: 'The Genre Nomad',
      line: 'New show, new world, next. You cover ground faster than anyone else on this server.',
    };
  }
  if (genreShare >= 0.7) {
    return {
      key: 'genre-loyalist',
      name: `The ${topGenre.name} Loyalist`,
      line: `${Math.round(genreShare * 100)}% of what you played was ${topGenre.name.toLowerCase()}. You know what you like and you are not apologising for it.`,
    };
  }
  return {
    key: 'steady-viewer',
    name: 'The Steady Viewer',
    line: 'No obsessions, no droughts. You showed up, watched something good, and went to bed at a reasonable hour.',
  };
}

/** The wrapped payload. Numbers only — formatting lives in the client. */
export function toWrappedResponse(
  agg: WatchAggregate,
  year: number
): UserWrappedResponse {
  const topShow = top(agg.shows, 1)[0];
  const movieEntry = top(agg.movies, 1)[0];
  const peakHour = agg.plays ? maxOf(agg.hourPlays) : 0;
  const busiest = Array.from(agg.dayMinutes.entries()).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const topPlatform = top(agg.platform, 1)[0];
  const daysActive = agg.dayMinutes.size;

  return {
    year,
    plays: agg.plays,
    hours: Math.round((agg.totalMinutes / 60) * 10) / 10,
    daysActive,
    moviePlays: agg.moviePlays,
    episodePlays: agg.episodePlays,
    uniqueMovies: agg.uniqueMovies.size,
    uniqueShows: agg.shows.size,
    averageSessionMinutes: daysActive
      ? Math.round(agg.totalMinutes / daysActive)
      : 0,
    topShow: topShow
      ? {
          title: topShow.name,
          episodes: topShow.count,
          hours:
            Math.round(((agg.showHours.get(topShow.name) ?? 0) / 60) * 10) / 10,
          share: Math.round((topShow.count / Math.max(1, agg.plays)) * 100),
          ratingKey: agg.showKeys.get(topShow.name) || null,
        }
      : null,
    topMovie: movieEntry
      ? {
          title: movieEntry.name,
          plays: movieEntry.count,
          ratingKey: agg.movieKeys.get(movieEntry.name) || null,
        }
      : null,
    genres: top(agg.genres, 5).map(({ name, count }) => ({
      name,
      share: Math.round((count / Math.max(1, agg.plays)) * 100),
    })),
    actors: top(agg.actors, 3).map(({ name }) => name),
    directors: top(agg.directors, 3).map(({ name }) => name),
    favoriteDecade: top(agg.decades, 1)[0]?.name ?? null,
    longestBinge: agg.longestBinge
      ? {
          date: isoDay(agg.longestBinge.date),
          show: agg.longestBinge.show,
          episodes: agg.longestBinge.episodes,
        }
      : null,
    busiestDay: busiest
      ? { date: busiest[0], minutes: Math.round(busiest[1]) }
      : null,
    longestStreak: agg.longestStreak
      ? {
          days: agg.longestStreak.days,
          start: isoDay(agg.longestStreak.start),
        }
      : null,
    peakHour,
    peakHourPlays: agg.hourPlays,
    peakWeekday: agg.plays ? DAY_NAMES[maxOf(agg.weekdayPlays)] : null,
    topPlatform: topPlatform
      ? {
          name: topPlatform.name,
          share: Math.round((topPlatform.count / Math.max(1, agg.plays)) * 100),
        }
      : null,
    firstPlay: agg.firstPlay
      ? { title: agg.firstPlay.title, date: isoDay(agg.firstPlay.date) }
      : null,
    personality: personalityOf(agg),
  };
}
