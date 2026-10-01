// Real media and shared volume checks for fixed Zundamon calls and timer expiry.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3002";
const cues = JSON.parse(readFileSync("lib/flowCues.json", "utf8"));
const audit = JSON.parse(
  readFileSync("reports/flow-extras-audio-audit.json", "utf8"),
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const checks = [];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
await context.addInitScript(() => {
  window.__offset = 0;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => window.__visibility ?? "visible",
  });
  const realNow = Date.now;
  Date.now = () => realNow() + window.__offset;
  window.__media = [];
  window.__plays = [];
  window.__chimes = [];
  window.__speechCalls = 0;
  const AudioCtor = window.Audio;
  window.Audio = function (...args) {
    const audio = new AudioCtor(...args);
    window.__media.push(audio);
    return audio;
  };
  window.Audio.prototype = AudioCtor.prototype;
  const createOscillator = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const oscillator = createOscillator.call(this);
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (...args) => {
      window.__chimes.push(performance.now());
      return start(...args);
    };
    return oscillator;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const audio = this;
    return play
      .call(audio)
      .then(() =>
        window.__plays.push({ src: audio.src, volume: audio.volume }),
      );
  };
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (...args) => {
    window.__speechCalls++;
    return speak(...args);
  };
});
const b = (name) => page.getByRole("button", { name, exact: true });
const extras = page.locator(".flow-extras");
const extraButton = (name) => extras.getByRole("button", { name, exact: true });
const playing = (file) =>
  page.waitForFunction(
    (file) =>
      window.__media.some(
        (audio) =>
          audio.src.endsWith(file) && !audio.paused && audio.currentTime > 0.1,
      ),
    file,
  );
const actual = () =>
  page.evaluate(() => {
    const audio = window.__media.findLast((audio) => !audio.paused);
    return {
      src: audio.src,
      currentTime: audio.currentTime,
      duration: audio.duration,
      volume: audio.volume,
    };
  });
const setVolume = async (n) => {
  await page.locator("#audio-volume").press("Home");
  for (let i = 0; i < n; i++)
    await page.locator("#audio-volume").press("ArrowRight");
};
const stop = async () => {
  await extraButton("今の音声を止める").click();
  assert.equal(
    await page.evaluate(
      () => window.__media.filter((audio) => !audio.paused).length,
    ),
    0,
  );
};
try {
  await page.goto(base + "/flow");
  await b("設定を開く").click();
  await setVolume(30);
  await b("設定を開く").click();
  await b("個別進行").click();
  await extras.locator("summary").click();
  assert.equal(
    await extras.getByRole("region", { name: "タイマー操作" }).count(),
    1,
  );
  assert.equal(
    await extras.getByRole("region", { name: "声かけ操作" }).count(),
    1,
  );
  for (const cue of cues.filter((cue) => cue.id !== "timer-ended")) {
    await extraButton(cue.label).click();
    await playing(cue.audioSrc);
    const media = await actual();
    assert.equal(media.volume, 0.3);
    assert.ok(
      Math.abs(
        media.duration -
          audit.files.find((file) => file.id === cue.id).durationSec,
      ) < 0.01,
    );
    assert.equal(
      await page.evaluate(
        () => window.__media.filter((audio) => !audio.paused).length,
      ),
      1,
    );
    pass("CASE 4: Zundamon " + cue.label + " plays at 30%", media);
    await stop();
  }
  await extraButton("無理せず休んで").click();
  await playing("q-health.wav");
  await stop();
  await extraButton("もう一度聞く").click();
  await playing("q-health.wav");
  assert.ok((await actual()).currentTime < 1);
  await b("設定を開く").click();
  for (const n of [50, 20, 30]) {
    await setVolume(n);
    assert.equal((await actual()).volume, n / 100);
  }
  await b("設定を開く").click();
  pass(
    "cue replay starts from beginning; live 50/20/30% volume updates without interruption",
    await actual(),
  );
  await stop();
  await extraButton("タイマー開始").click();
  await extraButton("一時停止").click();
  assert.equal(await extraButton("再開").isEnabled(), true);
  const frozen = await extras.locator(".flow-extra-time").innerText();
  await page.evaluate(() => {
    window.__offset += 2000;
  });
  await page.waitForTimeout(1200);
  assert.equal(await extras.locator(".flow-extra-time").innerText(), frozen);
  await extraButton("再開").click();
  pass(
    "timer can pause immediately at 5:00 and resume from frozen remainder",
    frozen,
  );
  const before = await page.evaluate(() => window.__plays.length);
  await page.evaluate(() => {
    window.__offset += 299000;
  });
  await playing("timer-ended.wav");
  const timer = await actual();
  assert.equal(timer.volume, 0.3);
  await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(() => window.__plays.length), before + 1);
  assert.equal(await extras.locator(".flow-extra-time").innerText(), "0:00");
  pass(
    "CASE 5: timer expiry plays one Zundamon WAV at shared 30% volume",
    timer,
  );
  await stop();
  await extraButton("もう一度聞く").click();
  await playing("timer-ended.wav");
  await stop();
  pass("timer expiry announcement can be replayed and stopped");
  await extraButton("リセット").click();
  await extraButton("タイマー開始").click();
  await extraButton("交代お願いします").click();
  await playing("q-rotate.wav");
  await stop();
  assert.ok(await extras.getByText("進行中", { exact: true }).isVisible());
  await page.waitForTimeout(1200);
  assert.notEqual(await extras.locator(".flow-extra-time").innerText(), "5:00");
  pass("stop current cue leaves the timer running");
  await extraButton("リセット").click();
  const playsBeforeHidden = await page.evaluate(() => window.__plays.length);
  await extraButton("タイマー開始").click();
  await page.evaluate(() => {
    window.__visibility = "hidden";
    window.__offset += 301000;
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__visibility = "visible";
  });
  assert.equal(
    await page.evaluate(() => window.__plays.length),
    playsBeforeHidden,
  );
  assert.equal(await extras.locator(".flow-extra-time").innerText(), "0:00");
  pass(
    "expiry while the page is hidden is consumed silently, with no delayed voice on return",
  );
  await extraButton("リセット").click();
  for (const [width, height] of [
    [390, 844],
    [480, 920],
  ]) {
    await page.setViewportSize({ width, height });
    await extras.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      width: innerWidth,
      contentBottom: document
        .querySelector(".flow-scroll")
        .getBoundingClientRect().bottom,
      navTop: document.querySelector(".page-navigation").getBoundingClientRect()
        .top,
    }));
    assert.equal(layout.documentWidth, width);
    assert.ok(layout.contentBottom <= layout.navTop);
    const screenshot = `reports/flow-v5-extras-${width}.png`;
    await page.screenshot({ path: screenshot });
    pass(`${width} timer/cue blocks and bottom navigation layout`, {
      ...layout,
      screenshot,
    });
  }
  const decoded = await page.evaluate(async (cues) => {
    const audioContext = new AudioContext();
    try {
      return await Promise.all(
        cues.map(async (cue) => {
          const buffer = await audioContext.decodeAudioData(
            await (await fetch(cue.audioSrc)).arrayBuffer(),
          );
          return { id: cue.id, duration: buffer.duration };
        }),
      );
    } finally {
      await audioContext.close();
    }
  }, cues);
  for (const file of decoded)
    assert.ok(
      Math.abs(
        file.duration -
          audit.files.find((entry) => entry.id === file.id).durationSec,
      ) < 0.01,
    );
  pass("all seven new WAVs decode at the audited duration", decoded);
  // A shared cue must cancel a chime's queued auto WAV as well as active media.
  await b("自動進行").click();
  await b("自動進行を開始").click();
  await playing("00-opening.wav");
  await page.locator(".auto-flow .flow-overview > summary").click();
  await b("00:05 ボレーボレー").click();
  const chimesBefore = await page.evaluate(() => window.__chimes.length);
  await b("移動して案内").click();
  await page.waitForFunction((n) => window.__chimes.length > n, chimesBefore);
  const automaticBefore = await page.evaluate(() => window.__plays.filter((a) => a.src.endsWith("05-volley.wav")).length);
  await extraButton("初参加の方にも声かけ").click();
  await playing("q-welcome.wav");
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => window.__plays.filter((a) => a.src.endsWith("05-volley.wav")).length), automaticBefore);
  assert.equal(await page.evaluate(() => window.__media.filter((a) => !a.paused).length), 1);
  pass("shared cue during auto chime cancels only that queued WAV; no overlap or overwrite", await actual());
  await stop();
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"));
    window.__offset += session.startedAt + session.accumulatedPausedMs + 597000 - Date.now();
  });
  await page.waitForFunction(() => /00:09:5[789]/.test(document.querySelector(".flow-progress__clock strong").textContent));
  await playing("10-long-rally.wav");
  assert.equal((await actual()).volume, 0.3);
  pass("future auto chime/WAV still plays after a shared cue replaced the preceding event", await actual());
  await page.locator(".flow-session-settings > summary").click();
  await b("自動進行を終了").click();
  await b("終了する").click();
  await b("個別進行").click();
  await page.route("**/audio/flow/extras/q-gather.wav", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await extraButton("集合お願いします").click();
  await page.getByText(/案内音声を再生できませんでした/).waitFor();
  assert.equal(await page.evaluate(() => window.__speechCalls), 0);
  assert.deepEqual(errors, []);
  pass(
    "recording failure shows a notice; zero standard speech fallback or runtime errors",
  );
  writeFileSync(
    "reports/flow-v5-extras-audit.json",
    JSON.stringify(
      {
        auditedAt: new Date().toISOString(),
        base,
        method:
          "Real Chromium with default autoplay policy, native WAV play/AudioContext decode; only Date.now shifted for timer boundaries",
        checks,
        errors,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
