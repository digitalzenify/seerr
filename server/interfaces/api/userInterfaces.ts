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
  topGenres: Array<{ name: string; count: number }>;
  favoriteDecade: string | null;
  topActors: Array<{ name: string; count: number }>;
  topDirectors: Array<{ name: string; count: number }>;
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
}
