import { buildStandardTwoHourEvents } from "./standardTwoHourFlow";
import { FLOW_VOICE_TEST } from "./flowScripts";

// Bump when fixed audio contents/URLs change. The worker reads this via the manifest.
export const FLOW_AUDIO_CACHE = "will-voice-flow-audio-v1";
export const FLOW_AUDIO_MANIFEST = "/flow-audio-manifest";
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
let registration: Promise<boolean> | null = null;
export function registerFlowAudioWorker(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    !navigator.serviceWorker?.register ||
    !globalThis.isSecureContext
  )
    return Promise.resolve(false);
  if (registration) return registration;
  registration = new Promise<boolean>((resolve) => {
    const container = navigator.serviceWorker;
    const controlled = () =>
      container.controller?.scriptURL === new URL("/sw.js", location.href).href;
    const finish = (ok: boolean) => {
      clearTimeout(timeout);
      container.removeEventListener("controllerchange", changed);
      resolve(ok);
    };
    const changed = () => {
      if (controlled()) finish(true);
    };
    const timeout = setTimeout(() => finish(false), 10000);
    container.addEventListener("controllerchange", changed);
    container
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => {
        if (controlled()) finish(true);
      })
      .catch(() => finish(false));
  }).then((ok) => {
    if (!ok) registration = null;
    return ok;
  });
  return registration;
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
    const workerReady =
      navigator.serviceWorker?.controller?.scriptURL ===
      new URL("/sw.js", location.href).href;
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
      return { ...result, workerReady, ready: result.ready && workerReady };
    } catch {
      return audioReadiness(0, [], false, false);
    } finally {
      preparation = null;
    }
  })();
  return preparation;
}
