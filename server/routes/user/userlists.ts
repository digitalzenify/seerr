import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { UserList } from '@server/entity/UserList';
import { UserListItem } from '@server/entity/UserListItem';
import { UserListItemVote } from '@server/entity/UserListItemVote';
import { UserListMember } from '@server/entity/UserListMember';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import type { Request } from 'express';
import { Router } from 'express';

const router = Router({ mergeParams: true });

/** One day in milliseconds, used to include items releasing today */
const ONE_DAY_MS = 86400000;

// Helper to get userId from parent route params (:id from /user/:id/lists)
const getUserId = (req: Request): number =>
  Number((req.params as Record<string, string>).id);

const isAdmin = (req: Request): boolean =>
  !!req.user?.hasPermission(Permission.MANAGE_USERS);

/** Full access: rename, delete, invite people. */
const canEditList = (req: Request, list: UserList): boolean =>
  isAdmin(req) || list.owner?.id === req.user?.id;

/** Read/add access: owner, invited member, or admin. */
const canAccessList = (req: Request, list: UserList): boolean =>
  canEditList(req, list) ||
  (list.members ?? []).some((member) => member.user?.id === req.user?.id);

const displayNameOf = (user?: User | null): string => user?.displayName ?? '';

/**
 * Resolve a list by its id and make sure the caller may read it. The `:id`
 * in the URL is the profile being viewed, not necessarily the list owner -
 * a shared list is opened from both sides.
 */
const resolveList = async (req: Request, listId: number) => {
  const list = await getRepository(UserList).findOne({
    where: { id: listId },
    relations: { members: true, owner: true },
  });

  if (!list) {
    return { error: { status: 404, message: 'List not found.' } } as const;
  }

  if (!canAccessList(req, list)) {
    return {
      error: { status: 403, message: 'You do not have access to this list.' },
    } as const;
  }

  return { list } as const;
};

const mapListSummary = (list: UserList, viewerId: number) => ({
  id: list.id,
  name: list.name,
  description: list.description,
  sortOrder: list.sortOrder,
  isDefault: list.isDefault,
  itemCount: list.items?.length ?? 0,
  createdAt: list.createdAt,
  updatedAt: list.updatedAt,
  ownerId: list.owner?.id ?? viewerId,
  ownerName: displayNameOf(list.owner),
  isShared: (list.members?.length ?? 0) > 0,
  members: (list.members ?? []).map((member) => ({
    id: member.user?.id,
    displayName: displayNameOf(member.user),
  })),
});

/**
 * GET /user/:id/lists
 * Returns the user's own lists plus every list shared with them.
 */
router.get('/', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const listRepo = getRepository(UserList);
    const owned = await listRepo.find({
      where: { owner: { id: userId } },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
      relations: { items: true, members: true },
    });

    const memberships = await getRepository(UserListMember).find({
      where: { user: { id: userId } },
      relations: { list: { items: true, members: true } },
    });

    const seen = new Set(owned.map((list) => list.id));
    const shared = memberships
      .map((membership) => membership.list)
      .filter((list) => list && !seen.has(list.id));

    return res.status(200).json({
      results: [...owned, ...shared].map((list) =>
        mapListSummary(list, userId)
      ),
    });
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

    return res.status(201).json(mapListSummary(saved, user.id));
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
 * Returns a specific list with all its items, who added them and the votes.
 */
router.get('/:listId', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const resolved = await resolveList(req, Number(req.params.listId));

    if ('error' in resolved) {
      return next(resolved.error);
    }

    const list = await getRepository(UserList).findOne({
      where: { id: resolved.list.id },
      relations: {
        items: { media: true, votes: true, addedBy: true },
        members: true,
        owner: true,
      },
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
      owner: {
        id: list.owner?.id,
        displayName: displayNameOf(list.owner),
      },
      members: (list.members ?? []).map((member) => ({
        id: member.user?.id,
        displayName: displayNameOf(member.user),
      })),
      items: sortedItems.map((item) => ({
        id: item.id,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        sortOrder: item.sortOrder,
        createdAt: item.createdAt,
        media: item.media,
        addedBy: item.addedBy
          ? {
              id: item.addedBy.id,
              displayName: displayNameOf(item.addedBy),
            }
          : null,
        votes: (item.votes ?? []).map((vote) => ({
          userId: vote.user?.id,
          displayName: displayNameOf(vote.user),
          value: vote.value,
        })),
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
    const resolved = await resolveList(req, Number(req.params.listId));

    if ('error' in resolved) {
      return next(resolved.error);
    }

    if (!canEditList(req, resolved.list)) {
      return next({
        status: 403,
        message: 'Only the list owner can change list settings.',
      });
    }

    const list = resolved.list;
    const { name, description, sortOrder } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return next({ status: 400, message: 'List name cannot be empty.' });
      }
      list.name = name.trim();
    }

    if (description !== undefined) {
      list.description =
        typeof description === 'string' ? description.trim() : '';
    }

    if (sortOrder !== undefined && typeof sortOrder === 'number') {
      list.sortOrder = sortOrder;
    }

    const saved = await getRepository(UserList).save(list);

    return res.status(200).json(mapListSummary(saved, getUserId(req)));
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
    const resolved = await resolveList(req, Number(req.params.listId));

    if ('error' in resolved) {
      return next(resolved.error);
    }

    if (!canEditList(req, resolved.list)) {
      return next({
        status: 403,
        message: 'Only the list owner can delete this list.',
      });
    }

    if (resolved.list.isDefault) {
      return next({
        status: 400,
        message: 'Cannot delete the default watchlist.',
      });
    }

    await getRepository(UserList).remove(resolved.list);
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
 * POST /user/:id/lists/:listId/members
 * Share the list with another user (owner only).
 */
router.post(
  '/:listId/members',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const resolved = await resolveList(req, Number(req.params.listId));

      if ('error' in resolved) {
        return next(resolved.error);
      }

      if (!canEditList(req, resolved.list)) {
        return next({
          status: 403,
          message: 'Only the list owner can share this list.',
        });
      }

      const { userId, username } = req.body ?? {};
      const userRepo = getRepository(User);

      const target =
        userId !== undefined
          ? await userRepo.findOne({ where: { id: Number(userId) } })
          : await userRepo
              .createQueryBuilder('user')
              .where('LOWER(user.username) = LOWER(:username)', { username })
              .orWhere('LOWER(user.email) = LOWER(:username)', { username })
              .orWhere('LOWER(user.plexUsername) = LOWER(:username)', {
                username,
              })
              .getOne();

      if (!target) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (target.id === resolved.list.owner?.id) {
        return next({
          status: 400,
          message: 'The owner already has access to this list.',
        });
      }

      const memberRepo = getRepository(UserListMember);
      const existing = await memberRepo.findOne({
        where: { list: { id: resolved.list.id }, user: { id: target.id } },
      });

      if (existing) {
        return next({
          status: 409,
          message: 'That user is already on this list.',
        });
      }

      await memberRepo.save(
        new UserListMember({ list: resolved.list, user: target })
      );

      return res.status(201).json({
        id: target.id,
        displayName: displayNameOf(target),
      });
    } catch (e) {
      logger.error('Failed to share user list', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to share list.' });
    }
  }
);

/**
 * DELETE /user/:id/lists/:listId/members/:memberId
 * Owner removes someone; a member may remove themselves (leave the list).
 */
router.delete(
  '/:listId/members/:memberId',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const resolved = await resolveList(req, Number(req.params.listId));

      if ('error' in resolved) {
        return next(resolved.error);
      }

      const memberId = Number(req.params.memberId);

      if (!canEditList(req, resolved.list) && req.user?.id !== memberId) {
        return next({
          status: 403,
          message: 'You cannot remove that user from this list.',
        });
      }

      const memberRepo = getRepository(UserListMember);
      const member = await memberRepo.findOne({
        where: {
          list: { id: resolved.list.id },
          user: { id: memberId },
        },
      });

      if (!member) {
        return next({ status: 404, message: 'Member not found.' });
      }

      await memberRepo.remove(member);
      return res.status(204).send();
    } catch (e) {
      logger.error('Failed to remove list member', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to remove member.' });
    }
  }
);

/**
 * POST /user/:id/lists/:listId/items
 * Add an item to a list. The caller is recorded as the one who added it.
 */
router.post('/:listId/items', isOwnProfileOrAdmin(), async (req, res, next) => {
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

    const resolved = await resolveList(req, Number(req.params.listId));

    if ('error' in resolved) {
      return next(resolved.error);
    }

    const list = resolved.list;
    const itemRepo = getRepository(UserListItem);

    // Check for duplicates
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
      addedBy: req.user,
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
      addedBy: saved.addedBy
        ? {
            id: saved.addedBy.id,
            displayName: displayNameOf(saved.addedBy),
          }
        : null,
      votes: [],
    });
  } catch (e) {
    logger.error('Failed to add item to list', {
      label: 'UserLists',
      message: (e as Error).message,
    });
    next({ status: 500, message: 'Failed to add item.' });
  }
});

/**
 * DELETE /user/:id/lists/:listId/items/:itemId
 * Whoever added an item can remove it; the list owner can remove anything.
 */
router.delete(
  '/:listId/items/:itemId',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const resolved = await resolveList(req, Number(req.params.listId));

      if ('error' in resolved) {
        return next(resolved.error);
      }

      const itemRepo = getRepository(UserListItem);
      const item = await itemRepo.findOne({
        where: {
          id: Number(req.params.itemId),
          list: { id: resolved.list.id },
        },
        relations: { addedBy: true },
      });

      if (!item) {
        return next({ status: 404, message: 'Item not found.' });
      }

      if (
        !canEditList(req, resolved.list) &&
        item.addedBy?.id !== req.user?.id
      ) {
        return next({
          status: 403,
          message: 'You can only remove titles you added yourself.',
        });
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
 * PUT /user/:id/lists/:listId/items/:itemId/vote
 * Body: { value: 'want' | 'pass' | null }. You cannot vote on your own pick.
 */
router.put(
  '/:listId/items/:itemId/vote',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const resolved = await resolveList(req, Number(req.params.listId));

      if ('error' in resolved) {
        return next(resolved.error);
      }

      const { value } = req.body ?? {};

      if (value !== null && value !== 'want' && value !== 'pass') {
        return next({
          status: 400,
          message: "value must be 'want', 'pass' or null.",
        });
      }

      const itemRepo = getRepository(UserListItem);
      const item = await itemRepo.findOne({
        where: {
          id: Number(req.params.itemId),
          list: { id: resolved.list.id },
        },
        relations: { addedBy: true },
      });

      if (!item) {
        return next({ status: 404, message: 'Item not found.' });
      }

      if (item.addedBy?.id === req.user?.id) {
        return next({
          status: 400,
          message: 'You cannot vote on a title you added yourself.',
        });
      }

      const voteRepo = getRepository(UserListItemVote);
      const existing = await voteRepo.findOne({
        where: {
          item: { id: item.id },
          user: { id: req.user?.id },
        },
      });

      if (value === null) {
        if (existing) {
          await voteRepo.remove(existing);
        }
        return res.status(200).json({ userId: req.user?.id, value: null });
      }

      if (existing) {
        existing.value = value;
        await voteRepo.save(existing);
      } else {
        await voteRepo.save(
          new UserListItemVote({ item, user: req.user, value })
        );
      }

      return res
        .status(200)
        .json({ itemId: item.id, userId: req.user?.id, value });
    } catch (e) {
      logger.error('Failed to save list item vote', {
        label: 'UserLists',
        message: (e as Error).message,
      });
      next({ status: 500, message: 'Failed to save vote.' });
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
      const resolved = await resolveList(req, Number(req.params.listId));

      if ('error' in resolved) {
        return next(resolved.error);
      }

      const { itemIds } = req.body;

      if (!Array.isArray(itemIds)) {
        return next({
          status: 400,
          message: 'itemIds array is required.',
        });
      }

      const itemRepo = getRepository(UserListItem);
      for (let i = 0; i < itemIds.length; i++) {
        await itemRepo.update(
          { id: Number(itemIds[i]), list: { id: resolved.list.id } },
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
        .leftJoin('list.members', 'member')
        .leftJoinAndSelect('item.media', 'media')
        .where('(list.ownerId = :userId OR member.userId = :userId)', {
          userId,
        });

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
      const events: {
        id: number;
        tmdbId: number;
        mediaType: string;
        title: string;
        date: string;
        posterPath: string | null;
        listId: number;
        listName: string;
        overview: string;
      }[] = [];

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
              if (releaseDate.getTime() > Date.now() - ONE_DAY_MS) {
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
                  tvShow.next_episode_to_air.overview || tvShow.overview || '',
              });
            }
            // Also add first_air_date for unreleased shows
            if (
              tvShow.first_air_date &&
              !tvShow.next_episode_to_air &&
              new Date(tvShow.first_air_date).getTime() >
                Date.now() - ONE_DAY_MS
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
          logger.warn(
            `Failed to fetch TMDB data for ${item.mediaType} ${item.tmdbId}`,
            {
              label: 'UserLists/Calendar',
              message: (e as Error).message,
            }
          );
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
 * Pick a random item from the user's lists (own and shared).
 * Optional query params: genre, mediaType, maxRuntime, listId
 */
router.get('/random/pick', isOwnProfileOrAdmin(), async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { mediaType, listId, inLibraryOnly } = req.query;

    const itemRepo = getRepository(UserListItem);
    let query = itemRepo
      .createQueryBuilder('item')
      .innerJoin('item.list', 'list')
      .leftJoin('list.members', 'member')
      .leftJoinAndSelect('item.media', 'media')
      .where('(list.ownerId = :userId OR member.userId = :userId)', {
        userId,
      });

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
});

export default router;
