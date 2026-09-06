/* Firebase Cloud Messaging service worker.
   Shows push notifications while the app is closed or in the background. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Fill these in with the SAME web app config you put in .env (VITE_FIREBASE_*).
// The main appends them as query params when registering this worker.
const params = new URLSearchParams(self.location.search);
firebase.initializeApp({
  apiKey: params.get('apiKey') || '',
  authDomain: params.get('authDomain') || '',
  projectId: params.get('projectId') || '',
  messagingSenderId: params.get('senderId') || '',
  appId: params.get('appId') || '',
});

try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || payload.data?.title || 'Store update';
    const body = (payload.notification && payload.notification.body) || payload.data?.body || '';
    self.registration.showNotification(title, { body, tag: 'store-notification', renotify: true });
  });
} catch (e) {
  // Firebase not configured yet — notifications simply won't appear.
}
