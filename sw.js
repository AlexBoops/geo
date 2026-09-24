// sw.js
const DATA_PARTS = 16;
const WASM_PARTS = 4;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercept gd_web.data and merge the 16 chunks
  if (url.pathname.endsWith('gd_web.data')) {
    event.respondWith(
      (async () => {
        const chunks = [];
        let totalBytes = 0;
        const base = event.request.url;

        for (let i = 1; i <= DATA_PARTS; i++) {
          const partRes = await fetch(`${base}.part${i}`);
          if (!partRes.ok) throw new Error(`Failed to load part ${i}`);
          const buf = await partRes.arrayBuffer();
          chunks.push(new Uint8Array(buf));
          totalBytes += buf.byteLength;
        }

        const merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        return new Response(merged, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(totalBytes)
          }
        });
      })()
    );
  }
});
