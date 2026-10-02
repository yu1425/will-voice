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
  // Exercise the actual worker's handlers without a browser: range requests and scoped cleanup.
  const handlers = new Map();
  const deleted = [];
  let claimed = false,
    skipped = false;
  const configEntries = new Map();
  const configCache = {
    match: async (url) => configEntries.get(url)?.clone(),
    put: async (url, response) => configEntries.set(url, response.clone()),
  };
  const sandbox = {
    URL,
    Headers,
    Request,
    Response,
    self: {
      location: { origin: "https://example.com" },
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
      open: async (name) => (name.endsWith("config") ? configCache : cache),
      keys: async () => [
        api.FLOW_AUDIO_CACHE,
        "will-voice-flow-audio-v0",
        "unrelated-cache",
      ],
      delete: async (name) => deleted.push(name),
    },
    fetch: async (request) => {
      if (request === "/flow-audio-manifest")
        return Response.json({ cacheName: api.FLOW_AUDIO_CACHE, urls });
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
  entries.set(urls[0], audio());
  handlers.get("activate")({
    waitUntil: (promise) => {
      work = promise;
    },
  });
  await work;
  assert.deepEqual(deleted, ["will-voice-flow-audio-v0"]);
  entries.set(urls[0], audio());
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
