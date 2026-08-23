// Ce fichier est le "Service Worker" qui tourne en arrière-plan

self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: data.icon || 'https://www.google.com/s2/favicons?sz=192&domain=google.com',
      badge: 'https://www.google.com/s2/favicons?sz=192&domain=google.com',
      vibrate: [200, 100, 200, 100, 200, 100, 200],
      data: {
        url: data.url || '/'
      }
    };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
