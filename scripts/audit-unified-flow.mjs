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
  window.__rejectNextMediaPlay = false;
  window.__rejectMediaPlays = 0;
  window.__wake = { requests: 0, releases: 0, sentinels: [] };
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async () => {
        window.__wake.requests++;
        const listeners = [];
        const sentinel = {
          released: false,
          addEventListener(type, listener) {
            if (type === "release") listeners.push(listener);
          },
          async release() {
            if (this.released) return;
            this.released = true;
            window.__wake.releases++;
            for (const listener of listeners) listener();
          },
        };
        window.__wake.sentinels.push(sentinel);
        return sentinel;
      },
    },
  });
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
    if (
      audio.src.includes("/audio/flow/v2/") &&
      (window.__rejectNextMediaPlay || window.__rejectMediaPlays > 0)
    ) {
      window.__rejectNextMediaPlay = false;
      window.__rejectMediaPlays = Math.max(0, window.__rejectMediaPlays - 1);
      return Promise.reject(
        new DOMException("simulated transient media failure", "AbortError"),
      );
    }
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
    .getByRole("button", { name: "設定", exact: true })
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
    app: [...document.querySelectorAll(".app")].find(
      (el) => el.getClientRects().length,
    )?.getBoundingClientRect().width ?? 0,
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
  assert.ok(await page.locator('a[href="/chat"]').isVisible());
  assert.ok(await page.getByRole("link", { name: /設定/ }).isVisible());
  assert.ok(await page.getByRole("link", { name: /使い方/ }).isVisible());
  assert.equal(await page.getByText("ABOUT WILL", { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("heading", { name: "うぃるについて", exact: true })
      .count(),
    0,
  );
  assert.ok(
    await page
      .getByText("WILL.tennis🎾 公式キャラクター", { exact: true })
      .isVisible(),
  );
  pass(
    "HOME is the parent character hub with concise character copy and no separate About section",
  );
  await page.goto(base + "/flow");
  await button("自動進行を開始").waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "うぃる HOMEへ", exact: true })
      .getAttribute("href"),
    "/",
  );
  assert.equal(
    await page.locator(".header__subtitle").innerText(),
    "WILL.tennis 公式キャラクター",
  );
  const fixedHeader = await page.locator(".header").evaluate((el) => ({
    position: getComputedStyle(el).position,
    top: getComputedStyle(el).top,
  }));
  assert.deepEqual(fixedHeader, { position: "sticky", top: "0px" });
  assert.ok(
    await page
      .getByRole("heading", { name: "進行アシスタント", exact: true })
      .isVisible(),
  );
  pass(
    "fixed parent-brand header links HOME and page title is separated below it",
    fixedHeader,
  );
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
    names.map((x) => x.replace(/[▷◇⚙?]/g, "").trim()),
    ["進行", "チャット", "設定", "使い方"],
  );
  await layout("menu-390");
  await page.keyboard.press("Escape");
  assert.equal(
    await button("メニューを開く").getAttribute("aria-expanded"),
    "false",
  );
  pass("touch menu order and Escape");
  const autoOverview = auto().locator(".flow-overview");
  assert.equal(await autoOverview.evaluate((el) => el.open), true);
  await autoOverview.locator("summary").tap();
  assert.equal(await autoOverview.evaluate((el) => el.open), false);
  await autoOverview.locator("summary").tap();
  assert.equal(await autoOverview.evaluate((el) => el.open), true);
  pass("automatic progress menu is open by default and can be closed");
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
  const readiness = page.locator(".flow-readiness");
  assert.equal(await readiness.count(), 1);
  await readiness.locator("summary").tap();
  await button("音声を準備").tap();
  await readiness.getByText("音声準備完了", { exact: true }).waitFor();
  const prepared = await page.evaluate(async () => {
    const manifest = await (await fetch("/flow-audio-manifest")).json();
    const cache = await caches.open(manifest.cacheName);
    return {
      total: manifest.urls.length,
      cached: (await cache.keys()).length,
      controlled: Boolean(navigator.serviceWorker.controller),
      urls: manifest.urls,
    };
  });
  assert.deepEqual(
    [prepared.total, prepared.cached, prepared.controlled],
    [20, 20, true],
  );
  await settings();
  await setVolume(0);
  await button("設定を閉じる").tap();
  await readiness
    .getByText("音量が0%です。設定で音量を上げてください。", { exact: true })
    .waitFor();
  await settings();
  await setVolume(100);
  await page.getByRole("switch", { name: "チャイム", exact: true }).uncheck();
  await button("設定を閉じる").tap();
  await button("テスト音を再生").tap();
  await waitVoice("voice-test.wav");
  await settings();
  await button("試聴を停止").tap();
  await button("設定を閉じる").tap();
  pass(
    "readiness caches all 20 fixed audio assets including four iPhone background timelines, with worker control, zero-volume warning and voice/chime tests",
    prepared,
  );
  await button("2面").tap();
  await context.setOffline(true);
  const offlineFetch = await page.evaluate(
    async (urls) =>
      Promise.all(
        urls.map(async (src) => {
          const response = await fetch(src, { cache: "no-store" });
          return {
            src,
            status: response.status,
            bytes: (await response.arrayBuffer()).byteLength,
          };
        }),
      ),
    prepared.urls,
  );
  assert.ok(
    offlineFetch.every((item) => item.status === 200 && item.bytes > 44),
  );
  const range = await page.evaluate(async () => {
    const response = await fetch("/audio/flow/v2/43-game-rules.wav", {
      headers: { Range: "bytes=0-99" },
    });
    return {
      status: response.status,
      range: response.headers.get("content-range"),
      bytes: (await response.arrayBuffer()).byteLength,
    };
  });
  assert.equal(range.status, 206);
  assert.equal(range.bytes, 100);
  await button("自動進行を開始").tap();
  await waitVoice("00-opening.wav");
  for (const [label, suffix] of [
    ["00:05 ボレーボレー", "05-volley.wav"],
    ["00:10 ロングラリー", "10-long-rally.wav"],
    ["00:20 クロスラリー", "20-cross-rally-double.wav"],
    ["00:30 サーブ・リターン", "30-serve-return-double.wav"],
    ["00:35 サーブ・リターン交代", "35-serve-return-switch.wav"],
    ["00:40 集合・水分補給", "40-gather-break.wav"],
    ["00:43 乱数表の説明", "43-random-table-double.wav"],
    ["00:43 試合ルール", "43-game-rules.wav"],
    ["00:44 自己紹介", "44-self-intro.wav"],
    ["01:45 ミニゲーム（リレーラリー）", "105-mini-game.wav"],
    ["01:57 終了あいさつ・片付け", "117-closing.wav"],
  ]) {
    await seek(label);
    await waitVoice(suffix);
    if (label === "00:43 試合ルール") {
      const pregame = page.locator(".flow-pregame");
      assert.equal(
        await pregame.locator('[aria-current="step"]').innerText(),
        "●\n43:33\n試合ルール",
      );
      assert.equal(await pregame.locator("li.is-complete").count(), 2);
      assert.match(
        await pregame.innerText(),
        /50:00\s*主催者が口頭でゲーム開始/,
      );
      await layout("offline-pregame-390");
      for (const width of [320, 480, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await layout(`offline-pregame-${width}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        window.__offset += 15000;
      });
      await page.getByText("次のメニュー", { exact: true }).waitFor();
      assert.equal(
        await page
          .locator(".flow-countdown")
          .evaluate((el) => getComputedStyle(el).fontSize),
        "12px",
      );
      assert.equal(
        await page.locator(".flow-next-card--soon").count(),
        0,
      );
    }
    if (label === "00:44 自己紹介") {
      const before = await page.evaluate(() => window.__plays.length);
      await page.evaluate(() => {
        const session = JSON.parse(
          localStorage.getItem("will-standard-two-hour-auto-flow"),
        );
        window.__offset +=
          session.startedAt +
          session.accumulatedPausedMs +
          3000000 -
          Date.now();
      });
      await auto()
        .getByRole("heading", { name: "ゲーム", exact: true })
        .waitFor();
      assert.equal(await page.locator(".flow-pregame").count(), 0);
      assert.equal(await page.evaluate(() => window.__plays.length), before);
    }
  }
  assert.equal((await stored()).status, "running");
  pass(
    "offline same-page native WAV playback across all fixed flow positions and byte-range fetch",
    { offlineFetch, range },
  );
  await context.setOffline(false);
  await button("終了").tap();
  await button("終了する").tap();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("will-flow-run-history")).length,
    ),
    1,
  );
  await settings();
  await page.getByRole("switch", { name: "チャイム", exact: true }).check();
  await button("設定を閉じる").tap();
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
  const ttsStatus = await page.evaluate(() =>
    fetch("/api/openai/tts").then((response) => response.json()),
  );
  const aiVoice = page
    .getByRole("dialog", { name: "設定" })
    .getByRole("radio", { name: "AI音声", exact: true });
  assert.equal(await aiVoice.isDisabled(), !ttsStatus.configured);
  pass(
    "OpenAI TTS availability matches the server-side configuration",
    ttsStatus,
  );
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
  assert.match(await page.locator(".flow-countdown").innerText(), /あと 10:00/);
  assert.equal((await stored()).status, "paused");
  assert.equal((await stored()).pendingCue.eventId, "cross-rally");
  assert.ok(
    (await page.locator(".flow-progress__clock").innerText()).startsWith(
      "00:20:00",
    ),
  );
  assert.equal(await auto().getByText("その次", { exact: true }).count(), 0);
  const previousButton = auto().getByRole("button", {
    name: "ロングラリーへ戻る",
    exact: true,
  });
  assert.ok(await previousButton.isVisible());
  assert.match(await previousButton.innerText(), /前のメニュー/);
  assert.match(await previousButton.innerText(), /00:10/);
  await previousButton.tap();
  await silence();
  assert.ok(
    (await page.locator(".flow-progress__clock").innerText()).startsWith(
      "00:10:00",
    ),
  );
  await seek("00:20 クロスラリー");
  await silence();
  pass(
    "paused navigation offers a selectable previous item and no next-next row",
  );
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
  assert.ok(await page.evaluate(() => window.__wake.requests >= 1));
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "使い方", exact: false })
    .tap();
  await page.getByRole("heading", { name: "使い方", exact: true }).waitFor();
  assert.equal((await stored()).status, "running");
  await layout("guide-390");
  await page.evaluate(() => {
    window.__offset += 300000;
  });
  await waitVoice("10-long-rally.wav");
  assert.equal((await stored()).status, "running");
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "進行", exact: false })
    .tap();
  await auto().getByRole("button", { name: "一時停止", exact: true }).waitFor();
  assert.equal((await stored()).status, "running");
  pass(
    "internal route changes keep automatic flow mounted, running and announcing",
  );
  await button("個別進行").tap();
  await silence();
  assert.equal((await stored()).status, "paused");
  assert.equal(await auto().isVisible(), false);
  assert.equal(await manual().locator(".flow-script-text--preview").count(), 0);
  assert.equal(await manual().locator(".flow-script p").count(), 1);
  pass("manual mode shows the selected script only once");
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
  const timerChoices = await extras
    .locator(".flow-timer-choice button")
    .allTextContents();
  assert.deepEqual(timerChoices, ["1分", "3分", "5分", "10分", "15分", "20分"]);
  pass("manual timer offers six practical duration presets", timerChoices);
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
  const activeId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("will-flow-active-run")).id,
  );
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  await page.evaluate(() => {
    const session = JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    );
    window.__offset +=
      session.startedAt + session.accumulatedPausedMs + 7200000 - Date.now();
  });
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("will-standard-two-hour-auto-flow"))
        ?.status === "completed",
  );
  await silence();
  assert.equal((await stored()).status, "completed");
  const savedRun = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("will-flow-run-history")).filter(
        (run) => run.id === id,
      ),
    activeId,
  );
  assert.equal(savedRun.length, 1);
  assert.equal(savedRun[0].completedNormally, true);
  assert.ok(
    savedRun[0].manualPauseCount > 0 &&
      savedRun[0].safetyPauseCount > 0 &&
      savedRun[0].seekCount > 0,
  );
  await page.reload();
  await button("開始画面へ").waitFor();
  assert.equal(
    await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("will-flow-run-history")).filter(
          (run) => run.id === id,
        ).length,
      activeId,
    ),
    1,
  );
  pass(
    "one run survives pause, seek, reload, completion and completed reload without duplicates",
    savedRun,
  );
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
  // A one-off media play rejection should recover automatically without pausing the flow.
  await page.evaluate(() => {
    localStorage.removeItem("will-recorded-audio-diagnostics");
    window.__rejectNextMediaPlay = true;
  });
  await button("自動進行を開始").tap();
  await waitVoice("00-opening.wav");
  assert.equal((await stored()).status, "running");
  const transientDiagnostics = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-recorded-audio-diagnostics") ?? "[]"),
  );
  assert.equal(transientDiagnostics.length, 2);
  assert.equal(transientDiagnostics[0].attempt, 1);
  assert.equal(transientDiagnostics[0].reason, "play-rejected");
  assert.equal(transientDiagnostics[0].errorName, "AbortError");
  assert.deepEqual(
    transientDiagnostics.map((entry) => entry.type),
    ["retry", "recovery"],
  );
  const recovered = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-flow-active-run")),
  );
  assert.equal(recovered.audioRetryCount, 1);
  assert.equal(recovered.audioRecoveryCount, 1);
  await settings();
  const diagnosticsPanel = page.locator(".settings-panel .flow-support");
  await diagnosticsPanel.locator("summary").first().tap();
  await diagnosticsPanel
    .getByText("復旧成功（自動再試行）", { exact: true })
    .waitFor();
  assert.match(await diagnosticsPanel.innerText(), /開始・ショートラリー/);
  for (const width of [320, 480, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await layout(`diagnostics-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await button("診断ログを消去").tap();
  await button("消去する").tap();
  await diagnosticsPanel
    .getByText("診断ログはありません。", { exact: true })
    .waitFor();
  await button("設定を閉じる").tap();
  pass("one transient media failure retries automatically without pausing");
  await button("終了").tap();
  await button("終了する").tap();
  await silence();
  assert.equal(await stored(), null);

  // Two consecutive failures must still pause instead of silently running.
  await page.evaluate(() =>
    localStorage.removeItem("will-recorded-audio-diagnostics"),
  );
  await page.evaluate(() => {
    window.__rejectMediaPlays = 2;
  });
  await button("自動進行を開始").tap();
  await page
    .getByRole("alert")
    .filter({ hasText: "案内を再生できませんでした" })
    .waitFor();
  assert.equal((await stored()).status, "paused");
  assert.equal((await stored()).pendingCue.eventId, "opening");
  assert.equal(await page.evaluate(() => window.__synth), 0);
  const persistentDiagnostics = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-recorded-audio-diagnostics") ?? "[]"),
  );
  assert.equal(persistentDiagnostics.length, 2);
  assert.deepEqual(
    persistentDiagnostics.map((entry) => entry.attempt),
    [1, 2],
  );
  assert.deepEqual(
    persistentDiagnostics.map((entry) => entry.type),
    ["retry", "final-failure"],
  );
  const failedRun = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("will-flow-active-run")),
  );
  assert.equal(failedRun.audioFinalFailureCount, 1);
  assert.equal(failedRun.pauseReasons["audio-error"], 1);
  assert.equal(failedRun.manualPauseCount, 0);
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
    .getByRole("link", { name: "チャット", exact: false })
    .tap();
  await button("送信").waitFor();
  await silence();
  await layout("chat-480");
  await menu();
  await page
    .locator(".page-menu-panel")
    .getByRole("link", { name: "進行", exact: false })
    .tap();
  await button("自動進行").tap();
  await auto().getByRole("button", { name: "再開", exact: true }).waitFor();
  await auto().getByRole("button", { name: "再開", exact: true }).tap();
  const historyStart = await waitVoice("00-opening.wav");
  await page.waitForTimeout(1100);
  await page.goBack();
  await button("送信").waitFor();
  assert.equal((await stored()).status, "running");
  await page.waitForTimeout(500);
  const historyBackground = await page.evaluate(() => {
    const a = window.__media.findLast((item) => !item.paused);
    return a ? { src: a.src, position: a.currentTime } : null;
  });
  assert.ok(historyBackground?.src.endsWith("00-opening.wav"));
  assert.ok(historyBackground.position > historyStart.position);
  await page.goForward();
  await auto().getByRole("button", { name: "一時停止", exact: true }).waitFor();
  assert.equal((await stored()).status, "running");
  pass(
    "browser Back/Forward keeps the persistent flow runtime and active media running",
    historyBackground,
  );
  const wakeBeforeBackground = await page.evaluate(() => window.__wake.requests);
  await page.evaluate(async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    const sentinel = window.__wake.sentinels.at(-1);
    if (sentinel && !sentinel.released) await sentinel.release();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal((await stored()).status, "running");
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(
    (before) => window.__wake.requests > before,
    wakeBeforeBackground,
  );
  assert.equal((await stored()).status, "running");
  pass(
    "visibility changes do not pause flow and foreground reacquires screen wake lock",
  );
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
    "/flow",
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
