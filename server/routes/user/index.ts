import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import TautulliAPI from '@server/api/tautulli';
import cacheManager from '@server/lib/cache';
import { MediaStatus, MediaType } from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import { Watchlist } from '@server/entity/Watchlist';
import type { WatchlistResponse } from '@server/interfaces/api/discoverInterfaces';
import type {
  QuotaResponse,
  UserRequestsResponse,
  UserResultsResponse,
  UserStatisticsResponse,
  UserWatchDataResponse,
} from '@server/interfaces/api/userInterfaces';
import { Permission, hasPermission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import axios from 'axios';
import { Router } from 'express';
import gravatarUrl from 'gravatar-url';
import { findIndex, sortBy } from 'lodash';
import type { EntityManager } from 'typeorm';
import { In, Not } from 'typeorm';
import userListRoutes from './userlists';
import userSettingsRoutes from './usersettings';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const includeIds = [
      ...new Set(
        req.query.includeIds ? req.query.includeIds.toString().split(',') : []
      ),
    ];
    const pageSize = req.query.take
      ? Number(req.query.take)
      : Math.max(10, includeIds.length);
    const skip = req.query.skip ? Number(req.query.skip) : 0;
    const q = req.query.q ? req.query.q.toString().toLowerCase() : '';
    const sortParam = req.query.sort ? req.query.sort.toString() : undefined;
    const sortDirectionQuery = req.query.sortDirection
      ? req.query.sortDirection.toString().toLowerCase()
      : undefined;

    let sortDirection: 'ASC' | 'DESC';
    if (sortDirectionQuery === 'asc') {
      sortDirection = 'ASC';
    } else if (sortDirectionQuery === 'desc') {
      sortDirection = 'DESC';
    } else {
      switch (sortParam) {
        case 'displayname':
          sortDirection = 'ASC';
          break;
        case 'requests':
        case 'updated':
          sortDirection = 'DESC';
          break;
        case 'created':
        case 'usertype':
        case 'role':
        case undefined:
        default:
          sortDirection = 'ASC';
          break;
      }
    }

    let query = getRepository(User).createQueryBuilder('user');

    if (q) {
      query = query.where(
        'LOWER(user.username) LIKE :q OR LOWER(user.email) LIKE :q OR LOWER(user.plexUsername) LIKE :q OR LOWER(user.jellyfinUsername) LIKE :q',
        { q: `%${q}%` }
      );
    }

    if (includeIds.length > 0) {
      query.andWhereInIds(includeIds);
    }

    switch (sortParam) {
      case 'created':
        query = query.orderBy('user.createdAt', sortDirection);
        break;
      case 'updated':
        query = query.orderBy('user.updatedAt', sortDirection);
        break;
      case 'displayname':
        query = query
          .addSelect(
            `CASE WHEN (user.username IS NULL OR user.username = '') THEN (
                CASE WHEN (user.plexUsername IS NULL OR user.plexUsername = '') THEN (
                  CASE WHEN (user.jellyfinUsername IS NULL OR user.jellyfinUsername = '') THEN
                    "user"."email"
                  ELSE
                    LOWER(user.jellyfinUsername)
                  END)
                ELSE
                  LOWER(user.plexUsername)
                END)
              ELSE
                LOWER(user.username)
              END`,
            'displayname_sort_key'
          )
          .orderBy('displayname_sort_key', sortDirection);
        break;
      case 'requests':
        query = query
          .addSelect((subQuery) => {
            return subQuery
              .select('COUNT(request.id)', 'request_count')
              .from(MediaRequest, 'request')
              .where('request.requestedBy.id = user.id');
          }, 'request_count')
          .orderBy('request_count', sortDirection);
        break;
      case 'usertype':
        query = query.orderBy('user.userType', sortDirection);
        break;
      case 'role':
        query = query
          .addSelect(
            `CASE
              WHEN user.id = 1 THEN 0
              WHEN (user.permissions & ${Permission.ADMIN}) != 0 THEN 1
              ELSE 2
            END`,
            'role_sort_key'
          )
          .orderBy('role_sort_key', sortDirection);
        break;
      default:
        query = query.orderBy('user.id', sortDirection);
        break;
    }

    const [users, userCount] = await query
      .take(pageSize)
      .skip(skip)
      .distinct(true)
      .getManyAndCount();

    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(userCount / pageSize),
        pageSize,
        results: userCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: User.filterMany(
        users,
        req.user?.hasPermission(Permission.MANAGE_USERS)
      ),
    } as UserResultsResponse);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

router.post(
  '/',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();

      const body = req.body;
      const email = body.email || body.username;
      const userRepository = getRepository(User);

      const existingUser = await userRepository
        .createQueryBuilder('user')
        .where('user.email = :email', {
          email: email.toLowerCase(),
        })
        .getOne();

      if (existingUser) {
        return next({
          status: 409,
          message: 'User already exists with submitted email.',
          errors: ['USER_EXISTS'],
        });
      }

      const passedExplicitPassword = body.password && body.password.length > 0;
      const avatar = gravatarUrl(email, { default: 'mm', size: 200 });

      if (
        !passedExplicitPassword &&
        !settings.notifications.agents.email.enabled
      ) {
        throw new Error('Email notifications must be enabled');
      }

      const user = new User({
        email,
        avatar: body.avatar ?? avatar,
        username: body.username,
        password: body.password,
        permissions: settings.main.defaultPermissions,
        plexToken: '',
        userType: UserType.LOCAL,
      });

      if (passedExplicitPassword) {
        await user?.setPassword(body.password);
      } else {
        await user?.generatePassword();
      }

      await userRepository.save(user);
      return res.status(201).json(user.filter());
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post<
  never,
  unknown,
  {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string;
  }
>('/registerPushSubscription', async (req, res, next) => {
  try {
    // This prevents race conditions where two requests both pass the checks
    await dataSource.transaction(
      async (transactionalEntityManager: EntityManager) => {
        const transactionalRepo =
          transactionalEntityManager.getRepository(UserPushSubscription);

        // Check for existing subscription by auth or endpoint within transaction
        const existingSubscription = await transactionalRepo.findOne({
          relations: { user: true },
          where: [
            { auth: req.body.auth, user: { id: req.user?.id } },
            { endpoint: req.body.endpoint, user: { id: req.user?.id } },
          ],
        });

        if (existingSubscription) {
          // If endpoint matches but auth is different, update with new keys (iOS refresh case)
          if (
            existingSubscription.endpoint === req.body.endpoint &&
            existingSubscription.auth !== req.body.auth
          ) {
            existingSubscription.auth = req.body.auth;
            existingSubscription.p256dh = req.body.p256dh;
            existingSubscription.userAgent = req.body.userAgent;

            await transactionalRepo.save(existingSubscription);

            logger.debug(
              'Updated existing push subscription with new keys for same endpoint.',
              { label: 'API' }
            );
            return;
          }

          logger.debug(
            'Duplicate subscription detected. Skipping registration.',
            { label: 'API' }
          );
          return;
        }

        // Clean up old subscriptions from the same device (userAgent) for this user
        // iOS can silently refresh endpoints, leaving stale subscriptions in the database
        // Only clean up if we're creating a new subscription (not updating an existing one)
        if (req.body.userAgent) {
          const staleSubscriptions = await transactionalRepo.find({
            relations: { user: true },
            where: {
              userAgent: req.body.userAgent,
              user: { id: req.user?.id },
              // Only remove subscriptions with different endpoints (stale ones)
              // Keep subscriptions that might be from different browsers/tabs
              endpoint: Not(req.body.endpoint),
            },
          });

          if (staleSubscriptions.length > 0) {
            await transactionalRepo.remove(staleSubscriptions);
            logger.debug(
              `Removed ${staleSubscriptions.length} stale push subscription(s) from same device.`,
              { label: 'API' }
            );
          }
        }

        const userPushSubscription = new UserPushSubscription({
          auth: req.body.auth,
          endpoint: req.body.endpoint,
          p256dh: req.body.p256dh,
          userAgent: req.body.userAgent,
          user: req.user,
        });

        await transactionalRepo.save(userPushSubscription);
      }
    );

    return res.status(204).send();
  } catch {
    logger.error('Failed to register user push subscription', {
      label: 'API',
    });
    next({ status: 500, message: 'Failed to register subscription.' });
  }
});

router.get<{ userId: string }>(
  '/:userId/pushSubscriptions',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSubs = await userPushSubRepository.find({
        relations: { user: true },
        where: { user: { id: Number(req.params.userId) } },
      });

      return res.status(200).json(userPushSubs);
    } catch {
      next({ status: 404, message: 'User subscriptions not found.' });
    }
  }
);

router.get<{ userId: string; endpoint: string }>(
  '/:userId/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSub = await userPushSubRepository.findOneOrFail({
        relations: {
          user: true,
        },
        where: {
          user: { id: Number(req.params.userId) },
          endpoint: req.params.endpoint,
        },
      });

      return res.status(200).json(userPushSub);
    } catch {
      next({ status: 404, message: 'User subscription not found.' });
    }
  }
);

router.delete<{ userId: string; endpoint: string }>(
  '/:userId/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSub = await userPushSubRepository.findOne({
        relations: { user: true },
        where: {
          user: { id: Number(req.params.userId) },
          endpoint: req.params.endpoint,
        },
      });

      // If not found, just return 204 to prevent push disable failure
      // (rare scenario where user push sub does not exist)
      if (!userPushSub) {
        return res.status(204).send();
      }

      await userPushSubRepository.remove(userPushSub);
      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong deleting the user push subcription', {
        label: 'API',
        endpoint: req.params.endpoint,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'User push subcription not found',
      });
    }
  }
);

router.get<{ id: string }>('/:id', async (req, res, next) => {
  try {
    const userRepository = getRepository(User);
    const user = await userRepository.findOneOrFail({
      where: { id: Number(req.params.id) },
    });

    const isOwnProfile = req.user?.id === user.id;
    const isAdmin = req.user?.hasPermission(Permission.MANAGE_USERS);

    return res.status(200).json(user.filter(isOwnProfile || isAdmin));
  } catch {
    next({ status: 404, message: 'User not found.' });
  }
});

router.use('/:id/settings', userSettingsRoutes);
router.use('/:id/lists', userListRoutes);

router.get<{ id: string }, UserRequestsResponse>(
  '/:id/requests',
  async (req, res, next) => {
    const pageSize = req.query.take ? Number(req.query.take) : 20;
    const skip = req.query.skip ? Number(req.query.skip) : 0;

    try {
      const user = await getRepository(User).findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (
        user.id !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: "You do not have permission to view this user's requests.",
        });
      }

      const [requests, requestCount] = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.seasons', 'seasons')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .andWhere('requestedBy.id = :id', {
          id: user.id,
        })
        .orderBy('request.id', 'DESC')
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: requests,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export const canMakePermissionsChange = (
  permissions: number,
  user?: User
): boolean =>
  // Only let the owner grant admin privileges
  !(hasPermission(Permission.ADMIN, permissions) && user?.id !== 1);

router.put<
  Record<string, never>,
  Partial<User>[],
  { ids: string[]; permissions: number }
>('/', isAuthenticated(Permission.MANAGE_USERS), async (req, res, next) => {
  try {
    const isOwner = req.user?.id === 1;

    if (!canMakePermissionsChange(req.body.permissions, req.user)) {
      return next({
        status: 403,
        message: 'You do not have permission to grant this level of access',
      });
    }

    const userRepository = getRepository(User);

    const users: User[] = await userRepository.find({
      where: {
        id: In(
          isOwner ? req.body.ids : req.body.ids.filter((id) => Number(id) !== 1)
        ),
      },
    });

    const updatedUsers = await Promise.all(
      users.map(async (user) => {
        return userRepository.save(<User>{
          ...user,
          ...{ permissions: req.body.permissions },
        });
      })
    );

    return res.status(200).json(updatedUsers);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

router.put<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      // Only let the owner user modify themselves
      if (user.id === 1 && req.user?.id !== 1) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }

      if (!canMakePermissionsChange(req.body.permissions, req.user)) {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }

      Object.assign(user, {
        username: req.body.username,
        permissions: req.body.permissions,
      });

      await userRepository.save(user);

      return res.status(200).json(user.filter());
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
        relations: { requests: true },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (user.id === 1) {
        return next({
          status: 405,
          message: 'This account cannot be deleted.',
        });
      }

      if (user.hasPermission(Permission.ADMIN) && req.user?.id !== 1) {
        return next({
          status: 405,
          message: 'You cannot delete users with administrative privileges.',
        });
      }

      const requestRepository = getRepository(MediaRequest);

      /**
       * Requests are usually deleted through a cascade constraint. Those however, do
       * not trigger the removal event so listeners to not run and the parent Media
       * will not be updated back to unknown for titles that were still pending. So
       * we manually remove all requests from the user here so the parent media's
       * properly reflect the change.
       */
      await requestRepository.remove(user.requests, {
        /**
         * Break-up into groups of 1000 requests to be removed at a time.
         * Necessary for users with >1000 requests, else an SQLite 'Expression tree is too large' error occurs.
         * https://typeorm.io/repository-api#additional-options
         */
        chunk: user.requests.length / 1000,
      });

      await userRepository.delete(user.id);
      return res.status(200).json(user.filter());
    } catch (e) {
      logger.error('Something went wrong deleting a user', {
        label: 'API',
        userId: req.params.id,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Something went wrong deleting the user',
      });
    }
  }
);

router.post(
  '/import-from-plex',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const body = req.body as { plexIds: string[] } | undefined;

      // taken from auth.ts
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

      const plexUsersResponse = await mainPlexTv.getUsers();
      const createdUsers: User[] = [];
      for (const rawUser of plexUsersResponse.MediaContainer.User) {
        const account = rawUser.$;

        if (account.email) {
          const user = await userRepository
            .createQueryBuilder('user')
            .where('user.plexId = :id', { id: account.id })
            .orWhere('user.email = :email', {
              email: account.email.toLowerCase(),
            })
            .getOne();

          if (user) {
            // Update the user's avatar with their Plex thumbnail, in case it changed
            user.avatar = account.thumb;
            user.email = account.email;
            user.plexUsername = account.username;

            // In case the user was previously a local account
            if (user.userType === UserType.LOCAL) {
              user.userType = UserType.PLEX;
              user.plexId = parseInt(account.id);
            }
            await userRepository.save(user);
          } else if (!body || body.plexIds.includes(account.id)) {
            if (await mainPlexTv.checkUserAccess(parseInt(account.id))) {
              const newUser = new User({
                plexUsername: account.username,
                email: account.email,
                permissions: settings.main.defaultPermissions,
                plexId: parseInt(account.id),
                plexToken: '',
                avatar: account.thumb,
                userType: UserType.PLEX,
              });
              await userRepository.save(newUser);
              createdUsers.push(newUser);
            }
          }
        }
      }

      return res.status(201).json(User.filterMany(createdUsers));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post(
  '/import-from-jellyfin',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const body = req.body as { jellyfinUserIds: string[] };

      // taken from auth.ts
      const admin = await userRepository.findOneOrFail({
        where: { id: 1 },
        select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
        order: { id: 'ASC' },
      });

      const hostname = getHostname();
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey,
        admin.jellyfinDeviceId ?? ''
      );
      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

      //const jellyfinUsersResponse = await jellyfinClient.getUsers();
      const createdUsers: User[] = [];

      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');
      const jellyfinUsers = await jellyfinClient.getUsers();

      const jellyfinUsersById = new Map(
        jellyfinUsers.users.map((user) => [
          normalizeJellyfinGuid(user.Id),
          user,
        ])
      );

      for (const rawJellyfinUserId of body.jellyfinUserIds) {
        const jellyfinUserId = normalizeJellyfinGuid(rawJellyfinUserId);
        if (!jellyfinUserId) {
          continue;
        }

        const jellyfinUser = jellyfinUsersById.get(jellyfinUserId);

        const user = await userRepository.findOne({
          select: ['id', 'jellyfinUserId'],
          where: { jellyfinUserId: jellyfinUserId },
        });

        if (!user) {
          const newUser = new User({
            jellyfinUsername: jellyfinUser?.Name,
            jellyfinUserId: jellyfinUser?.Id,
            jellyfinDeviceId: Buffer.from(
              `BOT_seerr_${jellyfinUser?.Name ?? ''}`
            ).toString('base64'),
            email: jellyfinUser?.Name,
            permissions: settings.main.defaultPermissions,
            avatar: `/avatarproxy/${jellyfinUser?.Id}`,
            userType:
              settings.main.mediaServerType === MediaServerType.JELLYFIN
                ? UserType.JELLYFIN
                : UserType.EMBY,
          });

          await userRepository.save(newUser);
          createdUsers.push(newUser);
        }
      }
      return res.status(201).json(User.filterMany(createdUsers));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.get<{ id: string }, QuotaResponse>(
  '/:id/quota',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      if (
        Number(req.params.id) !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'and' }
        )
      ) {
        return next({
          status: 403,
          message:
            "You do not have permission to view this user's request limits.",
        });
      }

      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      const quotas = await user.getQuota();

      return res.status(200).json(quotas);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

router.get<{ id: string }, UserWatchDataResponse>(
  '/:id/watch_data',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const settings = getSettings().tautulli;

    if (!settings.hostname || !settings.port || !settings.apiKey) {
      return next({
        status: 404,
        message: 'Tautulli API not configured.',
      });
    }

    try {
      const user = await getRepository(User).findOneOrFail({
        where: { id: Number(req.params.id) },
        select: { id: true, plexId: true },
      });

      const tautulli = new TautulliAPI(settings);

      const watchStats = await tautulli.getUserWatchStats(user);
      const watchHistory = await tautulli.getUserWatchHistory(user);

      const recentlyWatched = sortBy(
        await getRepository(Media).find({
          where: [
            {
              mediaType: MediaType.MOVIE,
              ratingKey: In(
                watchHistory
                  .filter((record) => record.media_type === 'movie')
                  .map((record) => record.rating_key)
              ),
            },
            {
              mediaType: MediaType.MOVIE,
              ratingKey4k: In(
                watchHistory
                  .filter((record) => record.media_type === 'movie')
                  .map((record) => record.rating_key)
              ),
            },
            {
              mediaType: MediaType.TV,
              ratingKey: In(
                watchHistory
                  .filter((record) => record.media_type === 'episode')
                  .map((record) => record.grandparent_rating_key)
              ),
            },
            {
              mediaType: MediaType.TV,
              ratingKey4k: In(
                watchHistory
                  .filter((record) => record.media_type === 'episode')
                  .map((record) => record.grandparent_rating_key)
              ),
            },
          ],
        }),
        [
          (media) =>
            findIndex(
              watchHistory,
              (record) =>
                (!!media.ratingKey &&
                  parseInt(media.ratingKey) ===
                    (record.media_type === 'movie'
                      ? record.rating_key
                      : record.grandparent_rating_key)) ||
                (!!media.ratingKey4k &&
                  parseInt(media.ratingKey4k) ===
                    (record.media_type === 'movie'
                      ? record.rating_key
                      : record.grandparent_rating_key))
            ),
        ]
      );

      return res.status(200).json({
        recentlyWatched,
        playCount: watchStats.total_plays,
      });
    } catch (e) {
      logger.error('Something went wrong fetching user watch data', {
        label: 'API',
        errorMessage: e.message,
        userId: req.params.id,
      });
      next({
        status: 500,
        message: 'Failed to fetch user watch data.',
      });
    }
  }
);

router.get<{ id: string }, WatchlistResponse>(
  '/:id/watchlist',
  async (req, res, next) => {
    if (
      Number(req.params.id) !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.WATCHLIST_VIEW],
        {
          type: 'or',
        }
      )
    ) {
      return next({
        status: 403,
        message: "You do not have permission to view this user's Watchlist.",
      });
    }

    const itemsPerPage = 20;
    const page = req.query.page ? Number(req.query.page) : 1;
    const offset = (page - 1) * itemsPerPage;

    const user = await getRepository(User).findOneOrFail({
      where: { id: Number(req.params.id) },
      select: ['id', 'plexToken'],
    });

    if (user) {
      const [result, total] = await getRepository(Watchlist).findAndCount({
        where: { requestedBy: { id: user?.id } },
        relations: {
          /*requestedBy: true,media:true*/
        },
        // loadRelationIds: true,
        take: itemsPerPage,
        skip: offset,
      });
      if (total) {
        return res.json({
          page: page,
          totalPages: Math.ceil(total / itemsPerPage),
          totalResults: total,
          results: result,
        });
      }
    }

    // We will just return an empty array if the user has no Plex token
    if (!user.plexToken) {
      return res.json({
        page: 1,
        totalPages: 1,
        totalResults: 0,
        results: [],
      });
    }

    const plexTV = new PlexTvAPI(user.plexToken);

    const watchlist = await plexTV.getWatchlist({ offset });

    return res.json({
      page,
      totalPages: Math.ceil(watchlist.totalSize / itemsPerPage),
      totalResults: watchlist.totalSize,
      results: watchlist.items.map((item) => ({
        id: item.tmdbId,
        ratingKey: item.ratingKey,
        title: item.title,
        mediaType: item.type === 'show' ? 'tv' : 'movie',
        tmdbId: item.tmdbId,
      })),
    });
  }
);

/**
 * GET /:id/statistics
 * Returns detailed viewing statistics for the user.
 * Data is sourced from Jellyfin watch history and Seerr request history.
 * Results are cached per-user for 4 hours.
 */
router.get<{ id: string }, UserStatisticsResponse>(
  '/:id/statistics',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const cache = cacheManager.getCache('user-stats').data;
      const cacheKey = `stats-${req.params.id}`;
      const cached = cache.get<UserStatisticsResponse>(cacheKey);

      if (cached) {
        return res.status(200).json(cached);
      }

      const user = await getRepository(User).findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      // Initialize stats
      const stats: UserStatisticsResponse = {
        totalMoviesWatched: 0,
        totalEpisodesWatched: 0,
        totalWatchTimeMinutes: 0,
        averageWatchTimePerWeekMinutes: 0,
        topGenres: [],
        favoriteDecade: null,
        topActors: [],
        topDirectors: [],
        mostWatchedShow: null,
        currentStreak: 0,
        longestStreak: 0,
        requestsMade: 0,
        requestsFulfilled: 0,
        mostRecentWatch: null,
        preferredWatchingHour: null,
        mostActiveDay: null,
        genresByMonth: [],
        libraryUtilization: null,
      };

      // Get request statistics from the database
      const requestRepo = getRepository(MediaRequest);
      const totalRequests = await requestRepo.count({
        where: { requestedBy: { id: user.id } },
      });
      stats.requestsMade = totalRequests;

      // Count fulfilled requests (PARTIALLY_AVAILABLE = 4 or AVAILABLE = 5)
      const fulfilledRequests = await requestRepo
        .createQueryBuilder('request')
        .innerJoin('request.media', 'media')
        .where('request.requestedBy = :userId', { userId: user.id })
        .andWhere('media.status IN (:...statuses)', {
          statuses: [MediaStatus.PARTIALLY_AVAILABLE, MediaStatus.AVAILABLE],
        })
        .getCount();
      stats.requestsFulfilled = fulfilledRequests;

      // Fetch Jellyfin watch data if the user has a Jellyfin account
      if (user.jellyfinUserId) {
        const settings = getSettings();
        const jf = settings.jellyfin;
        if (jf.ip && jf.apiKey) {
          const protocol = jf.useSsl ? 'https' : 'http';
          const urlBase = jf.urlBase
            ? `/${jf.urlBase.replace(/^\//, '')}`
            : '';
          const baseUrl = `${protocol}://${jf.ip}:${jf.port}${urlBase}`;

          const jellyfinClient = new JellyfinAPI(baseUrl, jf.apiKey);
          jellyfinClient.setUserId(user.jellyfinUserId);

          // FIX: Paginate through ALL played items instead of using a fixed limit.
          // Previously, only 500 movies and 1000 episodes were fetched, causing
          // aggregate stats (genres, actors, streaks, etc.) to be incomplete for
          // users with larger watch histories while TotalRecordCount was correct.
          const PAGE_SIZE = 500;

          const fetchAllPlayedItems = async (
            itemType: string,
            fields: string
          ) => {
            const firstPage = await jellyfinClient.getPlayedItems({
              includeItemTypes: itemType,
              fields,
              limit: PAGE_SIZE,
              startIndex: 0,
            });
            const allItems = [...firstPage.Items];
            const total = firstPage.TotalRecordCount;

            // Fetch remaining pages if there are more items
            let offset = PAGE_SIZE;
            while (offset < total) {
              const page = await jellyfinClient.getPlayedItems({
                includeItemTypes: itemType,
                fields,
                limit: PAGE_SIZE,
                startIndex: offset,
              });
              allItems.push(...page.Items);
              offset += PAGE_SIZE;
            }

            return { Items: allItems, TotalRecordCount: total };
          };

          const movies = await fetchAllPlayedItems(
            'Movie',
            'Genres,People,RunTimeTicks,DateCreated,PremiereDate,DatePlayed'
          );

          const episodes = await fetchAllPlayedItems(
            'Episode',
            'Genres,People,RunTimeTicks,DateCreated,SeriesName,DatePlayed'
          );

          stats.totalMoviesWatched = movies.TotalRecordCount;
          stats.totalEpisodesWatched = episodes.TotalRecordCount;

          // FIX: Sort merged items by DatePlayed descending so that "Most Recent Watch"
          // reflects the actual last-watched item across both movies and episodes,
          // not just the first movie in the unsorted concatenation.
          const allItems = [...movies.Items, ...episodes.Items].sort(
            (a, b) => {
              const dateA = new Date(
                a.DatePlayed || a.DateCreated || 0
              ).getTime();
              const dateB = new Date(
                b.DatePlayed || b.DateCreated || 0
              ).getTime();
              return dateB - dateA;
            }
          );

          // Calculate total watch time
          let totalTicksWatched = 0;
          const genreCounts = new Map<string, number>();
          const actorCounts = new Map<string, number>();
          const directorCounts = new Map<string, number>();
          const showEpisodeCounts = new Map<string, number>();
          const decadeCounts = new Map<string, number>();
          const playDates: Date[] = [];
          const hourCounts = new Map<number, number>();
          const dayCounts = new Map<string, number>();
          // Track genres per month for the Genre Evolution chart
          const monthGenreCounts = new Map<string, Map<string, number>>();
          // Track unique series names for library utilization
          const watchedSeriesNames = new Set<string>();
          const dayNames = [
            'Sunday',
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
          ];

          for (const item of allItems) {
            // Watch time
            if (item.RunTimeTicks) {
              totalTicksWatched += item.RunTimeTicks;
            }

            // Genres
            if (item.Genres) {
              for (const genre of item.Genres) {
                genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
              }
            }

            // People (actors, directors)
            if (item.People) {
              for (const person of item.People) {
                if (person.Type === 'Actor' && person.Name) {
                  actorCounts.set(
                    person.Name,
                    (actorCounts.get(person.Name) ?? 0) + 1
                  );
                }
                if (person.Type === 'Director' && person.Name) {
                  directorCounts.set(
                    person.Name,
                    (directorCounts.get(person.Name) ?? 0) + 1
                  );
                }
              }
            }

            // Show episode counts
            if (item.SeriesName) {
              showEpisodeCounts.set(
                item.SeriesName,
                (showEpisodeCounts.get(item.SeriesName) ?? 0) + 1
              );
              // Track unique watched series for library utilization
              watchedSeriesNames.add(item.SeriesName);
            }

            // Decade counting (from release date)
            const premiereDate = item.PremiereDate || item.DateCreated;
            if (premiereDate) {
              const year = new Date(premiereDate).getFullYear();
              const decade = `${Math.floor(year / 10) * 10}s`;
              decadeCounts.set(
                decade,
                (decadeCounts.get(decade) ?? 0) + 1
              );
            }

            // Play date tracking for streaks and time insights
            const datePlayed = item.DatePlayed || item.DateCreated;
            if (datePlayed) {
              const playDate = new Date(datePlayed);
              playDates.push(playDate);

              // Hour tracking
              const hour = playDate.getHours();
              hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);

              // Day tracking
              const dayName = dayNames[playDate.getDay()];
              dayCounts.set(dayName, (dayCounts.get(dayName) ?? 0) + 1);
            }

            // Genre-by-week tracking for Genre Evolution chart.
            // Only use actual DatePlayed (not DateCreated fallback) to avoid
            // phantom data from items marked as played during library import
            // that have DateCreated well before the user started watching.
            if (item.DatePlayed && item.Genres) {
              const actualPlayDate = new Date(item.DatePlayed);
              // Use approximate week key (YYYY-Www) for weekly bins.
              // Note: This is a simplified week calculation that may not
              // align exactly with ISO 8601 week numbering for edge cases
              // at year boundaries. This is acceptable for chart display.
              const yearNum = actualPlayDate.getFullYear();
              const jan1 = new Date(yearNum, 0, 1);
              const dayOfYear =
                Math.floor(
                  (actualPlayDate.getTime() - jan1.getTime()) / 86400000
                ) + 1;
              const weekNum = Math.ceil(
                (dayOfYear + jan1.getDay()) / 7
              );
              const weekKey = `${yearNum}-W${String(weekNum).padStart(2, '0')}`;

              if (!monthGenreCounts.has(weekKey)) {
                monthGenreCounts.set(weekKey, new Map());
              }
              const weekMap = monthGenreCounts.get(weekKey)!;
              for (const genre of item.Genres) {
                weekMap.set(genre, (weekMap.get(genre) ?? 0) + 1);
              }
            }
          }

          // Convert ticks to minutes (1 tick = 100 nanoseconds = 1e-7 seconds)
          stats.totalWatchTimeMinutes = Math.round(
            totalTicksWatched / 10_000_000 / 60
          );

          // Average watch time per week
          if (playDates.length > 0) {
            const sortedDates = playDates.sort(
              (a, b) => a.getTime() - b.getTime()
            );
            const firstWatch = sortedDates[0];
            const now = new Date();
            const weeksSinceFirst = Math.max(
              1,
              (now.getTime() - firstWatch.getTime()) / (7 * 24 * 60 * 60 * 1000)
            );
            stats.averageWatchTimePerWeekMinutes = Math.round(
              stats.totalWatchTimeMinutes / weeksSinceFirst
            );
          }

          // Top 5 genres
          stats.topGenres = Array.from(genreCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

          // Favorite decade
          if (decadeCounts.size > 0) {
            stats.favoriteDecade = Array.from(decadeCounts.entries()).sort(
              (a, b) => b[1] - a[1]
            )[0][0];
          }

          // Top 5 actors
          stats.topActors = Array.from(actorCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

          // Top 5 directors
          stats.topDirectors = Array.from(directorCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count]) => ({ name, count }));

          // Most watched show
          if (showEpisodeCounts.size > 0) {
            const [showName, episodeCount] = Array.from(
              showEpisodeCounts.entries()
            ).sort((a, b) => b[1] - a[1])[0];
            stats.mostWatchedShow = {
              name: showName,
              episodeCount,
            };
          }

          // Most recent watch
          if (allItems.length > 0) {
            const mostRecent = allItems[0];
            stats.mostRecentWatch = {
              title:
                mostRecent.SeriesName
                  ? `${mostRecent.SeriesName} - ${mostRecent.Name}`
                  : mostRecent.Name,
              date: mostRecent.DatePlayed || mostRecent.DateCreated || '',
            };
          }

          // Streaks (consecutive days with at least one watch)
          if (playDates.length > 0) {
            const uniqueDays = new Set<string>();
            for (const date of playDates) {
              uniqueDays.add(date.toISOString().split('T')[0]);
            }
            const sortedDays = Array.from(uniqueDays).sort();

            let currentStreak = 0;
            let longestStreak = 0;
            let tempStreak = 1;

            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000)
              .toISOString()
              .split('T')[0];

            for (let i = 1; i < sortedDays.length; i++) {
              const prev = new Date(sortedDays[i - 1]);
              const curr = new Date(sortedDays[i]);
              const diffDays = Math.round(
                (curr.getTime() - prev.getTime()) / 86400000
              );

              if (diffDays === 1) {
                tempStreak++;
              } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 1;
              }
            }
            longestStreak = Math.max(longestStreak, tempStreak);

            // Check if current streak includes today or yesterday
            const lastDay = sortedDays[sortedDays.length - 1];
            if (lastDay === today || lastDay === yesterday) {
              tempStreak = 1;
              for (let i = sortedDays.length - 2; i >= 0; i--) {
                const curr = new Date(sortedDays[i + 1]);
                const prev = new Date(sortedDays[i]);
                const diffDays = Math.round(
                  (curr.getTime() - prev.getTime()) / 86400000
                );
                if (diffDays === 1) {
                  tempStreak++;
                } else {
                  break;
                }
              }
              currentStreak = tempStreak;
            }

            stats.currentStreak = currentStreak;
            stats.longestStreak = longestStreak;
          }

          // Preferred watching hour
          if (hourCounts.size > 0) {
            stats.preferredWatchingHour = Array.from(
              hourCounts.entries()
            ).sort((a, b) => b[1] - a[1])[0][0];
          }

          // Most active day
          if (dayCounts.size > 0) {
            stats.mostActiveDay = Array.from(dayCounts.entries()).sort(
              (a, b) => b[1] - a[1]
            )[0][0];
          }

          // Genre Evolution Over Time: build sorted monthly genre data
          if (monthGenreCounts.size > 0) {
            const sortedMonths = Array.from(monthGenreCounts.keys()).sort();
            stats.genresByMonth = sortedMonths.map((month) => {
              const genreMap = monthGenreCounts.get(month)!;
              const genres = Array.from(genreMap.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => ({ name, count }));
              return { month, genres };
            });
          }

          // Library Utilization: fetch total library counts from Jellyfin
          try {
            const libraries = await jellyfinClient.getLibraries();
            let totalMovies = 0;
            let totalShows = 0;
            let totalEpisodes = 0;
            for (const lib of libraries) {
              const contents = await jellyfinClient.getLibraryContents(
                lib.key
              );
              for (const item of contents) {
                if (item.Type === 'Movie') totalMovies++;
                if (item.Type === 'Series') totalShows++;
              }
            }

            // Fetch total episode count from Jellyfin
            try {
              const epResponse = await axios.get(
                `${baseUrl}/Items?IncludeItemTypes=Episode&Recursive=true&Limit=0&userId=${encodeURIComponent(
                  user.jellyfinUserId!
                )}&api_key=${encodeURIComponent(jf.apiKey)}`
              );
              totalEpisodes = epResponse.data?.TotalRecordCount ?? 0;
            } catch {
              // If episode count fetch fails, leave as 0
            }

            const watchedMovies = movies.TotalRecordCount;
            const watchedShows = watchedSeriesNames.size;
            const watchedEpisodes = episodes.TotalRecordCount;
            const totalItems = totalMovies + totalShows;
            const watchedItems = watchedMovies + watchedShows;
            const overallPercentage =
              totalItems > 0
                ? Math.round((watchedItems / totalItems) * 1000) / 10
                : 0;
            stats.libraryUtilization = {
              totalMovies,
              totalShows,
              totalEpisodes,
              watchedMovies,
              watchedShows,
              watchedEpisodes,
              overallPercentage,
            };
          } catch (libErr) {
            logger.warn('Failed to fetch library counts for utilization stat', {
              label: 'User',
              message: (libErr as Error).message,
            });
          }
        }
      }

      // Cache the result
      cache.set(cacheKey, stats);

      return res.status(200).json(stats);
    } catch (e) {
      logger.error('Failed to generate user statistics', {
        label: 'User',
        message: e.message,
      });
      next({ status: 500, message: 'Failed to generate statistics.' });
    }
  }
);

export default router;
