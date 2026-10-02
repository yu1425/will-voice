/* Audio only: HTML, Next assets, APIs and generated speech always use the network. */
const CONFIG_CACHE = "will-voice-flow-audio-config";
const MANIFEST = "/flow-audio-manifest";
let configPromise;
function configuration() {
  if (!configPromise)
    configPromise = caches
      .open(CONFIG_CACHE)
      .then((cache) => cache.match(MANIFEST))
      .then((response) => {
        if (!response) throw new Error("Audio manifest unavailable");
        return response.json();
      })
      .catch((error) => {
        configPromise = null;
        throw error;
      });
  return configPromise;
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(MANIFEST, { cache: "no-store" });
      if (!response.ok) throw new Error("Audio manifest unavailable");
      const config = await response.clone().json();
      if (
        !/^will-voice-flow-audio-v\d+$/.test(config.cacheName) ||
        !Array.isArray(config.urls)
      )
        throw new Error("Invalid audio manifest");
      await (await caches.open(CONFIG_CACHE)).put(MANIFEST, response);
      configPromise = Promise.resolve(config);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const config = await configuration();
      const cache = await caches.open(config.cacheName);
      const complete = (
        await Promise.all(config.urls.map((src) => cache.match(src)))
      ).every((response) => response?.status === 200);
      // Do not remove a prepared version while its replacement is still empty.
      if (complete) {
        for (const key of await caches.keys()) {
          if (
            /^will-voice-flow-audio-v\d+$/.test(key) &&
            key !== config.cacheName
          )
            await caches.delete(key);
        }
      }
      await self.clients.claim();
    })(),
  );
});
async function rangeResponse(response, range) {
  if (!range) return response;
  // Native iOS media requests byte ranges even for a fully cached WAV.
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return response;
  const buffer = await response.arrayBuffer();
  const size = buffer.byteLength;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || start > end)
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  const headers = new Headers(response.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(buffer.slice(start, end + 1), { status: 206, headers });
}
async function audioResponse(request) {
  const config = await configuration();
  const url = new URL(request.url);
  if (!config.urls.includes(url.pathname)) return fetch(request);
  let response;
  try {
    response = await (await caches.open(config.cacheName)).match(url.pathname);
  } catch {
    /* Online degradation. */
  }
  if (response?.status !== 200) {
    // Fixed v2 URLs are immutable. Keep a running page usable during worker updates.
    for (const key of (await caches.keys()).reverse()) {
      if (!/^will-voice-flow-audio-v\d+$/.test(key) || key === config.cacheName)
        continue;
      try {
        response = await (await caches.open(key)).match(url.pathname);
      } catch {
        /* Try network below. */
      }
      if (response?.status === 200) break;
    }
  }
  if (response?.status !== 200) return fetch(request);
  return rangeResponse(response, request.headers.get("range"));
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith("/audio/flow/v2/")
  )
    return;
  event.respondWith(
    audioResponse(event.request).catch(() => fetch(event.request)),
  );
});
