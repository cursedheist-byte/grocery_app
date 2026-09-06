// Web push (FCM) for the customer app.
// Configure VITE_FIREBASE_* + VITE_FIREBASE_VAPID_KEY in customer/.env, then
// every notification the admin sends arrives as a real device notification.
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

/** Ask permission, fetch the FCM token and register it with the backend. */
export async function enablePushNotifications(
  registerToken: (token: string) => Promise<void>,
  onForeground?: (title: string, body: string) => void,
): Promise<void> {
  try {
    if (!(await isSupported())) return;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;

    let messaging: Messaging;
    try {
      messaging = getMessaging(initializeApp(firebaseConfig));
    } catch {
      return; // firebase config missing
    }

    const swUrl = '/firebase-messaging-sw.js?' + new URLSearchParams({
      apiKey: firebaseConfig.apiKey,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      senderId: firebaseConfig.messagingSenderId,
      appId: firebaseConfig.appId,
    }).toString();
    const registration = await navigator.serviceWorker.register(swUrl);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;

    await registerToken(token);

    onMessage(messaging, (payload) => {
      const title = payload.notification?.title || payload.data?.title || 'Store update';
      const body = payload.notification?.body || payload.data?.body || '';
      if (onForeground) onForeground(title, body);
    });
  } catch {
    // Push is optional — never break the app over it.
  }
}

export const pushConfigured = Boolean(VAPID_KEY && firebaseConfig.apiKey);
