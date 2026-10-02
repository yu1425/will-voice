/* Audio only: HTML, Next assets, APIs and generated speech always use the network. */
const MANIFEST = "/flow-audio-manifest";
const AUDIO_CACHE_PATTERN = /^will-voice-flow-audio-v\d+$/;
const CONFIG_CACHE_PATTERN =
  /^will-voice-flow-audio-config-will-voice-flow-audio-v\d+$/;
const LEGACY_CONFIG_CACHE = "will-voice-flow-audio-config";
const VERSION_MESSAGE = "WILL_FLOW_AUDIO_VERSION";
const WORKER_CACHE = new URL(self.location.href).searchParams.get("audio-cache");
if (!WORKER_CACHE || !AUDIO_CACHE_PATTERN.test(WORKER_CACHE))
  throw new Error("Missing or invalid audio cache version");
const CONFIG_CACHE = `will-voice-flow-audio-config-${WORKER_CACHE}`;
let configPromise;

function validConfiguration(config) {
  return (
    config &&
    config.cacheName === WORKER_CACHE &&
    Array.isArray(config.urls) &&
    config.urls.every(
      (src) =>
        typeof src === "string" && src.startsWith("/audio/flow/v2/"),
    )
  );
}

function configuration() {
  if (!configPromise)
    configPromise = caches
      .open(CONFIG_CACHE)
      .then((cache) => cache.match(MANIFEST))
      .then(async (response) => {
        if (!response) throw new Error("Audio manifest unavailable");
        const config = await response.json();
        if (!validConfiguration(config)) throw new Error("Invalid audio manifest");
        return config;
      })
      .catch((error) => {
        configPromise = null;
        throw error;
      });
  return configPromise;
}

async function cacheComplete(config) {
  const cache = await caches.open(config.cacheName);
  return (
    await Promise.all(config.urls.map((src) => cache.match(src)))
  ).every((response) => response?.status === 200);
}

async function cleanupOldVersionCaches(config) {
  if (!(await cacheComplete(config))) return;
  for (const key of await caches.keys()) {
    const obsoleteAudio =
      AUDIO_CACHE_PATTERN.test(key) && key !== config.cacheName;
    const obsoleteConfig =
      (CONFIG_CACHE_PATTERN.test(key) && key !== CONFIG_CACHE) ||
      key === LEGACY_CONFIG_CACHE;
    if (obsoleteAudio || obsoleteConfig) await caches.delete(key);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch(MANIFEST, { cache: "no-store" });
      if (!response.ok) throw new Error("Audio manifest unavailable");
      const config = await response.clone().json();
      if (!validConfiguration(config)) throw new Error("Invalid audio manifest");
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
      await cleanupOldVersionCaches(config);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== VERSION_MESSAGE) return;
  const reply = { type: VERSION_MESSAGE, cacheName: WORKER_CACHE };
  if (event.ports?.[0]) event.ports[0].postMessage(reply);
  else event.source?.postMessage(reply);
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
    // Keep a running page usable until the prepared replacement can safely retire old audio.
    for (const key of (await caches.keys()).reverse()) {
      if (!AUDIO_CACHE_PATTERN.test(key) || key === config.cacheName) continue;
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
