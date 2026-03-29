import { type IMDBRating } from '@server/api/rating/imdbapi';
import { type RTRating } from '@server/api/rating/rottentomatoes';

export interface RatingResponse {
  rt?: RTRating;
  imdb?: IMDBRating;
}
