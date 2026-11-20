import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { PaginatedResponse } from './common';

export interface UserResultsResponse extends PaginatedResponse {
  results: User[];
}

export interface UserRequestsResponse extends PaginatedResponse {
  results: MediaRequest[];
}

export interface QuotaStatus {
  days?: number;
  limit?: number;
  used: number;
  remaining?: number;
  restricted: boolean;
}

export interface QuotaResponse {
  movie: QuotaStatus;
  tv: QuotaStatus;
}

export interface UserWatchDataResponse {
  recentlyWatched: Media[];
  playCount: number;
}

export interface UserStatisticsResponse {
  // Viewing Activity
  totalMoviesWatched: number;
  totalEpisodesWatched: number;
  totalWatchTimeMinutes: number;
  averageWatchTimePerWeekMinutes: number;

  // Preferences & Patterns
  topGenres: { name: string; count: number }[];
  favoriteDecade: string | null;
  topActors: { name: string; count: number }[];
  topDirectors: { name: string; count: number }[];
  mostWatchedShow: { name: string; episodeCount: number } | null;

  // Fun / Engagement Stats
  currentStreak: number;
  longestStreak: number;
  requestsMade: number;
  requestsFulfilled: number;
  mostRecentWatch: { title: string; date: string } | null;

  // Time-Based Insights
  preferredWatchingHour: number | null;
  mostActiveDay: string | null;

  // Genre Evolution Over Time
  genresByMonth: {
    month: string; // e.g. "2024-01"
    genres: { name: string; count: number }[];
  }[];

  // Library Utilization
  libraryUtilization: {
    totalMovies: number;
    totalShows: number;
    totalEpisodes: number;
    watchedMovies: number;
    watchedShows: number;
    watchedEpisodes: number;
    overallPercentage: number;
  } | null;
}

export interface UserWrappedResponse {
  year: number;
  plays: number;
  hours: number;
  daysActive: number;
  moviePlays: number;
  episodePlays: number;
  uniqueMovies: number;
  uniqueShows: number;
  averageSessionMinutes: number;
  topShow: {
    title: string;
    episodes: number;
    hours: number;
    share: number;
    ratingKey: string | null;
  } | null;
  topMovie: { title: string; plays: number; ratingKey: string | null } | null;
  genres: { name: string; share: number }[];
  actors: string[];
  directors: string[];
  favoriteDecade: string | null;
  longestBinge: { date: string; show: string; episodes: number } | null;
  busiestDay: { date: string; minutes: number } | null;
  longestStreak: { days: number; start: string } | null;
  peakHour: number;
  peakHourPlays: number[];
  peakWeekday: string | null;
  topPlatform: { name: string; share: number } | null;
  firstPlay: { title: string; date: string } | null;
  personality: { key: string; name: string; line: string };
}

export interface UserWrappedLockedResponse {
  locked: true;
  year: number;
  unlocksAt: string;
}
