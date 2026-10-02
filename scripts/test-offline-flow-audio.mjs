import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
const temp = mkdtempSync(join(tmpdir(), "will-offline-tests-"));
try {
  execFileSync("node", [
    "node_modules/typescript/bin/tsc",
    "lib/offlineFlowAudio.ts",
    "--outDir",
    temp,
    "--module",
    "commonjs",
    "--target",
    "ES2022",
    "--resolveJsonModule",
    "--esModuleInterop",
    "--skipLibCheck",
  ]);
  const require = createRequire(import.meta.url);
  const api = require(join(temp, "offlineFlowAudio.js"));
  const { buildStandardTwoHourEvents } = require(
    join(temp, "standardTwoHourFlow.js"),
  );
  const urls = api.getOfflineFlowAudioUrls();
  assert.equal(urls.length, new Set(urls).size);
  assert.ok(
    urls.every(
      (url) => url.startsWith("/audio/flow/v2/") && url.endsWith(".wav"),
    ),
  );
  for (const courts of [1, 2])
    for (const event of buildStandardTwoHourEvents(courts))
      if (event.audioSrc) assert.ok(urls.includes(event.audioSrc));
  assert.equal(
    api.getFlowAudioTitle(
      "https://example.com/audio/flow/v2/43-game-rules.wav",
    ),
    "試合ルール",
  );
  const entries = new Map();
  const audio = () =>
    new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      headers: { "Content-Type": "audio/wav" },
    });
  const cache = {
    match: async (url) => entries.get(url)?.clone(),
    put: async (url, response) => {
      entries.set(url, response.clone());
    },
  };
  let fetching = 0,
    peak = 0,
    requests = 0;
  const fetchAudio = async () => {
    requests++;
    fetching++;
    peak = Math.max(peak, fetching);
    await new Promise((r) => setTimeout(r, 1));
    fetching--;
    return audio();
  };
  const progress = [];
  assert.equal(
    (await api.prepareAudioCache(cache, fetchAudio, (r) => progress.push(r)))
      .ready,
    true,
  );
  assert.ok(peak <= 3);
  assert.equal(progress.length, urls.length);
  const originalRequests = requests;
  assert.equal((await api.prepareAudioCache(cache, fetchAudio)).ready, true);
  assert.equal(requests, originalRequests);
  entries.delete(urls[0]);
  assert.equal(
    (await api.prepareAudioCache(cache, fetchAudio, undefined, false)).ready,
    false,
  );
  const failure = await api.prepareAudioCache(cache, async () => {
    throw new Error("offline");
  });
  assert.deepEqual(failure.failedUrls, [urls[0]]);
  assert.equal(failure.ready, false);
  assert.equal((await api.checkFlowAudio()).supported, false);
  assert.equal(
    api.getFlowAudioWorkerScriptUrl(),
    `/sw.js?audio-cache=${api.FLOW_AUDIO_CACHE}`,
  );
  const clientDeleted = [];
  await api.cleanupOldFlowAudioCaches({
    keys: async () => [
      api.FLOW_AUDIO_CACHE,
      "will-voice-flow-audio-v0",
      `will-voice-flow-audio-config-${api.FLOW_AUDIO_CACHE}`,
      "will-voice-flow-audio-config-will-voice-flow-audio-v0",
      "will-voice-flow-audio-config",
      "unrelated-cache",
    ],
    delete: async (name) => {
      clientDeleted.push(name);
      return true;
    },
  });
  assert.deepEqual(clientDeleted.sort(), [
    "will-voice-flow-audio-config",
    "will-voice-flow-audio-config-will-voice-flow-audio-v0",
    "will-voice-flow-audio-v0",
  ]);

  // Exercise a simulated v1 -> v2 worker update. The old prepared cache must
  // survive activation until v2 is complete, and the worker must report v2.
  const futureCacheName = "will-voice-flow-audio-v2";
  const futureEntries = new Map();
  const oldEntries = new Map(urls.map((src) => [src, audio()]));
  const configEntries = new Map();
  const makeCache = (map) => ({
    match: async (url) => map.get(url)?.clone(),
    put: async (url, response) => map.set(url, response.clone()),
  });
  const namedCaches = new Map([
    [futureCacheName, makeCache(futureEntries)],
    [api.FLOW_AUDIO_CACHE, makeCache(oldEntries)],
    [`will-voice-flow-audio-config-${futureCacheName}`, makeCache(configEntries)],
  ]);
  const handlers = new Map();
  const deleted = [];
  let claimed = false,
    skipped = false;
  const cacheKeys = [
    futureCacheName,
    api.FLOW_AUDIO_CACHE,
    `will-voice-flow-audio-config-${futureCacheName}`,
    `will-voice-flow-audio-config-${api.FLOW_AUDIO_CACHE}`,
    "will-voice-flow-audio-config",
    "unrelated-cache",
  ];
  const sandbox = {
    URL,
    Headers,
    Request,
    Response,
    self: {
      location: {
        origin: "https://example.com",
        href: `https://example.com/sw.js?audio-cache=${futureCacheName}`,
      },
      addEventListener: (type, handler) => handlers.set(type, handler),
      skipWaiting: async () => {
        skipped = true;
      },
      clients: {
        claim: async () => {
          claimed = true;
        },
      },
    },
    caches: {
      open: async (name) => {
        if (!namedCaches.has(name)) namedCaches.set(name, makeCache(new Map()));
        return namedCaches.get(name);
      },
      keys: async () => [...cacheKeys],
      delete: async (name) => {
        deleted.push(name);
        const index = cacheKeys.indexOf(name);
        if (index >= 0) cacheKeys.splice(index, 1);
        namedCaches.delete(name);
        return true;
      },
    },
    fetch: async (request) => {
      if (request === "/flow-audio-manifest")
        return Response.json({ cacheName: futureCacheName, urls });
      throw new Error("network disabled");
    },
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), sandbox);
  let work;
  handlers.get("install")({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
  handlers.get("activate")({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
  assert.equal(claimed && skipped, true);
  assert.deepEqual(deleted, []);

  let versionReply;
  handlers.get("message")({
    data: { type: "WILL_FLOW_AUDIO_VERSION" },
    ports: [{ postMessage: (value) => (versionReply = value) }],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(versionReply)),
    { type: "WILL_FLOW_AUDIO_VERSION", cacheName: futureCacheName },
  );

  for (const src of urls) futureEntries.set(src, audio());
  handlers.get("activate")({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
  assert.deepEqual(deleted.sort(), [
    "will-voice-flow-audio-config",
    `will-voice-flow-audio-config-${api.FLOW_AUDIO_CACHE}`,
    api.FLOW_AUDIO_CACHE,
  ].sort());
  assert.ok(cacheKeys.includes(futureCacheName));
  assert.ok(
    cacheKeys.includes(`will-voice-flow-audio-config-${futureCacheName}`),
  );
  assert.ok(cacheKeys.includes("unrelated-cache"));

  const fetchWorker = async (path, range) => {
    let response;
    handlers.get("fetch")({
      request: new Request(`https://example.com${path}`, {
        headers: range ? { Range: range } : {},
      }),
      respondWith: (promise) => {
        response = promise;
      },
    });
    return response;
  };
  assert.equal(await fetchWorker("/api/openai/tts"), undefined);
  assert.equal(await fetchWorker("/_next/static/app.js"), undefined);
  assert.equal(await fetchWorker("/flow"), undefined);
  const range = await fetchWorker(urls[0], "bytes=1-3");
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 1-3/5");
  assert.deepEqual([...new Uint8Array(await range.arrayBuffer())], [2, 3, 4]);
  assert.equal((await fetchWorker(urls[0], "bytes=10-")).status, 416);
  assert.equal(
    (await fetchWorker(urls[0], "bytes=-2")).headers.get("content-range"),
    "bytes 3-4/5",
  );
  assert.equal((await fetchWorker(urls[0])).status, 200);
  console.log(
    `PASS: ${urls.length} unique fixed WAVs, cache readiness/failures, bounded preparation, no redownload, worker range playback and scoped updates`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
