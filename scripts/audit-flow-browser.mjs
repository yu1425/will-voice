// Use a real browser with real media playback. Optional existing CDP browser.
// WILL_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/audit-flow-browser.mjs
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3001";
const browser = process.env.WILL_CDP_URL
  ? await chromium.connectOverCDP(process.env.WILL_CDP_URL)
  : await chromium.launch({
      headless: true,
      args: ["--autoplay-policy=no-user-gesture-required"],
    });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(() => {
  window.__clockOffset = 0;
  const real = Date.now;
  Date.now = () => real() + window.__clockOffset;
  window.__media = [];
  window.__plays = [];
  window.__speechCalls = 0;
  window.__oscillators = [];
  const AudioCtor = window.Audio;
  window.Audio = function (...args) {
    const a = new AudioCtor(...args);
    window.__media.push(a);
    return a;
  };
  window.Audio.prototype = AudioCtor.prototype;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const a = this;
    return play.call(a).then(() => {
      window.__plays.push(a.src);
    });
  };
  if (window.speechSynthesis) {
    const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => {
      window.__speechCalls++;
      return speak(u);
    };
  }
  const create = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const o = create.call(this);
    const row = { active: false };
    const start = o.start.bind(o);
    const stop = o.stop.bind(o);
    o.start = (...args) => {
      row.active = true;
      return start(...args);
    };
    o.stop = (...args) => {
      const result = stop(...args);
      if (!args.length) row.active = false;
      return result;
    };
    o.addEventListener("ended", () => (row.active = false));
    window.__oscillators.push(row);
    return o;
  };
});
const checks = [];
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
const button = (name) => page.getByRole("button", { name, exact: true });
const readProgress = () =>
  page.locator('[role="progressbar"]').getAttribute("aria-valuenow");
const activeAudio = () =>
  page.evaluate(() =>
    window.__media.filter((a) => !a.paused).map((a) => a.src),
  );
const noAudio = async () => {
  assert.deepEqual(await activeAudio(), []);
  assert.equal(
    await page.evaluate(
      () => window.__oscillators.filter((o) => o.active).length,
    ),
    0,
  );
};
const screenshot = async (name) => {
  await page.screenshot({ path: `reports/${name}.png` });
};
async function assertLayout(label) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    app: document.querySelector(".app").getBoundingClientRect().width,
    overflow: [
      ...document.querySelectorAll(
        "button,a,h1,h2,.flow-progress,.page-navigation",
      ),
    ]
      .filter((el) => el.getClientRects().length)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > innerWidth + 1 || r.left < -1;
      })
      .map((el) => el.textContent),
    smallTargets: [...document.querySelectorAll("button,.page-navigation a")]
      .filter((el) => el.getClientRects().length)
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent),
  }));
  assert.equal(layout.document, layout.width);
  assert.ok(layout.app <= 480);
  assert.deepEqual(layout.overflow, []);
  assert.deepEqual(layout.smallTargets, []);
  pass(label, layout);
}
try {
  await page.goto(base + "/flow");
  await button("自動進行を開始").waitFor();
  await assertLayout("390x844 idle layout");
  await screenshot("flow-v3-idle-390");
  await button("設定").click();
  const setVolume = async (percentage) => {
    const slider = page.locator("#audio-volume");
    await slider.press("Home");
    for (let n = 0; n < percentage; n++) await slider.press("ArrowRight");
    assert.equal(await slider.inputValue(), String(percentage));
  };
  const volumeEvidence = [];
  for (const percentage of [100, 50, 20]) {
    await setVolume(percentage);
    await button("音声テスト").click();
    await page.waitForFunction(() => window.__media.some((a) => !a.paused));
    const actual = await page.evaluate(
      () => window.__media.findLast((a) => !a.paused).volume,
    );
    assert.equal(actual, percentage / 100);
    volumeEvidence.push({ slider: percentage, actualAudioVolume: actual });
    await button("音声を止める").click();
  }
  pass("voice test actual volume 100/50/20", volumeEvidence);
  await setVolume(100);
  await button("設定").click();
  await button("2面").click();
  await button("音声テスト").click();
  await page.waitForFunction(() =>
    window.__plays.some((s) => s.endsWith("voice-test.wav")),
  );
  await button("音声を止める").click();
  await noAudio();
  pass("voice test and stop", "real play() succeeded");
  await button("試聴").click();
  await page.waitForTimeout(150);
  assert.ok(
    await page.evaluate(() => window.__oscillators.some((o) => o.active)),
  );
  await button("音声を止める").click();
  await noAudio();
  pass("existing chime preview and cancel");
  await page.getByRole("checkbox").uncheck();
  await button("自動進行を開始").click();
  await page.waitForFunction(() =>
    window.__plays.some((s) => s.endsWith("00-opening.wav")),
  );
  assert.equal(await readProgress(), "0");
  pass("start and opening audio");
  const playingIndex = await page.evaluate(() =>
    window.__media.findLastIndex((a) => !a.paused),
  );
  await button("設定").click();
  await setVolume(30);
  const activeChange = await page.evaluate(
    (index) => ({
      volume: window.__media[index].volume,
      paused: window.__media[index].paused,
      position: window.__media[index].currentTime,
    }),
    playingIndex,
  );
  assert.equal(activeChange.volume, 0.3);
  assert.equal(activeChange.paused, false);
  assert.ok(activeChange.position > 0);
  pass("active recording volume 100 to 30 without interruption", activeChange);
  await button("設定").click();
  await button("もう一度聞く").click();
  await page.waitForFunction(
    (index) => window.__media.findLastIndex((a) => !a.paused) > index,
    playingIndex,
  );
  const replay = await page.evaluate(() => {
    const a = window.__media.findLast((a) => !a.paused);
    return { volume: a.volume, position: a.currentTime, src: a.src };
  });
  assert.equal(replay.volume, 0.3);
  assert.ok(replay.position < 1);
  assert.ok(replay.src.endsWith("00-opening.wav"));
  pass("replay starts current recording from beginning at 30 percent", replay);
  await page.reload();
  await page.getByRole("progressbar").waitFor();
  await button("設定").click();
  assert.equal(await page.locator("#audio-volume").inputValue(), "30");
  await button("設定").click();
  await button("もう一度聞く").click();
  await page.waitForFunction(() => window.__media.some((a) => !a.paused));
  assert.equal(
    await page.evaluate(() => window.__media.findLast((a) => !a.paused).volume),
    0.3,
  );
  pass("reload preserves 30 percent for next recording");
  await button("音声を止める").click();
  const stoppedClock = await page.locator(".flow-progress__clock").innerText();
  await page.waitForTimeout(1200);
  assert.notEqual(
    await page.locator(".flow-progress__clock").innerText(),
    stoppedClock,
  );
  await noAudio();
  pass("audio stop keeps the session clock running");
  const aboveFold = await page.evaluate(() => {
    const navTop = document
      .querySelector(".page-navigation")
      .getBoundingClientRect().top;
    return [
      ...document.querySelectorAll(
        ".flow-progress h1,.flow-progress__next,.flow-progress__later,.flow-controls .flow-actions",
      ),
    ].map((el) => ({
      text: el.textContent,
      bottom: el.getBoundingClientRect().bottom,
      navTop,
    }));
  });
  assert.ok(aboveFold.every((r) => r.bottom < r.navTop));
  assert.equal(
    await page.locator(".auto-flow .flow-overview").getAttribute("open"),
    null,
  );
  pass(
    "current next next-after and primary controls fit above navigation",
    aboveFold,
  );

  await screenshot("flow-v3-running-390");
  await assertLayout("390x844 running layout");
  await button("進行を一時停止").click();
  const pausedClock = await page.locator(".flow-progress__clock").innerText();
  const pausedDetails = await page
    .locator(".flow-progress__numbers,.flow-progress__next")
    .allInnerTexts();
  await page.waitForTimeout(1400);
  assert.equal(
    await page.locator(".flow-progress__clock").innerText(),
    pausedClock,
  );
  assert.deepEqual(
    await page
      .locator(".flow-progress__numbers,.flow-progress__next")
      .allInnerTexts(),
    pausedDetails,
  );
  await screenshot("flow-v3-paused-390");
  await noAudio();
  pass("pause freezes progress and stops voice");
  await button("進行を再開").click();
  await page.waitForTimeout(1100);
  assert.notEqual(
    await page.locator(".flow-progress__clock").innerText(),
    pausedClock,
  );
  pass("resume restarts clock");
  await page.locator(".auto-flow .flow-overview > summary").click();
  await page
    .getByRole("button", { name: "00:30 サーブ・リターン", exact: true })
    .click();
  await button("移動して案内").click();
  await page.waitForFunction(() =>
    window.__plays.some((s) => s.endsWith("30-serve-return-double.wav")),
  );
  assert.equal(await readProgress(), "25");
  pass("seek synchronizes progress and court variant");
  await button("個別進行").click();
  await noAudio();
  assert.ok(await page.getByText("自動進行は継続中です").isVisible());
  pass("auto to manual stops voice, keeps clock");
  await button("もう一度聞く").click();
  await page.waitForFunction(() => window.__media.some((a) => !a.paused));
  assert.equal(
    await page.evaluate(() => window.__media.findLast((a) => !a.paused).volume),
    0.3,
  );
  pass("manual recording shares 30 percent volume");
  await button("音声を一時停止").click();
  assert.deepEqual(await activeAudio(), []);
  await button("音声を再開").click();
  await page.waitForFunction(() => window.__media.some((a) => !a.paused));
  await button("次へ →").click();
  await noAudio();
  pass("manual playback, pause, resume and STEP change stop");
  await screenshot("flow-v3-manual-390");
  await assertLayout("390x844 manual layout");
  await button("もう一度聞く").click();
  await button("自動進行").click();
  await noAudio();
  pass("manual to auto stops voice");
  await button("もう一度聞く").click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "使い方", exact: true })
    .click();
  await page.getByRole("heading", { name: "うぃる進行の使い方" }).waitFor();
  await noAudio();
  pass("flow to guide stops voice");
  await screenshot("flow-v3-guide-390");
  await assertLayout("390x844 guide layout");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "進行", exact: true })
    .click();
  await page.getByRole("progressbar").waitFor();
  await noAudio();
  assert.ok(Number(await readProgress()) >= 25);
  pass("guide to flow restores clock without voice");
  await button("もう一度聞く").click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "うぃるに聞く", exact: true })
    .click();
  await page.getByRole("button", { name: "送信", exact: true }).waitFor();
  await noAudio();
  pass("flow to chat stops voice");
  await screenshot("flow-v3-chat-390");
  await assertLayout("390x844 chat layout");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "進行", exact: true })
    .click();
  await page.getByRole("progressbar").waitFor();
  await button("進行を一時停止").click();
  await page.reload();
  await button("進行を再開").waitFor();
  assert.equal(await readProgress(), "25");
  await noAudio();
  const restored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow")),
  );
  assert.equal(restored.courts, 2);
  assert.equal(restored.status, "paused");
  pass("paused reload restores state and courts");
  await button("進行を再開").click();
  // Simulate closed period: reload starts at 35m, with 20m/30m not marked as fired.
  await page.evaluate(() => {
    const s = JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    );
    s.startedAt = Date.now() - 2100000;
    s.accumulatedPausedMs = 0;
    s.status = "running";
    s.pausedAt = null;
    s.firedEventIds = ["opening"];
    localStorage.setItem("will-standard-two-hour-auto-flow", JSON.stringify(s));
  });
  await page.reload();
  await page.getByRole("progressbar").waitFor();
  assert.ok(
    await page
      .getByRole("heading", { name: "サーブ・リターン交代", exact: true })
      .isVisible(),
  );
  await page.waitForTimeout(1100);
  await noAudio();
  assert.equal(await page.evaluate(() => window.__plays.length), 0);
  pass("35m reload consumes missed events without burst");
  for (const [minutes, percentage, clock] of [
    [30, 25, "00:30:"],
    [60, 50, "01:00:"],
    [90, 75, "01:30:"],
    [120, 100, "02:00:00"],
  ]) {
    await page.evaluate((minutes) => {
      const s = JSON.parse(
        localStorage.getItem("will-standard-two-hour-auto-flow"),
      );
      Object.assign(s, {
        startedAt: Date.now() - minutes * 60000,
        accumulatedPausedMs: 0,
        status: "running",
        pausedAt: null,
      });
      localStorage.setItem(
        "will-standard-two-hour-auto-flow",
        JSON.stringify(s),
      );
    }, minutes);
    await page.reload();
    await page.getByRole("progressbar").waitFor();
    assert.equal(await readProgress(), String(percentage));
    assert.ok(
      (await page.locator(".flow-progress__clock").innerText()).startsWith(
        clock,
      ),
    );
    assert.ok(
      (await page.locator(".flow-progress__numbers").innerText()).includes(
        minutes === 120
          ? "00:00:00"
          : minutes === 90
            ? "00:30:"
            : minutes === 60
              ? "01:00:"
              : "01:30:",
      ),
    );
    await noAudio();
    pass(`${minutes}m progress ${percentage}% and remaining`);
  }
  assert.ok(await button("もう一度聞く").isDisabled());
  assert.ok(await button("進行を一時停止").isDisabled());
  pass("120m completes silently, controls remain disabled");
  await screenshot("flow-v3-completed-390");
  await button("開始前の画面に戻る").click();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    ),
    null,
  );
  pass("end clears session");
  // Natural boundaries, rather than seeking: jump near boundary, then wait real seconds.
  await button("自動進行を開始").click();
  await button("音声を止める").click();
  const definitions = JSON.parse(readFileSync("lib/flowScripts.json", "utf8"));
  for (const e of definitions.slice(1)) {
    await page.evaluate((sec) => {
      const s = JSON.parse(
        localStorage.getItem("will-standard-two-hour-auto-flow"),
      );
      window.__clockOffset +=
        s.startedAt + s.accumulatedPausedMs + (sec - 1) * 1000 - Date.now();
    }, e.offsetSec);
    await page.waitForTimeout(1250);
    await page.waitForTimeout(1100);
    await page.waitForFunction(
      (id) =>
        JSON.parse(
          localStorage.getItem("will-standard-two-hour-auto-flow"),
        ).firedEventIds.includes(id),
      e.id,
    );
    const path =
      e.variants.find((v) => v.courtMode === "double")?.audioSrc ??
      e.variants[0].audioSrc;
    await page.waitForFunction(
      (path) => window.__plays.some((src) => src.endsWith(path)),
      path,
    );
    pass("natural event " + e.id, e.offsetSec);
    await button("音声を止める").click();
  }
  const fired = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"))
        .firedEventIds,
  );
  assert.deepEqual(
    fired,
    definitions.map((e) => e.id),
  );
  pass("natural event order, including game preparation");
  await button("自動進行を終了").click();
  // Chime -> delayed voice: cancel during bell and ensure no later start.
  await page.getByRole("checkbox").check();
  await button("自動進行を開始").click();
  await button("音声を止める").click();
  await page.locator(".auto-flow .flow-overview > summary").click();
  await page
    .getByRole("button", { name: "00:20 クロスラリー", exact: true })
    .click();
  await button("移動して案内").click();
  await page.waitForTimeout(100);
  await button("個別進行").click();
  await page.waitForTimeout(3700);
  await noAudio();
  pass("mode switch cancels chime and delayed announcement");
  await button("自動進行").click();
  await button("自動進行を終了").click();
  // Recorded errors must not invoke browser speech.
  await page.route("**/audio/flow/v2/00-opening.wav", (r) =>
    r.fulfill({ status: 404, body: "missing" }),
  );
  const speechBefore = await page.evaluate(() => window.__speechCalls);
  await button("自動進行を開始").click();
  await page
    .getByRole("alert")
    .filter({ hasText: "案内音声を再生できませんでした" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__speechCalls), speechBefore);
  pass("recording error has zero SpeechSynthesis fallback");
  await page.unroute("**/audio/flow/v2/00-opening.wav");
  await button("自動進行を終了").click();
  // Decode and play all 16 real files in browser, including unused alternate court variants.
  const audioAudit = JSON.parse(
    readFileSync("reports/flow-audio-v2-audit.json", "utf8"),
  );
  const mediaChecks = await page.evaluate(async (files) => {
    const ctx = new AudioContext();
    const results = [];
    for (const f of files) {
      const res = await fetch(f.audioSrc);
      const data = await res.arrayBuffer();
      const decoded = await ctx.decodeAudioData(data);
      const audio = new Audio(f.audioSrc);
      await audio.play();
      audio.pause();
      results.push({
        file: f.audioSrc,
        status: res.status,
        duration: decoded.duration,
        play: true,
      });
    }
    await ctx.close();
    return results;
  }, audioAudit.files);
  assert.ok(
    mediaChecks.every(
      (m) => m.status === 200 && m.duration > 3 && m.duration < 90 && m.play,
    ),
  );
  pass("all 16 WAVs decode and play", mediaChecks);
  await page.setViewportSize({ width: 480, height: 920 });
  await assertLayout("480x920 idle layout");
  await screenshot("flow-v3-idle-480");
  await button("自動進行を開始").click();
  await assertLayout("480x920 running layout");
  await screenshot("flow-v3-running-480");
  await button("個別進行").click();
  await assertLayout("480x920 manual layout");
  await screenshot("flow-v3-manual-480");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "使い方", exact: true })
    .click();
  await page.getByRole("heading", { name: "うぃる進行の使い方" }).waitFor();
  await assertLayout("480x920 guide layout");
  await screenshot("flow-v3-guide-480");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "うぃるに聞く", exact: true })
    .click();
  await page.getByRole("button", { name: "送信", exact: true }).waitFor();
  await assertLayout("480x920 chat layout");
  await screenshot("flow-v3-chat-480");
  assert.deepEqual(errors, []);
  pass("no browser runtime errors");
  mkdirSync("reports", { recursive: true });
  writeFileSync(
    "reports/flow-v3-browser-audit.json",
    JSON.stringify(
      {
        auditedAt: new Date().toISOString(),
        base,
        checks,
        mediaChecks,
        errors,
        method:
          "Real Chromium, real WAV play/decode; Date.now offsets used only to cross long event boundaries",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
