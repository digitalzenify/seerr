import BazarrAPI from '@server/api/bazarr';
import type { BazarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const bazarrRoutes = Router();

bazarrRoutes.get('/', (_req, res) => {
  const settings = getSettings();
  res.status(200).json(settings.bazarr);
});

bazarrRoutes.post('/', async (req, res) => {
  const settings = getSettings();
  const newBazarr = req.body as BazarrSettings;
  const lastItem = settings.bazarr[settings.bazarr.length - 1];
  newBazarr.id = lastItem ? lastItem.id + 1 : 0;

  settings.bazarr = [...settings.bazarr, newBazarr];
  await settings.save();

  return res.status(201).json(newBazarr);
});

bazarrRoutes.post<
  undefined,
  Record<string, unknown>,
  BazarrSettings
>('/test', async (req, res, next) => {
  try {
    const url = BazarrAPI.buildUrl(req.body);

    const bazarr = new BazarrAPI(url, req.body.apiKey);
    const status = await bazarr.getSystemStatus();

    return res.status(200).json({
      version: status.bazarr_version,
      radarrAccessible: status.radarr_accessible,
      sonarrAccessible: status.sonarr_accessible,
    });
  } catch (e) {
    logger.error('Failed to test Bazarr', {
      label: 'Bazarr',
      message: e.message,
    });

    next({ status: 500, message: 'Failed to connect to Bazarr' });
  }
});

bazarrRoutes.put<{ id: string }, BazarrSettings, BazarrSettings>(
  '/:id',
  async (req, res, next) => {
    const settings = getSettings();

    const bazarrIndex = settings.bazarr.findIndex(
      (b) => b.id === Number(req.params.id)
    );

    if (bazarrIndex === -1) {
      return next({ status: 404, message: 'Settings instance not found' });
    }

    settings.bazarr[bazarrIndex] = {
      ...req.body,
      id: Number(req.params.id),
    } as BazarrSettings;
    await settings.save();

    return res.status(200).json(settings.bazarr[bazarrIndex]);
  }
);

bazarrRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  const settings = getSettings();

  const bazarrIndex = settings.bazarr.findIndex(
    (b) => b.id === Number(req.params.id)
  );

  if (bazarrIndex === -1) {
    return next({ status: 404, message: 'Settings instance not found' });
  }

  const removed = settings.bazarr.splice(bazarrIndex, 1);
  await settings.save();

  return res.status(200).json(removed[0]);
});

export default bazarrRoutes;
