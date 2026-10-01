// Regression: cancel the current playback without disabling future announcements.
// Real media + default Chromium autoplay policy; only Date.now is accelerated for event boundaries.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3001";
const fixtureBundle = join(
  mkdtempSync(join(tmpdir(), "will-flow-fixture-")),
  "harness.js",
);
execFileSync(
  "npx",
  [
    "--yes",
    "esbuild",
    "scripts/fixtures/auto-flow-browser.tsx",
    "--bundle",
    "--platform=browser",
    "--format=iife",
    "--jsx=automatic",
    "--define:process.env={}",
    '--define:process.env.NODE_ENV="production"',
    `--outfile=${fixtureBundle}`,
  ],
  { stdio: "pipe" },
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const checks = [];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
await context.addInitScript(() => {
  window.__offset = 0;
  const real = Date.now;
  Date.now = () => real() + window.__offset;
  window.__media = [];
  window.__plays = [];
  window.__chimes = [];
  window.__speech = 0;
  const A = window.Audio;
  window.Audio = function (...args) {
    const a = new A(...args);
    window.__media.push(a);
    return a;
  };
  window.Audio.prototype = A.prototype;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const a = this;
    return play.call(a).then(() =>
      window.__plays.push({
        src: a.src,
        volume: a.volume,
        at: performance.now(),
      }),
    );
  };
  const create = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const o = create.call(this);
    const row = { active: false };
    const start = o.start.bind(o);
    o.start = (...args) => {
      row.active = true;
      window.__chimes.push({ at: performance.now(), row });
      return start(...args);
    };
    const stop = o.stop.bind(o);
    o.stop = (...args) => {
      if (!args.length) row.active = false;
      return stop(...args);
    };
    o.addEventListener("ended", () => (row.active = false));
    return o;
  };
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => {
    window.__speech++;
    return speak(u);
  };
});
const b = (name) => page.getByRole("button", { name, exact: true });
const openSessionSettings = async () => {
  const settings = page.locator(".flow-session-settings");
  if ((await settings.getAttribute("open")) === null)
    await settings.locator("summary").click();
};
const endFlow = async () => {
  await openSessionSettings();
  await b("自動進行を終了").click();
  await b("終了する").click();
};
const stop = () => b("今の音声を止める").click();
const clock = () => page.locator(".flow-progress__clock").innerText();
const noAudio = async () => {
  assert.equal(
    await page.evaluate(() => window.__media.filter((a) => !a.paused).length),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => window.__chimes.filter((c) => c.row.active).length,
    ),
    0,
  );
};
const playing = (src) =>
  page.waitForFunction(
    (src) =>
      window.__media.some((a) => !a.paused && a.src.endsWith(src)) &&
      window.__plays.some((p) => p.src.endsWith(src)),
    src,
  );
const actual = () =>
  page.evaluate(() => {
    const a = window.__media.findLast((a) => !a.paused);
    return { src: a.src, volume: a.volume, currentTime: a.currentTime };
  });
const boundary = async (sec) => {
  await page.evaluate((sec) => {
    const s = JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    );
    window.__offset +=
      s.startedAt + s.accumulatedPausedMs + (sec - 3) * 1000 - Date.now();
  }, sec);
  // The first catch-up tick occurs before the boundary, so the next tick is a normal foreground tick.
  await page.waitForFunction(
    (sec) => {
      const clock = document.querySelector(".flow-progress__clock strong")?.textContent;
      if (!clock) return false;
      const [h, m, s] = clock.split(":").map(Number);
      const elapsed = h * 3600 + m * 60 + s;
      return elapsed >= sec - 3 && elapsed < sec;
    },
    sec,
  );
};
try {
  await page.goto(base + "/flow");
  await b("自動進行を開始").waitFor();
  await b("設定を開く").click();
  await page.locator("#audio-volume").press("Home");
  for (let i = 0; i < 30; i++)
    await page.locator("#audio-volume").press("ArrowRight");
  await b("設定を開く").click();
  await b("自動進行を開始").click();
  await playing("00-opening.wav");
  await page.waitForTimeout(1000);
  await stop();
  await noAudio();
  assert.ok(
    await page
      .getByText("次の案内は自動で再生されます", { exact: false })
      .isVisible(),
  );
  const stoppedAt = await clock();
  await page.waitForTimeout(1100);
  assert.notEqual(await clock(), stoppedAt);
  await boundary(300);
  await playing("05-volley.wav");
  const eventEvidence = await page.evaluate(() => ({
    chimes: window.__chimes.map((c) => c.at),
    plays: window.__plays,
    session: JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    ),
  }));
  assert.equal(eventEvidence.chimes.length, 9);
  const volley = eventEvidence.plays.find((p) =>
    p.src.endsWith("05-volley.wav"),
  );
  assert.equal(volley.volume, 0.3);
  assert.ok(volley.at > eventEvidence.chimes.at(-1));
  assert.deepEqual(eventEvidence.session.firedEventIds, ["opening", "volley"]);
  assert.equal(await page.locator(".flow-audio-notice").count(), 0);
  pass(
    "CASE 1: manual stop preserves clock and next natural chime/WAV",
    eventEvidence,
  );
  await page.screenshot({
    path: "reports/flow-v5-next-event-after-stop-390.png",
  });
  await b("進行を一時停止").click();
  await noAudio();
  const frozen = await page
    .locator(
      ".flow-progress__clock,.flow-progress__numbers,.flow-progress__next",
    )
    .allInnerTexts();
  await page.waitForTimeout(10000);
  assert.deepEqual(
    await page
      .locator(
        ".flow-progress__clock,.flow-progress__numbers,.flow-progress__next",
      )
      .allInnerTexts(),
    frozen,
  );
  const playsBeforeResume = await page.evaluate(() => window.__plays.length);
  await b("進行を再開").click();
  await page.waitForTimeout(1100);
  assert.notEqual(await clock(), frozen[0]);
  await noAudio();
  assert.equal(
    await page.evaluate(() => window.__plays.length),
    playsBeforeResume,
  );
  pass(
    "CASE 2: pause freezes all progress for 10 seconds; resume starts only clock",
    frozen,
  );
  await b("もう一度聞く").click();
  await playing("05-volley.wav");
  await stop();
  await b("もう一度聞く").click();
  await playing("05-volley.wav");
  const replay = await actual();
  assert.equal(replay.volume, 0.3);
  assert.ok(replay.currentTime < 1);
  pass(
    "CASE 3: stop and replay starts current WAV from beginning at volume 0.3",
    replay,
  );
  await b("進行を一時停止").click();
  await b("もう一度聞く").click();
  await playing("05-volley.wav");
  const pausedClock = await clock();
  await page.waitForTimeout(1100);
  assert.equal(await clock(), pausedClock);
  assert.equal((await actual()).volume, 0.3);
  await stop();
  await b("進行を再開").click();
  pass("paused clock permits explicit replay without resuming progress");
  const chimesBeforeResume = await page.evaluate(() => window.__chimes.length);
  await boundary(600);
  await playing("10-long-rally.wav");
  assert.equal((await actual()).volume, 0.3);
  assert.equal(
    await page.evaluate(() => window.__chimes.length),
    chimesBeforeResume + 9,
  );
  pass(
    "CASE 2: manual stop → pause → replay → stop → resume permits future chime/WAV",
    await actual(),
  );
  await page.locator(".auto-flow .flow-overview > summary").click();
  await b("00:20 クロスラリー").click();
  await b("移動して案内").click();
  await playing("20-cross-rally-single.wav");
  assert.equal((await actual()).volume, 0.3);
  pass(
    "CASE 4: seek after stop plays the new event at volume 0.3",
    await actual(),
  );
  await stop();
  await b("00:40 乱数表の説明").click();
  await b("移動して案内").click();
  await page.waitForFunction(() => window.__chimes.some((c) => c.row.active));
  await stop();
  await page.waitForTimeout(3800);
  await noAudio();
  assert.equal(
    await page.evaluate(() =>
      window.__plays.some((p) => p.src.endsWith("40-random-table-single.wav")),
    ),
    false,
  );
  await boundary(2580);
  await playing("43-game-rules.wav");
  assert.equal((await actual()).volume, 0.3);
  pass(
    "stop cancels pending chime/WAV, but the following natural event still plays",
    await actual(),
  );
  await endFlow();
  await noAudio();
  // Exercise the actual panel with a changed playback callback at exactly the event boundary.
  await page.route("**/__flow-harness", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/__flow-harness.js"></script>',
    }),
  );
  await page.route("**/__flow-harness.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: readFileSync(fixtureBundle),
    }),
  );
  await page.goto(base + "/__flow-harness");
  await b("自動進行を開始").click();
  await playing("00-opening.wav");
  await stop();
  await boundary(300);
  await page.waitForFunction(() =>
    document
      .querySelector(".flow-progress__clock")
      ?.textContent.startsWith("00:04:59"),
  );
  await page.evaluate(() => {
    const s = JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    );
    window.__offset += s.startedAt + 300000 - Date.now();
  });
  await b("再生コールバックを更新").click();
  await playing("05-volley.wav");
  assert.equal((await actual()).volume, 0.3);
  pass(
    "callback replacement after current stop cannot silently consume the future event",
    {
      ...(await actual()),
      fired: await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"))
            .firedEventIds,
      ),
    },
  );
  assert.equal(await page.evaluate(() => window.__speech), 0);
  assert.deepEqual(errors, []);
  pass("zero SpeechSynthesis fallback and zero runtime errors");
  writeFileSync(
    "reports/flow-v5-playback-audit.json",
    JSON.stringify(
      {
        auditedAt: new Date().toISOString(),
        base,
        checks,
        errors,
        method:
          "Real Chromium with default autoplay policy, real WAV and AudioContext; Date.now offsets only for multi-minute boundaries; actual React panel fixture tests callback replacement independently of app settings",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
