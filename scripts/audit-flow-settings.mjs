// Native audio regression for the consolidated settings and final UI wording.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3002";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(() => {
  if (
    localStorage.getItem("will-standard-two-hour-auto-flow-settings") === null
  )
    localStorage.setItem(
      "will-standard-two-hour-auto-flow-settings",
      JSON.stringify({ chimeEnabled: false }),
    );
  window.__offset = 0;
  const now = Date.now;
  Date.now = () => now() + window.__offset;
  window.__media = [];
  window.__plays = [];
  window.__oscillators = [];
  const A = window.Audio;
  window.Audio = function (...args) {
    const a = new A(...args);
    window.__media.push(a);
    return a;
  };
  window.Audio.prototype = A.prototype;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    return play
      .call(this)
      .then(() => window.__plays.push({ src: this.src, volume: this.volume }));
  };
  const create = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const o = create.call(this),
      row = { active: false };
    const start = o.start.bind(o),
      stop = o.stop.bind(o);
    o.start = (...args) => {
      row.active = true;
      window.__oscillators.push(row);
      return start(...args);
    };
    o.stop = (...args) => {
      if (!args.length) row.active = false;
      return stop(...args);
    };
    o.addEventListener("ended", () => (row.active = false));
    return o;
  };
});
const b = (name) => page.getByRole("button", { name, exact: true });
const settings = page.locator("#audio-volume-settings");
const sb = (name) => settings.getByRole("button", { name, exact: true });
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
const playing = (file) =>
  page.waitForFunction(
    (file) =>
      window.__media.some(
        (a) => !a.paused && a.src.endsWith(file) && a.currentTime > 0.1,
      ),
    file,
  );
const silent = async () => {
  assert.equal(
    await page.evaluate(() => window.__media.filter((a) => !a.paused).length),
    0,
  );
  assert.equal(
    await page.evaluate(
      () => window.__oscillators.filter((o) => o.active).length,
    ),
    0,
  );
};
const boundary = async (sec) => {
  await page.evaluate((sec) => {
    const s = JSON.parse(
      localStorage.getItem("will-standard-two-hour-auto-flow"),
    );
    window.__offset +=
      s.startedAt + s.accumulatedPausedMs + (sec - 3) * 1000 - Date.now();
  }, sec);
  await page.waitForFunction((sec) => {
    const text = document.querySelector(
      ".flow-progress__clock strong",
    )?.textContent;
    if (!text) return false;
    const [h, m, s] = text.split(":").map(Number);
    const elapsed = h * 3600 + m * 60 + s;
    return elapsed >= sec - 3 && elapsed < sec;
  }, sec);
};
try {
  await page.goto(base + "/flow");
  await b("設定を開く").click();
  assert.equal(
    await settings
      .getByRole("switch", { name: "チャイム", exact: true })
      .isChecked(),
    false,
  );
  assert.ok(
    (await settings.innerText()).includes(
      "自動進行・個別進行・声かけに共通です",
    ),
  );
  assert.ok(!(await settings.innerText()).includes("録音・VOICEVOX・チャイム"));
  pass("existing saved chime OFF is restored; concise shared volume wording");
  await settings.locator("#audio-volume").press("Home");
  for (let i = 0; i < 30; i++)
    await settings.locator("#audio-volume").press("ArrowRight");
  await sb("テスト再生").click();
  await playing("voice-test.wav");
  assert.equal(
    await page.evaluate(() => window.__media.findLast((a) => !a.paused).volume),
    0.3,
  );
  await sb("今の音声を止める").click();
  await silent();
  pass(
    "settings test uses recorded Zundamon WAV and shared 30% volume; stop cancels it",
  );
  await sb("チャイムを試聴").click();
  await page.waitForFunction(() => window.__oscillators.some((o) => o.active));
  assert.equal(await page.evaluate(() => window.__oscillators.length), 9);
  await sb("今の音声を止める").click();
  await silent();
  pass(
    "explicit chime preview works while automatic chime is OFF and is cancellable",
  );
  await b("設定を開く").click();
  await b("個別進行").click();
  await b("設定を開く").click();
  await sb("チャイムを試聴").click();
  await page.waitForFunction(() => window.__oscillators.some((o) => o.active));
  await sb("テスト再生").click();
  await playing("voice-test.wav");
  assert.equal(
    await page.evaluate(
      () => window.__oscillators.filter((o) => o.active).length,
    ),
    0,
  );
  assert.equal(
    await page.evaluate(() => window.__media.filter((a) => !a.paused).length),
    1,
  );
  await sb("今の音声を止める").click();
  await silent();
  pass("both tests work in manual mode and replace each other without overlap");
  await b("設定を開く").click();
  await b("自動進行").click();
  await b("自動進行を開始").click();
  await playing("00-opening.wav");
  await b("今の音声を止める").click();
  const beforeOff = await page.evaluate(() => window.__oscillators.length);
  await boundary(300);
  await playing("05-volley.wav");
  assert.equal(
    await page.evaluate(() => window.__oscillators.length),
    beforeOff,
  );
  pass(
    "saved chime OFF suppresses only the bell; the next native WAV still plays",
  );
  await b("設定を開く").click();
  await settings.getByRole("switch", { name: "チャイム", exact: true }).check();
  assert.equal(
    await page.evaluate(() => window.__media.findLast((a) => !a.paused).volume),
    0.3,
  );
  await b("設定を開く").click();
  await b("今の音声を止める").click();
  const beforeOn = await page.evaluate(() => window.__oscillators.length);
  await boundary(600);
  await playing("10-long-rally.wav");
  assert.equal(
    await page.evaluate(() => window.__oscillators.length),
    beforeOn + 9,
  );
  pass(
    "changing chime ON during a session preserves the active WAV and enables the future bell/WAV",
  );
  await page.locator(".auto-flow .flow-overview > summary").click();
  await b("00:20 クロスラリー").click();
  await b("移動して案内").click();
  await b("設定を開く").click();
  await sb("テスト再生").click();
  await playing("voice-test.wav");
  await page.waitForTimeout(3900);
  assert.equal(
    await page.evaluate(
      () =>
        window.__plays.filter((a) =>
          a.src.endsWith("20-cross-rally-single.wav"),
        ).length,
    ),
    0,
  );
  await sb("今の音声を止める").click();
  await silent();
  pass("settings test cancels a pending auto WAV without a delayed overwrite");
  await b("設定を開く").click();
  await page.locator(".flow-session-settings > summary").click();
  await b("自動進行を終了").click();
  await b("終了する").click();
  await page.reload();
  await b("設定を開く").click();
  assert.equal(
    await settings
      .getByRole("switch", { name: "チャイム", exact: true })
      .isChecked(),
    true,
  );
  assert.equal(await settings.locator("#audio-volume").inputValue(), "30");
  pass("chime ON and volume 30% survive reload with the original storage keys");
  for (const [width, height] of [
    [390, 844],
    [480, 920],
  ]) {
    await page.setViewportSize({ width, height });
    const screenshot = `reports/flow-v6-settings-${width}.png`;
    await page.screenshot({ path: screenshot });
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panelBottom: document
        .querySelector("#audio-volume-settings")
        .getBoundingClientRect().bottom,
      navTop: document.querySelector(".page-navigation").getBoundingClientRect()
        .top,
    }));
    assert.equal(layout.documentWidth, width);
    assert.ok(layout.panelBottom < layout.navTop);
    assert.ok(
      await settings
        .getByRole("heading", { name: "アプリについて", exact: true })
        .isVisible(),
    );
    pass(
      `${width} consolidated settings remain readable without navigation overlap`,
      { ...layout, screenshot },
    );
  }
  await b("設定を開く").click();
  await b("個別進行").click();
  await b("03 ロングラリー").click();
  assert.ok(await b("案内を聞く").isVisible());
  await b("案内を聞く").click();
  await playing("10-long-rally.wav");
  assert.ok(await b("もう一度聞く").isVisible());
  await b("今の音声を止める").click();
  await silent();
  await b("全文を見る").click();
  assert.equal(await b("全文を見る").getAttribute("aria-expanded"), "true");
  await b("全文を見る").click();
  assert.equal(await b("全文を見る").getAttribute("aria-expanded"), "false");
  assert.equal(await b("音声を一時停止").count(), 0);
  pass(
    "manual initial listen becomes replay; disclosure wording stays fixed; only two audio buttons",
  );
  await page.locator(".flow-extras > summary").click();
  const extras = page.locator(".flow-extras");
  assert.equal(
    await extras.getByRole("button", { name: "リセット", exact: true }).count(),
    0,
  );
  await extras.getByRole("button", { name: "10分", exact: true }).click();
  await extras
    .getByRole("button", { name: "タイマー開始", exact: true })
    .click();
  assert.equal(
    await extras.getByRole("button", { name: "5分", exact: true }).count(),
    0,
  );
  await extras.getByRole("button", { name: "一時停止", exact: true }).click();
  const frozen = await extras.locator(".flow-extra-time").innerText();
  await page.waitForTimeout(1100);
  assert.equal(await extras.locator(".flow-extra-time").innerText(), frozen);
  await extras.getByRole("button", { name: "再開", exact: true }).click();
  await extras.getByRole("button", { name: "リセット", exact: true }).click();
  assert.equal(await extras.locator(".flow-extra-time").innerText(), "10:00");
  assert.ok(
    await extras.getByRole("button", { name: "10分", exact: true }).isVisible(),
  );
  pass(
    "timer hides redundant controls, pauses/resumes and resets to the selected duration",
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "will-standard-two-hour-auto-flow-settings",
      "{invalid",
    ),
  );
  await page.reload();
  await b("設定を開く").click();
  assert.equal(await settings.locator("#audio-volume").inputValue(), "30");
  assert.equal(
    await settings
      .getByRole("switch", { name: "チャイム", exact: true })
      .isChecked(),
    true,
  );
  pass(
    "invalid chime preferences fall back safely without losing saved volume",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    "reports/flow-v6-settings-audit.json",
    JSON.stringify(
      { auditedAt: new Date().toISOString(), base, checks, errors },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
