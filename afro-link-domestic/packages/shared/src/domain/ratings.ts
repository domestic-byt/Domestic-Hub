import { Rating } from './types';

export function validateRatingStars(stars: number): string[] {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return ['stars must be an integer from 1 to 5.'];
  }
  return [];
}

export function averageRating(
  ratings: Rating[],
): { average: number; count: number } | undefined {
  if (ratings.length === 0) return undefined;
  const avg = ratings.reduce((sum, r) => sum + r.stars, 0) / ratings.length;
  return { average: Math.round(avg * 10) / 10, count: ratings.length };
}
