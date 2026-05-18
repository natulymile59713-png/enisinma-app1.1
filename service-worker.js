// @ts-nocheck
/* eslint-disable no-restricted-globals */
// ===== 縁の間 ユーザーアプリ Service Worker =====
//
// 戦略:
//   - HTML / アプリ JS: network-first（最新を取る）→ オフライン時はキャッシュ
//   - icons / manifest: cache-first（変更頻度低い）
//   - push: 受信時に Notification を表示
//   - notificationclick: アプリを開く / 該当タブにフォーカス
//
// バージョンを上げると古いキャッシュは自動削除される
const CACHE_NAME = 'enishinoma-user-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.filter(Boolean)))
      .catch((err) => console.log('[sw] precache error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 外部ドメイン（Supabase, CDN）はキャッシュしない
  if (url.origin !== self.location.origin) return;

  // ナビゲーション: network-first
  if (req.mode === 'navigate' || (req.destination === 'document')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  // 静的アセット: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

// ===== Push 受信 =====
self.addEventListener('push', (event) => {
  let payload = { title: '縁の間', body: '新しい通知が届きました', url: './' };
  if (event.data) {
    try { payload = Object.assign(payload, event.data.json()); }
    catch (e) { payload.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icons/icon.svg',
      badge: './icons/icon-maskable.svg',
      data: { url: payload.url || './' },
      tag: payload.tag || 'enishinoma-default',
      renotify: true,
    })
  );
});

// ===== 通知クリック =====
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      // 既に開いてるタブがあればそれにフォーカス
      for (const c of all) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          c.navigate(targetUrl).catch(() => {});
          return c.focus();
        }
      }
      // 無ければ新規で開く
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
