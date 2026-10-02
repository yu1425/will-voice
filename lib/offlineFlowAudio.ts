import { buildStandardTwoHourEvents } from "./standardTwoHourFlow";
import { FLOW_VOICE_TEST } from "./flowScripts";

// Bump when fixed audio contents/URLs change. The worker reads this via the manifest.
export const FLOW_AUDIO_CACHE = "will-voice-flow-audio-v2";
export const FLOW_AUDIO_MANIFEST = "/flow-audio-manifest";
const FLOW_AUDIO_CACHE_PATTERN = /^will-voice-flow-audio-v\d+$/;
const FLOW_AUDIO_CONFIG_PATTERN =
  /^will-voice-flow-audio-config-will-voice-flow-audio-v\d+$/;
const LEGACY_FLOW_AUDIO_CONFIG_CACHE = "will-voice-flow-audio-config";
const FLOW_AUDIO_WORKER_MESSAGE = "WILL_FLOW_AUDIO_VERSION";
const FLOW_AUDIO_WORKER_PATH = "/sw.js";

export function getFlowAudioWorkerScriptUrl(
  cacheName = FLOW_AUDIO_CACHE,
): string {
  return `${FLOW_AUDIO_WORKER_PATH}?audio-cache=${encodeURIComponent(cacheName)}`;
}

function flowAudioConfigCacheName(cacheName: string): string {
  return `will-voice-flow-audio-config-${cacheName}`;
}
export function getOfflineFlowAudioUrls(): string[] {
  return [
    ...new Set(
      [
        ...buildStandardTwoHourEvents(1),
        ...buildStandardTwoHourEvents(2),
        FLOW_VOICE_TEST,
      ]
        .map((event) => event.audioSrc)
        .filter((src): src is string => Boolean(src)),
    ),
  ];
}
export function getFlowAudioTitle(src: string): string {
  let path = src;
  try {
    path = new URL(src, "https://will.invalid").pathname;
  } catch {
    /* filename fallback */
  }
  return (
    [...buildStandardTwoHourEvents(1), ...buildStandardTwoHourEvents(2)].find(
      (event) => event.audioSrc === path,
    )?.title ??
    (path === FLOW_VOICE_TEST.audioSrc
      ? "音声テスト"
      : path.split("/").pop() || "音声")
  );
}
export type AudioReadiness = {
  total: number;
  cached: number;
  failed: number;
  failedUrls: string[];
  ready: boolean;
  supported: boolean;
  workerReady: boolean;
};
type AudioCache = Pick<Cache, "match" | "put">;
export function audioReadiness(
  cached: number,
  failedUrls: string[],
  supported = true,
  workerReady = true,
): AudioReadiness {
  const total = getOfflineFlowAudioUrls().length;
  return {
    total,
    cached,
    failed: failedUrls.length,
    failedUrls,
    supported,
    workerReady,
    ready:
      supported && workerReady && cached === total && failedUrls.length === 0,
  };
}
/** Injectable browser boundaries; at most three downloads, each checked again after writing. */
export async function prepareAudioCache(
  cache: AudioCache,
  fetchAudio: typeof fetch,
  onProgress?: (r: AudioReadiness) => void,
  download = true,
): Promise<AudioReadiness> {
  const urls = getOfflineFlowAudioUrls();
  let index = 0,
    cached = 0;
  const failedUrls: string[] = [];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (index < urls.length) {
        const src = urls[index++];
        try {
          let response = await cache.match(src);
          if (response?.status !== 200 && download) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            try {
              response = await fetchAudio(src, {
                cache: "no-store",
                signal: controller.signal,
              });
              if (
                response.status !== 200 ||
                !response.headers.get("content-type")?.startsWith("audio/")
              )
                throw new Error("音声を取得できませんでした");
              await cache.put(src, response);
              response = await cache.match(src);
            } finally {
              clearTimeout(timeout);
            }
          }
          if (response?.status === 200) cached++;
          else if (download) failedUrls.push(src);
        } catch {
          failedUrls.push(src);
        }
        onProgress?.(audioReadiness(cached, [...failedUrls]));
      }
    }),
  );
  return audioReadiness(cached, failedUrls);
}
type CacheStorageBoundary = Pick<CacheStorage, "keys" | "delete">;

export async function cleanupOldFlowAudioCaches(
  storage: CacheStorageBoundary,
  cacheName = FLOW_AUDIO_CACHE,
): Promise<string[]> {
  const currentConfig = flowAudioConfigCacheName(cacheName);
  const deleted: string[] = [];
  for (const key of await storage.keys()) {
    const obsoleteAudio =
      FLOW_AUDIO_CACHE_PATTERN.test(key) && key !== cacheName;
    const obsoleteConfig =
      (FLOW_AUDIO_CONFIG_PATTERN.test(key) && key !== currentConfig) ||
      key === LEGACY_FLOW_AUDIO_CONFIG_CACHE;
    if ((obsoleteAudio || obsoleteConfig) && (await storage.delete(key)))
      deleted.push(key);
  }
  return deleted;
}

async function getWorkerAudioCacheName(
  worker: ServiceWorker | null,
  timeoutMs = 500,
): Promise<string | null> {
  if (!worker || typeof MessageChannel === "undefined") return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      const data = event.data;
      finish(
        data?.type === FLOW_AUDIO_WORKER_MESSAGE &&
          typeof data.cacheName === "string"
          ? data.cacheName
          : null,
      );
    };
    try {
      worker.postMessage({ type: FLOW_AUDIO_WORKER_MESSAGE }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function expectedWorkerControlsPage(
  container: ServiceWorkerContainer,
  timeoutMs = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      (await getWorkerAudioCacheName(container.controller)) === FLOW_AUDIO_CACHE
    )
      return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

let registration: Promise<boolean> | null = null;
export function registerFlowAudioWorker(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.serviceWorker?.register ||
    !globalThis.isSecureContext
  )
    return Promise.resolve(false);
  if (registration) return registration;
  registration = (async () => {
    try {
      const container = navigator.serviceWorker;
      await container.register(getFlowAudioWorkerScriptUrl(), {
        scope: "/",
        updateViaCache: "none",
      });
      return await expectedWorkerControlsPage(container);
    } catch {
      return false;
    }
  })().then((ok) => {
    if (!ok) registration = null;
    return ok;
  });
  return registration;
}

async function currentWorkerReady(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;
  return (
    (await getWorkerAudioCacheName(navigator.serviceWorker.controller)) ===
    FLOW_AUDIO_CACHE
  );
}

let preparation: Promise<AudioReadiness> | null = null;
export async function checkFlowAudio(): Promise<AudioReadiness> {
  try {
    if (!("caches" in globalThis)) return audioReadiness(0, [], false, false);
    const result = await prepareAudioCache(
      await caches.open(FLOW_AUDIO_CACHE),
      fetch,
      undefined,
      false,
    );
    const workerReady = await currentWorkerReady();
    return { ...result, workerReady, ready: result.ready && workerReady };
  } catch {
    return audioReadiness(0, [], false, false);
  }
}
export function prepareFlowAudio(
  onProgress?: (r: AudioReadiness) => void,
): Promise<AudioReadiness> {
  if (preparation) return preparation;
  preparation = (async () => {
    try {
      if (!("caches" in globalThis)) return audioReadiness(0, [], false, false);
      const workerReady = await registerFlowAudioWorker();
      const result = await prepareAudioCache(
        await caches.open(FLOW_AUDIO_CACHE),
        fetch,
        (r) =>
          onProgress?.({ ...r, workerReady, ready: r.ready && workerReady }),
      );
      const ready = result.ready && workerReady;
      if (ready) await cleanupOldFlowAudioCaches(caches, FLOW_AUDIO_CACHE);
      return { ...result, workerReady, ready };
    } catch {
      return audioReadiness(0, [], false, false);
    } finally {
      preparation = null;
    }
  })();
  return preparation;
}
