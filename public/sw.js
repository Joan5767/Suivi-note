// Service Worker des notifications push.
// Ce fichier doit rester dans /public/sw.js

self.addEventListener('push', function (event) {
  if (!event.data) return;

  let data;

  try {
    data = event.data.json();
  } catch (error) {
    data = {
      title: 'Rappel',
      body: event.data.text(),
      url: '/',
    };
  }

  const options = {
    body: data.body || 'Tu as une tâche à traiter.',

    // On garde ton icône actuelle en secours.
    // Plus tard, on pourra la remplacer par une vraie icône locale de l'application.
    icon:
      data.icon ||
      'https://www.google.com/s2/favicons?sz=192&domain=google.com',

    badge:
      data.badge ||
      'https://www.google.com/s2/favicons?sz=192&domain=google.com',

    vibrate: [200, 100, 200, 100, 200],

    // Garde la notification visible jusqu'à interaction lorsque
    // le navigateur / système prend cette option en charge.
    requireInteraction: true,

    // S'assure que la notification n'est pas volontairement silencieuse.
    silent: false,

    // Une même note remplace une éventuelle ancienne notification
    // encore affichée au lieu de s'empiler inutilement.
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),

    timestamp: data.timestamp || Date.now(),

    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Rappel', options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      .then(function (clientList) {
        // Si l'application est déjà ouverte, on remet cette fenêtre au premier plan.
        for (const client of clientList) {
          if ('focus' in client) {
            try {
              const clientUrl = new URL(client.url);

              if (clientUrl.origin === self.location.origin) {
                return client.focus();
              }
            } catch (error) {
              // Si l'URL ne peut pas être analysée, on passe au client suivant.
            }
          }
        }

        // Sinon on ouvre l'application.
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});
