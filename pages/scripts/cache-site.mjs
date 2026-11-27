import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = new URL('../dist/', import.meta.url)
const files = (await readdir(dist, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'sw.js')
  .map(entry => relative(fileURLToPath(dist), join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .filter(file => !file.endsWith('.wasm') && !file.endsWith('.bin') && !/narration.worker|onnx|ort-wasm/.test(file))
  .sort()
const hash = createHash('sha256')
for (const file of files) {
  hash.update(file)
  hash.update(await readFile(new URL(file, dist)))
}
const revision = hash.digest('hex').slice(0, 16)

await writeFile(new URL('sw.js', dist), `
const PREFIX = 'auden-pages:' + self.registration.scope + ':';
const CACHE = PREFIX + '${revision}';
const assets = ${JSON.stringify(files)}.map(file => new URL(file, self.registration.scope).href);
const index = new URL('index.html', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(assets)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))).then(() => self.clients.claim())
  ));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate' && url.pathname === new URL('.', index).pathname) {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(index))));
  } else if (assets.includes(url.href)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(hit => hit || fetch(event.request)));
  }
});
`)
