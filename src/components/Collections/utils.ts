/**
 * Get a display title for a list item, falling back to a type+id string
 * when no title is stored.
 */
export const getItemDisplayTitle = (item: {
  title?: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
}): string => {
  if (item.title) return item.title;
  const typeLabel = item.mediaType === 'movie' ? 'Movie' : 'TV Show';
  return `${typeLabel} #${item.tmdbId}`;
};
