// Service worker minimal : il rend Calendarr installable comme une app.
// Il ne met rien en cache, pour que le programme soit toujours à jour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
