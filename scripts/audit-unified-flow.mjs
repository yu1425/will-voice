import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL;
if (!base) throw new Error("Set WILL_AUDIT_URL to an isolated test deployment");
const output = process.env.WILL_AUDIT_OUTPUT ?? "reports/unified-flow";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.WILL_CHROME_PATH,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
await context.addInitScript(() => {
  const realNow = Date.now;
  window.__offset = 0;
  Date.now = () => realNow() + window.__offset;
  window.__media = [];
  window.__plays = [];
  window.__osc = [];
  window.__synth = 0;
  const NativeAudio = window.Audio;
  window.Audio = function (...args) {
    const audio = new NativeAudio(...args);
    window.__media.push(audio);
    return audio;
  };
  window.Audio.prototype = NativeAudio.prototype;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const audio = this;
    return play.call(audio).then(() => {
      window.__plays.push({
        src: audio.src,
        volume: audio.volume,
        position: audio.currentTime,
        time: Date.now(),
      });
    });
  };
  if (window.speechSynthesis) {
    const native = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (utterance) => {
      window.__synth++;
      native(utterance);
    };
  }
  if (window.AudioContext) {
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const osc = create.call(this),
        entry = { active: false };
      const start = osc.start.bind(osc),
        stop = osc.stop.bind(osc);
      osc.start = (...args) => {
        entry.active = true;
        return start(...args);
      };
      osc.stop = (...args) => {
        if (!args.length) entry.active = false;
        return stop(...args);
      };
      osc.addEventListener("ended", () => {
        entry.active = false;
      });
      window.__osc.push(entry);
      return osc;
    };
  }
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const pass = (name, evidence = null) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
const button = (name) => page.getByRole("button", { name, exact: true });
const auto = () => page.locator('section[aria-label="自動進行"]');
const manual = () => page.locator('section[aria-label="個別の案内"]');
const stored = () =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow")),
  );
const waitVoice = async (suffix) => {
  await page.waitForFunction(
    (suffix) =>
      window.__media.some(
        (a) =>
          !a.paused &&
          a.readyState >= 3 &&
          !a.seeking &&
          a.src.endsWith(suffix),
      ),
    suffix,
  );
  return page.evaluate(() => {
    const a = window.__media.findLast((a) => !a.paused);
    return {
      src: a.src,
      position: a.currentTime,
      volume: a.volume,
      index: window.__media.indexOf(a),
    };
  });
};
const silence = async () => {
  assert.deepEqual(
    await page.evaluate(() =>
      window.__media.filter((a) => !a.paused).map((a) => a.src),
    ),
    [],
  );
  assert.equal(
    await page.evaluate(() => window.__osc.filter((o) => o.active).length),
    0,
  );
};
const menu = async () => {
  const trigger = button("メニューを開く");
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.tap();
  await page.locator(".page-menu-panel").waitFor();
};
const settings = async () => {
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("button", { name: "この機能の設定", exact: true })
    .tap();
  await page.getByRole("dialog", { name: "設定" }).waitFor();
};
const setVolume = async (value) => {
  const slider = page.locator("#audio-volume");
  await slider.fill(String(value));
  await slider.dispatchEvent("input");
  await slider.dispatchEvent("change");
};
const seek = async (label) => {
  const overview = auto().locator(".flow-overview");
  if (!(await overview.evaluate((el) => el.open)))
    await overview.locator("summary").tap();
  await overview.locator(`button[aria-label$="${label}"]`).tap();
};
const layout = async (name) => {
  const data = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    app: document.querySelector(".app").getBoundingClientRect().width,
    overflow: [...document.querySelectorAll("button,a,h1,.flow-surface")]
      .filter((el) => el.getClientRects().length)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1;
      })
      .map((el) => el.textContent),
    unframed: [
      ...document.querySelectorAll(
        ".flow-overview,.flow-extras,.flow-session-settings",
      ),
    ]
      .filter((el) => el.getClientRects().length)
      .map((el) => ({
        background: getComputedStyle(el).backgroundColor,
        border: getComputedStyle(el).borderTopWidth,
      })),
  }));
  assert.equal(data.document, data.viewport);
  assert.ok(data.app <= 480);
  assert.deepEqual(data.overflow, []);
  assert.ok(
    data.unframed.every(
      (el) => el.background === "rgb(255, 255, 255)" && el.border === "1px",
    ),
  );
  await page.screenshot({ path: join(output, name + ".png") });
  pass(name, data);
};
try {
  await page.goto(base + "/");
  await page.getByRole("heading", { name: "うぃる", exact: true }).waitFor();
  assert.ok(
    await page.getByRole("link", { name: /進行アシスタント/ }).isVisible(),
  );
  assert.ok(await page.getByRole("link", { name: /うぃるに聞く/ }).isVisible());
  assert.ok(await page.getByRole("link", { name: /設定/ }).isVisible());
  assert.ok(await page.getByRole("link", { name: /使い方/ }).isVisible());
  pass("HOME is the parent character hub for flow, chat, settings and guide");
  await page.goto(base + "/flow");
  await button("自動進行を開始").waitFor();
  assert.equal(await page.locator(".page-navigation").count(), 0);
  assert.equal(await button("もう一度聞く").count(), 0);
  assert.equal(await button("今の音声を止める").count(), 0);
  assert.equal(await page.locator(".flow-extras:visible").count(), 0);
  const positions = await page.evaluate(() => ({
    setup: document.querySelector(".flow-setup").getBoundingClientRect().bottom,
    start: [...document.querySelectorAll("button")]
      .find((b) => b.textContent.includes("自動進行を開始"))
      .getBoundingClientRect().top,
  }));
  assert.ok(positions.setup < positions.start);
  pass(
    "automatic mode has no detached audio controls or practice timer; setup precedes start",
    positions,
  );
  await layout("idle-390");
  await menu();
  const names = await page
    .locator(".page-menu-panel a,.page-menu-panel button")
    .allTextContents();
  assert.deepEqual(
    names.map((x) => x.replace(/[⌂▷◇⚙?]/g, "").trim()),
    ["ホーム", "進行", "うぃるに聞く", "この機能の設定", "使い方"],
  );
  await layout("menu-390");
  await page.keyboard.press("Escape");
  assert.equal(
    await button("メニューを開く").getAttribute("aria-expanded"),
    "false",
  );
  pass("touch menu order and Escape");
  const autoOverview = auto().locator(".flow-overview");
  await autoOverview.locator("summary").tap();
  const compactGrid = await autoOverview
    .locator(".flow-menu-grid")
    .evaluate((el) => ({
      count: el.children.length,
      columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
      height: el.getBoundingClientRect().height,
    }));
  assert.deepEqual([compactGrid.count, compactGrid.columns], [12, 3]);
  assert.ok(compactGrid.height < 360);
  pass("automatic progress menu is compact 3x4", compactGrid);
  await button("2面").tap();
  await button("自動進行を開始").tap();
  await waitVoice("00-opening.wav");
  await page.waitForTimeout(1300);
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  const paused = await stored();
  assert.equal(paused.status, "paused");
  assert.ok(paused.pendingCue.positionSec > 1);
  const time = await page.locator(".flow-progress__clock").innerText();
  await silence();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator(".flow-progress__clock").innerText(), time);
  pass(
    "one pause freezes clock and saves native WAV position",
    paused.pendingCue,
  );
  await layout("paused-390");
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  const replay = await waitVoice("00-opening.wav");
  assert.ok(
    replay.position >= paused.pendingCue.positionSec - 0.1,
    JSON.stringify({ replay, pending: paused.pendingCue }),
  );
  assert.ok(replay.position < paused.pendingCue.positionSec + 1);
  pass("one resume restarts both clock and interrupted native WAV", replay);
  await settings();
  for (const value of [100, 50, 20, 30]) {
    await setVolume(value);
    assert.equal(
      await page.evaluate(
        () => window.__media.findLast((a) => !a.paused).volume,
      ),
      value / 100,
    );
    assert.equal((await stored()).status, "running");
  }
  await layout("settings-390");
  await button("設定を閉じる").tap();
  pass("settings menu and 100/50/20/30 volume do not interrupt active session");
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  await seek("00:20 クロスラリー");
  await silence();
  assert.equal((await stored()).status, "paused");
  assert.equal((await stored()).pendingCue.eventId, "cross-rally");
  assert.ok(
    (await page.locator(".flow-progress__clock").innerText()).startsWith(
      "00:20:00",
    ),
  );
  pass("paused navigation moves only; no unsolicited audio");
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await page.waitForFunction(() => window.__osc.some((o) => o.active));
  await page.waitForTimeout(200);
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  await silence();
  await page.waitForTimeout(3800);
  await silence();
  assert.equal((await stored()).pendingCue.chime, true);
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  const cross = await waitVoice("20-cross-rally-double.wav");
  assert.equal(cross.volume, 0.3);
  pass(
    "pause during chime cancels pending voice; resume plays complete chime and selected two-court cue",
    cross,
  );
  await layout("running-390");
  await seek("00:10 ロングラリー");
  await page.waitForTimeout(100);
  await seek("00:30 サーブ・リターン");
  await waitVoice("30-serve-return-double.wav");
  assert.equal(
    await page.evaluate(() => window.__media.filter((a) => !a.paused).length),
    1,
  );
  pass(
    "running seek cancels obsolete pending cue and plays only selected item",
  );
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  await seek("00:00 開始・ショートラリー");
  assert.deepEqual((await stored()).firedEventIds, ["opening"]);
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await waitVoice("00-opening.wav");
  // Move to just before the next boundary using only the clock; no seek callback triggers its voice.
  await page.evaluate(() => {
    const s = JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    );
    window.__offset +=
      s.startedAt + s.accumulatedPausedMs + 299000 - Date.now();
  });
  await waitVoice("05-volley.wav");
  assert.equal((await stored()).status, "running");
  assert.equal(
    await page.evaluate(() => window.__media.findLast((a) => !a.paused).volume),
    0.3,
  );
  pass(
    "natural future boundary still plays after pause, resume and backward navigation",
  );
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "使い方", exact: false })
    .tap();
  await page
    .getByRole("heading", { name: "うぃる進行の使い方", exact: true })
    .waitFor();
  assert.equal((await stored()).status, "paused");
  await silence();
  await layout("guide-390");
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "進行", exact: false })
    .tap();
  await auto().getByRole("button", { name: "再開", exact: true }).waitFor();
  await silence();
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await waitVoice("05-volley.wav");
  pass(
    "actual route changes pause complete session; return requires explicit resume",
  );
  await button("個別進行").tap();
  await silence();
  assert.equal((await stored()).status, "paused");
  assert.equal(await auto().isVisible(), false);
  await button("この案内を再生").tap();
  await waitVoice("00-opening.wav");
  await page.waitForTimeout(1200);
  await manual().getByRole("button", { name: "一時停止", exact: true }).tap();
  await silence();
  await button("続きから再生").tap();
  const resumedManual = await waitVoice("00-opening.wav");
  assert.ok(resumedManual.position > 1);
  await button("次の項目へ").tap();
  await silence();
  await button("この案内を再生").tap();
  await waitVoice("05-volley.wav");
  await manual().getByRole("button", { name: "一時停止", exact: true }).tap();
  pass(
    "manual mode is select + one play/pause control; selection cancels prior playback",
    resumedManual,
  );
  await layout("manual-390");
  const extras = page.locator(".flow-extras");
  await extras.locator("summary").tap();
  await button("交代お願いします").tap();
  const cue = await waitVoice("q-rotate.wav");
  assert.equal(cue.volume, 0.3);
  await button("交代お願いします").tap();
  await silence();
  await button("タイマー開始").tap();
  await page.evaluate(() => {
    window.__offset += 300000;
  });
  await waitVoice("timer-ended.wav");
  pass(
    "manual cues toggle on same button; timer ends with Zundamon at shared volume",
  );
  await layout("extras-390");
  await button("自動進行").tap();
  await silence();
  assert.equal(await page.locator(".flow-extras:visible").count(), 0);
  await page.reload();
  await auto().getByRole("button", { name: "再開", exact: true }).waitFor();
  await silence();
  pass("reload is paused and quiet, with no announcement burst");
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await page.evaluate(() => {
    window.__offset += 7200000;
  });
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"))
        ?.status === "completed",
  );
  await silence();
  assert.equal((await stored()).status, "completed");
  assert.equal(
    await page.getByRole("progressbar").getAttribute("aria-valuenow"),
    "100",
  );
  await button("開始画面へ").tap();
  assert.equal(await stored(), null);
  pass("complete and reset stop everything and clear saved session");
  await button("自動進行を開始").tap();
  await waitVoice("00-opening.wav");
  await button("終了").tap();
  await button("終了する").tap();
  await silence();
  assert.equal(await stored(), null);
  pass("session end confirmation clears clock and media together");
  // Error must pause, not create a silently running automatic session.
  await page.route("**/audio/flow/v2/00-opening.wav", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await button("自動進行を開始").tap();
  await page
    .getByRole("alert")
    .filter({ hasText: "案内を再生できませんでした" })
    .waitFor();
  assert.equal((await stored()).status, "paused");
  assert.equal((await stored()).pendingCue.eventId, "opening");
  assert.equal(await page.evaluate(() => window.__synth), 0);
  await page.unroute("**/audio/flow/v2/00-opening.wav");
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await waitVoice("00-opening.wav");
  pass(
    "failed audio pauses session; explicit resume retries with zero browser voice fallback",
  );
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  for (const [width, height] of [
    [480, 920],
    [320, 800],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width, height });
    await layout(`paused-${width}`);
  }
  await page.setViewportSize({ width: 480, height: 920 });
  await button("個別進行").tap();
  await layout("manual-480");
  assert.deepEqual(errors, []);
  pass("no browser runtime errors", errors);
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "うぃるに聞く", exact: false })
    .tap();
  await button("送信").waitFor();
  await silence();
  await layout("chat-480");
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "進行", exact: false })
    .tap();
  await auto().getByRole("button", { name: "再開", exact: true }).waitFor();
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await waitVoice("00-opening.wav");
  await page.waitForTimeout(1100);
  await page.goBack();
  await button("送信").waitFor();
  const historyPause = await stored();
  assert.equal(historyPause.status, "paused");
  assert.ok(historyPause.pendingCue.positionSec > 1);
  await silence();
  await page.goForward();
  await auto().getByRole("button", { name: "再開", exact: true }).waitFor();
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  const historyResume = await waitVoice("00-opening.wav");
  assert.ok(
    historyResume.position >= historyPause.pendingCue.positionSec - 0.1,
  );
  pass(
    "browser Back/Forward captures and resumes playhead even without header-link callback",
    historyResume,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal((await stored()).status, "paused");
  await silence();
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1200);
  assert.equal((await stored()).status, "paused");
  pass(
    "simulated visibility event pauses whole session; foreground does not silently restart",
  );
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await waitVoice("00-opening.wav");
  await page.evaluate(() => {
    const a = window.__media.findLast((a) => !a.paused);
    a.currentTime = a.duration - 0.15;
  });
  await page.waitForFunction(() => window.__media.every((a) => a.paused));
  const finishedPlays = await page.evaluate(() => window.__plays.length);
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__plays.length), finishedPlays);
  pass("already-completed announcement is not repeated on normal flow resume");
  await auto().getByRole("button", { name: "一時停止", exact: true }).tap();
  assert.deepEqual(errors, []);

  // Separate desktop pointer and keyboard tests; do not manipulate a user's existing browser.
  const desktop = await browser.newContext({
    viewport: { width: 900, height: 900 },
  });
  const desk = await desktop.newPage();
  await desk.goto(base + "/flow");
  await desk
    .getByRole("button", { name: "メニューを開く", exact: true })
    .hover();
  await desk.locator(".page-menu-panel").waitFor();
  await desk
    .locator(".page-menu-panel")
    .getByRole("link", { name: "使い方", exact: false })
    .hover();
  assert.equal(await desk.locator(".page-menu-panel").isVisible(), true);
  await desk.keyboard.press("Escape");
  assert.equal(
    await desk.locator(".page-menu-trigger").getAttribute("aria-expanded"),
    "false",
  );
  await desk.keyboard.press("Enter");
  await desk.locator(".page-menu-panel").waitFor();
  await desk.keyboard.press("Tab");
  assert.equal(
    await desk.evaluate(() => document.activeElement.getAttribute("href")),
    "/",
  );
  await desk.keyboard.press("Escape");
  pass(
    "desktop hover enters menu, keyboard opens, tabs links and Escape closes",
  );
  await desktop.close();
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  writeFileSync(
    join(output, "failure.json"),
    JSON.stringify({ checks, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  writeFileSync(
    join(output, "audit.json"),
    JSON.stringify(
      {
        base,
        auditedAt: new Date().toISOString(),
        checks,
        errors,
        physicalDeviceChecks: false,
      },
      null,
      2,
    ) + "\n",
  );
  await context.close();
  await browser.close();
}
