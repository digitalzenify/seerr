import { MediaStatus } from '@server/constants/media';

export type RecommendationMediaType = 'movie' | 'tv';

/** A title the user has actually watched, used as a seed for candidates. */
export interface RecommendationSeed {
  ratingKey: string;
  tmdbId: number;
  mediaType: RecommendationMediaType;
  title: string;
  plays: number;
  lastWatched: number;
}

/** A candidate before it is hydrated into a full card. */
export interface RecommendationCandidate {
  tmdbId: number;
  mediaType: RecommendationMediaType;
  title: string;
  year?: number;
  releaseDate?: string;
  reason: string;
  seedPlays: number;
  topSeed: boolean;
  fromTrakt: boolean;
  fromTmdb: boolean;
  fromAirDate: boolean;
  score: number;
}

export interface CandidateInput {
  tmdbId: number;
  mediaType: RecommendationMediaType;
  title: string;
  year?: number;
  releaseDate?: string;
  reason: string;
  seedPlays: number;
  topSeed: boolean;
}

export interface CandidateFlags {
  trakt?: boolean;
  tmdb?: boolean;
  airDate?: boolean;
}

// How long a title counts as "new". Movies get roughly half a year of digital
// releases, TV a full year because seasons arrive slower.
export const MOVIE_NEWNESS_DAYS = 180;
export const TV_NEWNESS_DAYS = 365;

export const candidateKey = (
  mediaType: RecommendationMediaType,
  tmdbId: number
) => `${mediaType}:${tmdbId}`;

/**
 * Merge one source hit into the candidate map. The same title arrives from
 * Trakt, TMDB and the air-date check, and agreement between them is the
 * strongest signal we have - so flags accumulate rather than overwrite.
 */
export const addCandidate = (
  map: Map<string, RecommendationCandidate>,
  input: CandidateInput,
  flags: CandidateFlags
): void => {
  const key = candidateKey(input.mediaType, input.tmdbId);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, {
      ...input,
      fromTrakt: !!flags.trakt,
      fromTmdb: !!flags.tmdb,
      fromAirDate: !!flags.airDate,
      score: 0,
    });
    return;
  }

  existing.fromTrakt = existing.fromTrakt || !!flags.trakt;
  existing.fromTmdb = existing.fromTmdb || !!flags.tmdb;
  existing.fromAirDate = existing.fromAirDate || !!flags.airDate;

  if (input.seedPlays > existing.seedPlays) {
    existing.seedPlays = input.seedPlays;
    existing.reason = input.reason;
  }

  existing.topSeed = existing.topSeed || input.topSeed;
  existing.releaseDate = existing.releaseDate ?? input.releaseDate;
  existing.year = existing.year ?? input.year;
};

/**
 * Trakt is weighted above TMDB because its hand-curated relations matched the
 * household taste far better in testing; an agreed hit beats a single source.
 */
export const scoreCandidate = (candidate: RecommendationCandidate): number => {
  let score = 0;

  if (candidate.fromTrakt) score += 2;
  if (candidate.fromAirDate) score += 2;
  if (candidate.fromTmdb) score += 1;
  if (candidate.fromTrakt && candidate.fromTmdb) score += 1;
  if (candidate.topSeed) score += 1;

  return score;
};

const releaseTime = (candidate: RecommendationCandidate) =>
  candidate.releaseDate ? Date.parse(candidate.releaseDate) || 0 : 0;

export const rankCandidates = (
  candidates: RecommendationCandidate[]
): RecommendationCandidate[] =>
  candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate),
    }))
    .sort((a, b) => b.score - a.score || releaseTime(b) - releaseTime(a));

/**
 * True when a title is recent enough to belong in a "new" row. Items found by
 * the air-date check already passed a stronger test (they aired after the user
 * last watched), so they skip the window.
 */
export const passesNewness = (
  candidate: Pick<
    RecommendationCandidate,
    'releaseDate' | 'year' | 'mediaType'
  > & { fromAirDate?: boolean },
  now: number,
  windows: { movieDays?: number; tvDays?: number } = {}
): boolean => {
  if (candidate.fromAirDate) {
    return true;
  }

  const days =
    candidate.mediaType === 'movie'
      ? (windows.movieDays ?? MOVIE_NEWNESS_DAYS)
      : (windows.tvDays ?? TV_NEWNESS_DAYS);

  if (candidate.releaseDate) {
    const released = Date.parse(candidate.releaseDate);
    if (!Number.isNaN(released)) {
      return now - released <= days * 86400000;
    }
  }

  // Trakt only hands back a year for most relations, so use it as a coarse
  // gate and let the TMDB hydration decide precisely.
  if (candidate.year) {
    return candidate.year >= new Date(now).getFullYear() - 1;
  }

  return false;
};

/** Two items per seed keeps a single binge from taking over the row. */
export const capPerSeed = (
  candidates: RecommendationCandidate[],
  limit: number
): RecommendationCandidate[] => {
  const used = new Map<string, number>();
  const kept: RecommendationCandidate[] = [];

  for (const candidate of candidates) {
    const count = used.get(candidate.reason) ?? 0;
    if (count >= limit) {
      continue;
    }
    used.set(candidate.reason, count + 1);
    kept.push(candidate);
  }

  return kept;
};

/**
 * A row is a wish list: skip anything already here, already downloading, or
 * already on its way. Partially available shows stay, so a returning season can
 * surface for a show the household already follows.
 */
export const isWorthRecommending = (status?: MediaStatus): boolean => {
  if (status === undefined) {
    return true;
  }

  return ![
    MediaStatus.PENDING,
    MediaStatus.PROCESSING,
    MediaStatus.AVAILABLE,
    MediaStatus.BLOCKLISTED,
  ].includes(status);
};
