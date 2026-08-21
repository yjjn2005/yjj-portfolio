/* 앱 껍데기만 캐시합니다. 시세·환율·동기화 API 는 항상 네트워크로 나갑니다.
   HTML 문서는 HTTP 캐시를 우회해 항상 최신본을 받아옵니다(업데이트 즉시 반영). */
const CACHE = 'yjj-portfolio-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.indexOf('/api/') === 0) return; // 시세·동기화는 캐시하지 않음

  const isDoc =
    e.request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html');

  // 문서는 HTTP 캐시를 무시하고 새로 받는다 (GitHub Pages 의 10분 캐시 회피)
  const net = isDoc
    ? fetch(url.href, { cache: 'reload', credentials: 'same-origin' })
    : fetch(e.request);

  e.respondWith(
    net
      .then((res) => {
        if (res && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(isDoc ? './index.html' : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
