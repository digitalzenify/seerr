import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { UserList } from '@server/entity/UserList';
import { UserListItem } from '@server/entity/UserListItem';
import TheMovieDb from '@server/api/themoviedb';
import logger from '@server/logger';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import type { Request } from 'express';
import { Router } from 'express';

const router = Router({ mergeParams: true });

// Helper to get userId from parent route params (:id from /user/:id/lists)
const getUserId = (req: Request): number =>
  Number((req.params as Record<string, string>).id);

/**
 * GET /user/:id/lists
 * Returns all custom lists for the user.
 */
router.get('/', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const listRepo = getRepository(UserList);
    const lists = await listRepo.find({
      where: { owner: { id: getUserId(req) } },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
      relations: { items: true },
    });

    // Return lists with item counts and cover art from first item
    const result = lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      sortOrder: list.sortOrder,
      isDefault: list.isDefault,
      itemCount: list.items?.length ?? 0,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));

    return res.status(200).json({ results: result });
  } catch (e) {
    logger.error('Failed to fetch user lists', {
      label: 'UserLists',
      message: (e as Error).message,
    });
    next({ status: 500, message: 'Failed to fetch lists.' });
  }
});

/**
 * POST /user/:id/lists
 * Create a new custom list.
 */
router.post('/', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return next({ status: 400, message: 'List name is required.' });
    }

    const userRepo = getRepository(User);
    const user = await userRepo.findOneByOrFail({
      id: getUserId(req),
    });

    const listRepo = getRepository(UserList);

    // Get the highest current sort order
    const maxSortOrder = await listRepo
      .createQueryBuilder('list')
      .select('MAX(list.sortOrder)', 'maxSort')
      .where('list.ownerId = :userId', { userId: user.id })
      .getRawOne();

    const newList = new UserList({
      name: name.trim(),
      description: description?.trim() ?? '',
      sortOrder: (maxSortOrder?.maxSort ?? -1) + 1,
      isDefault: false,
      owner: user,
    });

    const saved = await listRepo.save(newList);

    return res.status(201).json({
      id: saved.id,
      name: saved.name,
      description: saved.description,
      sortOrder: saved.sortOrder,
      isDefault: saved.isDefault,
      itemCount: 0,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    });
  } catch (e) {
    logger.error('Failed to create user list', {
      label: 'UserLists',
      message: (e as Error).message,
    });
    next({ status: 500, message: 'Failed to create list.' });
  }
});

/**
 * GET /user/:id/lists/:listId
 * Returns a specific list with all its items.
 */
router.get('/:listId', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const listRepo = getRepository(UserList);
    const list = await listRepo.findOne({
      where: {
        id: Number(req.params.listId),
        owner: { id: getUserId(req) },
      },
      relations: { items: { media: true } },
    });

    if (!list) {
      return next({ status: 404, message: 'List not found.' });
    }

    // Sort items by sortOrder
    const sortedItems = (list.items ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    return res.status(200).json({
      id: list.id,
      name: list.name,
      description: list.description,
      sortOrder: list.sortOrder,
      isDefault: list.isDefault,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      items: sortedItems.map((item) => ({
        id: item.id,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        media: item.media,
      })),
    });
  } catch (e) {
    logger.error('Failed to fetch user list', {
      label: 'UserLists',
      message: (e as Error).message,
    });
    next({ status: 500, message: 'Failed to fetch list.' });
  }
});

/**
 * PUT /user/:id/lists/:listId
 * Update a list (rename, change description, reorder).
 */
router.put('/:listId', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const listRepo = getRepository(UserList);
    const list = await listRepo.findOne({
      where: {
        id: Number(req.params.listId),
        owner: { id: getUserId(req) },
      },
    });

    if (!list) {
      return next({ status: 404, message: 'List not found.' });
    }

    const { name, description, sortOrder } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return next({ status: 400, message: 'List name cannot be empty.' });
      }
      list.name = name.trim();
    }

    if (description !== undefined) {
      list.description = typeof description === 'string' ? description.trim() : '';
    }

    if (sortOrder !== undefined && typeof sortOrder === 'number') {
      list.sortOrder = sortOrder;
    }

    const saved = await listRepo.save(list);

    return res.status(200).json({
      id: saved.id,
      name: saved.name,
      description: saved.description,
      sortOrder: saved.sortOrder,
      isDefault: saved.isDefault,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    });
  } catch (e) {
    logger.error('Failed to update user list', {
      label: 'UserLists',
      message: (e as Error).message,
    });
    next({ status: 500, message: 'Failed to update list.' });
  }
});

/**
 * DELETE /user/:id/lists/:listId
 * Delete a list and all its items.
 */
router.delete('/:listId', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const listRepo = getRepository(UserList);
    const list = await listRepo.findOne({
      where: {
        id: Number(req.params.listId),
        owner: { id: getUserId(req) },
      },
    });

    if (!list) {
      return next({ status: 404, message: 'List not found.' });
    }

    if (list.isDefault) {
      return next({
        status: 400,
        message: 'Cannot delete the default watchlist.',
      });
    }

    await listRepo.remove(list);
    return res.status(204).send();
  } catch (e) {
    logger.error('Failed to delete user list', {
      label: 'UserLists',
      message: (e as Error).message,
    });
    next({ status: 500, message: 'Failed to delete list.' });
  }
});

/**
 * POST /user/:id/lists/:listId/items
 * Add an item to a list.
 */
router.post(
  '/:listId/items',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const { tmdbId, mediaType, title } = req.body;

      if (!tmdbId || !mediaType) {
        return next({
          status: 400,
          message: 'tmdbId and mediaType are required.',
        });
      }

      if (mediaType !== MediaType.MOVIE && mediaType !== MediaType.TV) {
        return next({ status: 400, message: 'Invalid mediaType.' });
      }

      const listRepo = getRepository(UserList);
      const list = await listRepo.findOne({
        where: {
          id: Number(req.params.listId),
          owner: { id: getUserId(req) },
        },
        relations: { items: true },
      });

      if (!list) {
        return next({ status: 404, message: 'List not found.' });
      }

      // Check for duplicates
      const itemRepo = getRepository(UserListItem);
      const existing = await itemRepo.findOne({
        where: {
          tmdbId: Number(tmdbId),
          mediaType,
          list: { id: list.id },
        },
      });

      if (existing) {
        return next({
          status: 409,
          message: 'Item already exists in this list.',
        });
      }

      // Look up existing Media entry (may be null if not yet in database)
      const mediaRepo = getRepository(Media);
      const media = await mediaRepo.findOne({
        where: { tmdbId: Number(tmdbId), mediaType },
      });

      // Get highest sort order in this list
      const maxSortOrder = await itemRepo
        .createQueryBuilder('item')
        .select('MAX(item.sortOrder)', 'maxSort')
        .where('item.listId = :listId', { listId: list.id })
        .getRawOne();

      const newItem = new UserListItem({
        tmdbId: Number(tmdbId),
        mediaType,
        title: title ?? '',
        sortOrder: (maxSortOrder?.maxSort ?? -1) + 1,
        list,
        media: media ?? undefined,
      });

      const saved = await itemRepo.save(newItem);

      return res.status(201).json({
        id: saved.id,
        tmdbId: saved.tmdbId,
        mediaType: saved.mediaType,
        title: saved.title,
        sortOrder: saved.sortOrder,
        createdAt: saved.createdAt,
        media: saved.media,
      });
    } catch (e) {
      logger.error('Failed to add item to list', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to add item.' });
    }
  }
);

/**
 * DELETE /user/:id/lists/:listId/items/:itemId
 * Remove an item from a list.
 */
router.delete(
  '/:listId/items/:itemId',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const itemRepo = getRepository(UserListItem);
      const item = await itemRepo.findOne({
        where: {
          id: Number(req.params.itemId),
          list: {
            id: Number(req.params.listId),
            owner: { id: getUserId(req) },
          },
        },
      });

      if (!item) {
        return next({ status: 404, message: 'Item not found.' });
      }

      await itemRepo.remove(item);
      return res.status(204).send();
    } catch (e) {
      logger.error('Failed to remove item from list', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to remove item.' });
    }
  }
);

/**
 * PUT /user/:id/lists/:listId/items/reorder
 * Reorder items in a list.
 */
router.put(
  '/:listId/items/reorder',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const { itemIds } = req.body;

      if (!Array.isArray(itemIds)) {
        return next({
          status: 400,
          message: 'itemIds array is required.',
        });
      }

      const listRepo = getRepository(UserList);
      const list = await listRepo.findOne({
        where: {
          id: Number(req.params.listId),
          owner: { id: getUserId(req) },
        },
      });

      if (!list) {
        return next({ status: 404, message: 'List not found.' });
      }

      const itemRepo = getRepository(UserListItem);
      for (let i = 0; i < itemIds.length; i++) {
        await itemRepo.update(
          { id: Number(itemIds[i]), list: { id: list.id } },
          { sortOrder: i }
        );
      }

      return res.status(200).json({ success: true });
    } catch (e) {
      logger.error('Failed to reorder list items', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to reorder items.' });
    }
  }
);

/**
 * GET /user/:id/lists/calendar
 * Returns calendar events for items in the user's lists with future release dates.
 * Optional query params: listIds (comma-separated list IDs to filter by)
 */
router.get(
  '/calendar/events',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const { listIds } = req.query;

      const itemRepo = getRepository(UserListItem);
      let query = itemRepo
        .createQueryBuilder('item')
        .innerJoinAndSelect('item.list', 'list')
        .leftJoinAndSelect('item.media', 'media')
        .where('list.ownerId = :userId', { userId });

      if (listIds && typeof listIds === 'string') {
        const ids = listIds
          .split(',')
          .map((id) => Number(id.trim()))
          .filter((id) => !isNaN(id));
        if (ids.length > 0) {
          query = query.andWhere('list.id IN (:...ids)', { ids });
        }
      }

      const allItems = await query.getMany();

      // Fetch TMDB details for each item to get release dates
      const tmdb = new TheMovieDb();
      const events: Array<{
        id: number;
        tmdbId: number;
        mediaType: string;
        title: string;
        date: string;
        posterPath: string | null;
        listId: number;
        listName: string;
        overview: string;
      }> = [];

      const seen = new Set<string>();

      for (const item of allItems) {
        const key = `${item.tmdbId}-${item.mediaType}`;
        if (seen.has(key)) {
          // If same item in multiple lists, add event for each list
          const existing = events.find(
            (e) => e.tmdbId === item.tmdbId && e.mediaType === item.mediaType
          );
          if (existing) {
            events.push({
              ...existing,
              id: item.id,
              listId: item.list.id,
              listName: item.list.name,
            });
          }
          continue;
        }
        seen.add(key);

        try {
          if (item.mediaType === MediaType.MOVIE) {
            const movie = await tmdb.getMovie({ movieId: item.tmdbId });
            if (movie.release_date) {
              const releaseDate = new Date(movie.release_date);
              if (releaseDate.getTime() > Date.now() - 86400000) {
                events.push({
                  id: item.id,
                  tmdbId: item.tmdbId,
                  mediaType: item.mediaType,
                  title: movie.title || item.title,
                  date: movie.release_date,
                  posterPath: movie.poster_path ?? null,
                  listId: item.list.id,
                  listName: item.list.name,
                  overview: movie.overview ?? '',
                });
              }
            }
          } else if (item.mediaType === MediaType.TV) {
            const tvShow = await tmdb.getTvShow({ tvId: item.tmdbId });
            // Add next episode air date if available
            if (tvShow.next_episode_to_air?.air_date) {
              events.push({
                id: item.id,
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: `${tvShow.name || item.title} - S${String(tvShow.next_episode_to_air.season_number).padStart(2, '0')}E${String(tvShow.next_episode_to_air.episode_number).padStart(2, '0')}`,
                date: tvShow.next_episode_to_air.air_date,
                posterPath: tvShow.poster_path ?? null,
                listId: item.list.id,
                listName: item.list.name,
                overview:
                  tvShow.next_episode_to_air.overview ||
                  tvShow.overview ||
                  '',
              });
            }
            // Also add first_air_date for unreleased shows
            if (
              tvShow.first_air_date &&
              !tvShow.next_episode_to_air &&
              new Date(tvShow.first_air_date).getTime() > Date.now() - 86400000
            ) {
              events.push({
                id: item.id,
                tmdbId: item.tmdbId,
                mediaType: item.mediaType,
                title: tvShow.name || item.title,
                date: tvShow.first_air_date,
                posterPath: tvShow.poster_path ?? null,
                listId: item.list.id,
                listName: item.list.name,
                overview: tvShow.overview || '',
              });
            }
          }
        } catch (e) {
          logger.warn(`Failed to fetch TMDB data for ${item.mediaType} ${item.tmdbId}`, {
            label: 'UserLists/Calendar',
            message: (e as Error).message,
          });
        }
      }

      // Sort by date
      events.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      return res.status(200).json({ results: events });
    } catch (e) {
      logger.error('Failed to fetch calendar events', {
        label: 'UserLists/Calendar',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to fetch calendar events.' });
    }
  }
);

/**
 * GET /user/:id/lists/random
 * Pick a random item from the user's lists.
 * Optional query params: genre, mediaType, maxRuntime, listId
 */
router.get(
  '/random/pick',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const { genre, mediaType, listId, inLibraryOnly } = req.query;

      const itemRepo = getRepository(UserListItem);
      let query = itemRepo
        .createQueryBuilder('item')
        .innerJoin('item.list', 'list')
        .leftJoinAndSelect('item.media', 'media')
        .where('list.ownerId = :userId', { userId });

      if (listId) {
        query = query.andWhere('list.id = :listId', {
          listId: Number(listId),
        });
      }

      if (
        mediaType &&
        (mediaType === MediaType.MOVIE || mediaType === MediaType.TV)
      ) {
        query = query.andWhere('item.mediaType = :mediaType', { mediaType });
      }

      if (inLibraryOnly === 'true') {
        query = query.andWhere('media.status IN (:...statuses)', {
          statuses: [MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE],
        });
      }

      const allItems = await query.getMany();

      if (allItems.length === 0) {
        return next({
          status: 404,
          message: 'No items found matching your criteria.',
        });
      }

      // Pick a random item
      const randomIndex = Math.floor(Math.random() * allItems.length);
      const picked = allItems[randomIndex];

      return res.status(200).json({
        id: picked.id,
        tmdbId: picked.tmdbId,
        mediaType: picked.mediaType,
        title: picked.title,
        media: picked.media,
      });
    } catch (e) {
      logger.error('Failed to pick random item', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to pick random item.' });
    }
  }
);

export default router;
