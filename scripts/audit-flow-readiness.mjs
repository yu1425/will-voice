import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const playwright = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const engine = process.env.WILL_BROWSER_ENGINE ?? "chromium";
const base = process.env.WILL_AUDIT_URL;
if (!base) throw new Error("Set WILL_AUDIT_URL to an isolated test deployment");
const output = process.env.WILL_AUDIT_OUTPUT ?? "/tmp/will-readiness-audit";
mkdirSync(output, { recursive: true });
const browser = await playwright[engine].launch({
  headless: true,
  executablePath: process.env.WILL_BROWSER_PATH ?? process.env.WILL_CHROME_PATH,
});
const checks = [];
const errors = [];
const check = (name, evidence) => {
  checks.push({ name, evidence, pass: true });
  console.log(`PASS ${name}`);
};
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
const button = (name) => page.getByRole("button", { name, exact: true });
async function settings() {
  await button("メニューを開く").tap();
  await page
    .locator(".page-menu-panel")
    .getByRole("button", { name: "設定", exact: true })
    .tap();
}
async function ready() {
  const panel = page.locator(".flow-readiness");
  await panel.locator("summary").tap();
  await button("音声を準備").tap();
  await panel.getByText("音声準備完了", { exact: true }).waitFor();
}
try {
  await page.addInitScript(() => {
    window.__media = [];
    const NativeAudio = window.Audio;
    window.Audio = function (...args) {
      const audio = new NativeAudio(...args);
      window.__media.push(audio);
      return audio;
    };
    window.Audio.prototype = NativeAudio.prototype;
  });
  await page.goto(base + "/flow");
  await button("自動進行を開始").waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Seed all but one WAV, then disconnect: an actual cache miss must keep start idle.
  await page.evaluate(async () => {
    const manifest = await (await fetch("/flow-audio-manifest")).json();
    const cache = await caches.open(manifest.cacheName);
    for (const src of manifest.urls) {
      if (src.endsWith("43-game-rules.wav")) continue;
      await cache.put(src, await fetch(src));
    }
  });
  await context.setOffline(true);
  await button("自動進行を開始").tap();
  await button("オンラインのまま開始").waitFor();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    ),
    null,
  );
  await page.locator(".flow-readiness summary").tap();
  await page
    .getByText(
      "固定案内音声が準備されていません。通信接続後に音声を準備してください。",
      { exact: true },
    )
    .waitFor();
  check(
    "automatic preparation failure stays idle with explicit retry/online choices",
  );
  await button("オンラインのまま開始").tap();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    ),
    null,
  );
  await context.setOffline(false);
  await button("再試行").tap();
  await button("一時停止").waitFor();
  await page.waitForFunction(() =>
    window.__media.some(
      (audio) =>
        audio.src.endsWith("00-opening.wav") &&
        !audio.paused &&
        audio.readyState >= 3,
    ),
  );
  await button("終了").tap();
  await button("終了する").tap();
  const manifest = await page.evaluate(async () =>
    (await fetch("/flow-audio-manifest")).json(),
  );
  assert.equal(
    await page.evaluate(
      async (manifest) =>
        (await (await caches.open(manifest.cacheName)).keys()).length,
      manifest,
    ),
    16,
  );
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-flow-run-history")),
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].completedNormally, false);
  await page.locator(".flow-history > summary").tap();
  await page.getByText("1面 · 途中終了", { exact: true }).waitFor();
  await button("履歴を消去").tap();
  await button("消去する").tap();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("will-flow-run-history")).length,
    ),
    0,
  );
  check(
    "retry downloads missing audio, starts real WAV, and end saves exactly one local run; history clear works",
  );

  // Mock availability and failures only; never send paid TTS requests.
  await page.route("**/api/openai/tts", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: { configured: true, model: "test", voice: "test" },
        })
      : route.fulfill({
          status: 503,
          json: { error: "simulated unavailable" },
        }),
  );
  await page.reload();
  await button("自動進行を開始").waitFor();
  await settings();
  await page.getByRole("radio", { name: "AI音声", exact: true }).tap();
  await button("設定を閉じる").tap();
  let ttsPosts = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/openai/tts") &&
      request.method() === "POST"
    )
      ttsPosts++;
  });
  await context.setOffline(true);
  await button("自動進行を開始").tap();
  await page.waitForFunction(() =>
    window.__media.some(
      (audio) =>
        audio.src.endsWith("00-opening.wav") &&
        !audio.paused &&
        audio.readyState >= 3,
    ),
  );
  assert.equal(ttsPosts, 0);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("will-voice-mode")),
    "openai",
  );
  check(
    "AI preference offline uses cached fixed WAV without API requests or saved preference changes",
  );
  await context.setOffline(false);
  await button("終了").tap();
  await button("終了する").tap();
  await button("自動進行を開始").tap();
  await page.waitForFunction(() =>
    window.__media.some(
      (audio) =>
        audio.src.endsWith("00-opening.wav") &&
        !audio.paused &&
        audio.readyState >= 3,
    ),
  );
  assert.equal(ttsPosts, 1);
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"))
          .status,
    ),
    "running",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("will-voice-mode")),
    "openai",
  );
  check(
    "online AI generation failure falls back to fixed WAV and preserves preference",
  );
  await button("終了").tap();
  await button("終了する").tap();
  await page.unroute("**/api/openai/tts");
  await page.route("**/api/openai/tts", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { configured: true, model: "test", voice: "test" },
      });
    // Hold generation until the application aborts at its bounded timeout.
    await new Promise((resolve) => setTimeout(resolve, 13500));
    await route.abort().catch(() => {});
  });
  await button("自動進行を開始").tap();
  await page.waitForFunction(
    () =>
      window.__media.some(
        (audio) =>
          audio.src.endsWith("00-opening.wav") &&
          !audio.paused &&
          audio.readyState >= 3,
      ),
    { timeout: 16000 },
  );
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"))
          .status,
    ),
    "running",
  );
  check("stalled AI request falls back to fixed WAV within 12 seconds");
  await button("終了").tap();
  await button("終了する").tap();
  await settings();
  await page.getByRole("radio", { name: "録音音声", exact: true }).tap();
  await button("設定を閉じる").tap();
  await button("自動進行を開始").tap();
  await button("一時停止").waitFor();
  const completionId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("will-flow-active-run")).id,
  );
  await page
    .locator('.flow-menu-grid button[aria-label$="01:57 終了あいさつ・片付け"]')
    .tap();
  await page.getByRole("button", { name: "進行完了へ移動", exact: true }).tap();
  await button("開始画面へ").waitFor();
  assert.equal(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("will-flow-run-history")).filter(
          (run) => run.id === id && run.completedNormally,
        ).length,
      completionId,
    ),
    1,
  );
  await page.reload();
  await button("開始画面へ").waitFor();
  assert.equal(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("will-flow-run-history")).filter(
          (run) => run.id === id,
        ).length,
      completionId,
    ),
    1,
  );
  await button("開始画面へ").tap();
  check("seeking to 02:00 completes and saves one run, including after reload");
  assert.deepEqual(errors, []);

  const unsupported = await browser.newContext({
    viewport: { width: 320, height: 800 },
    hasTouch: true,
  });
  await unsupported.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "caches", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
      configurable: true,
    });
  });
  const limited = await unsupported.newPage();
  limited.on("pageerror", (error) => errors.push(error.message));
  await limited.goto(base + "/flow");
  await limited
    .getByRole("button", { name: "自動進行を開始", exact: true })
    .tap();
  await limited
    .getByRole("button", { name: "オンラインのまま開始", exact: true })
    .tap();
  await limited
    .getByRole("button", { name: "一時停止", exact: true })
    .waitFor();
  await limited.getByRole("button", { name: "終了", exact: true }).tap();
  await limited.getByRole("button", { name: "終了する", exact: true }).tap();
  await limited.locator(".flow-history > summary").tap();
  await limited.getByText("1面 · 途中終了", { exact: true }).waitFor();
  assert.equal(
    await limited.evaluate(() => document.documentElement.scrollWidth),
    320,
  );
  assert.deepEqual(errors, []);
  check(
    "unavailable worker/cache and denied localStorage degrade to explicit online start with in-memory history and no crash",
  );
  await unsupported.close();
} catch (error) {
  await page
    .screenshot({ path: join(output, `${engine}-failure.png`) })
    .catch(() => {});
  throw error;
} finally {
  writeFileSync(
    join(output, `${engine}.json`),
    JSON.stringify(
      { engine, base, checks, errors, physicalDeviceChecks: false },
      null,
      2,
    ) + "\n",
  );
  await context.close();
  await browser.close();
}
