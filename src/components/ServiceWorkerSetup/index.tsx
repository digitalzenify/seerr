/* eslint-disable no-console */

import useSettings from '@app/hooks/useSettings';
import { useUser } from '@app/hooks/useUser';
import { verifyAndResubscribePushSubscription } from '@app/utils/pushSubscriptionHelpers';
import { useEffect } from 'react';

const ServiceWorkerSetup = () => {
  const { user } = useUser();
  const { currentSettings } = useSettings();

  useEffect(() => {
    if ('serviceWorker' in navigator && user?.id) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(async (registration) => {
          console.log(
            '[SW] Registration successful, scope is:',
            registration.scope
          );

          const rawFlag = localStorage.getItem('pushNotificationsEnabled');
          // null means the user has never explicitly opted in or out — treat as
          // "not disabled" so we can subscribe automatically when conditions are met.
          const isExplicitlyDisabled = rawFlag === 'false';

          // If the user explicitly disabled push, do nothing
          if (isExplicitlyDisabled) {
            return;
          }

          // If permission was revoked but we thought it was enabled, clear the flag
          if (Notification.permission !== 'granted' && rawFlag === 'true') {
            localStorage.setItem('pushNotificationsEnabled', 'false');
            console.warn(
              '[SW] Push permissions not granted — skipping resubscribe'
            );
            return;
          }

          // Only proceed if permission is already granted and admin has enabled push
          if (
            Notification.permission !== 'granted' ||
            !currentSettings.enablePushRegistration
          ) {
            return;
          }

          const subscription = await registration.pushManager.getSubscription();

          console.log(
            '[SW] Existing push subscription:',
            subscription?.endpoint
          );

          const verified = await verifyAndResubscribePushSubscription(
            user.id,
            currentSettings
          );

          if (verified) {
            // Persist that push is enabled so future page loads keep it alive
            localStorage.setItem('pushNotificationsEnabled', 'true');
            console.log('[SW] Push subscription verified or refreshed.');
          } else {
            console.warn(
              '[SW] Push subscription verification failed or not available.'
            );
          }
        })
        .catch(function (error) {
          console.log('[SW] Service worker registration failed, error:', error);
        });
    }
  }, [currentSettings, user]);
  return null;
};

export default ServiceWorkerSetup;
