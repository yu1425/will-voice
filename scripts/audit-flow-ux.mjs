// Real browser evidence for the shared volume contract and all requested UX states.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
await context.addInitScript(() => {
  window.__media = [];
  window.__gain = [];
  window.__frequency = [];
  window.__frequencyRamps = [];
  window.__utterances = [];
  const A = window.Audio;
  window.Audio = function (...args) {
    const a = new A(...args);
    window.__media.push(a);
    return a;
  };
  window.Audio.prototype = A.prototype;
  const gain = AudioContext.prototype.createGain;
  AudioContext.prototype.createGain = function () {
    const g = gain.call(this);
    window.__gain.push(g);
    return g;
  };
  const osc = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const o = osc.call(this);
    const set = o.frequency.setValueAtTime.bind(o.frequency);
    o.frequency.setValueAtTime = (value, time) => {
      window.__frequency.push(value);
      return set(value, time);
    };
    const ramp = o.frequency.exponentialRampToValueAtTime.bind(o.frequency);
    o.frequency.exponentialRampToValueAtTime = (value, time) => {
      window.__frequencyRamps.push(value);
      return ramp(value, time);
    };
    return o;
  };
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => {
    window.__utterances.push({ volume: u.volume, text: u.text });
    speak(u);
  };
});
const b = (name) =>
  page.getByRole("button", {
    name: name === "もう一度聞く" ? /^(案内を聞く|もう一度聞く)$/ : name,
    exact: true,
  });
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
const setVolume = async (n) => {
  const slider = page.locator("#audio-volume");
  await slider.press("Home");
  for (let i = 0; i < n; i++) await slider.press("ArrowRight");
  assert.equal(await slider.inputValue(), String(n));
};
const playing = () =>
  page.waitForFunction(() => window.__media.some((a) => !a.paused));
const lastAudio = () =>
  page.evaluate(() => {
    const a = window.__media.findLast((a) => !a.paused);
    return a
      ? { src: a.src, volume: a.volume, currentTime: a.currentTime }
      : null;
  });
const stopped = async () =>
  assert.equal(
    await page.evaluate(() => window.__media.filter((a) => !a.paused).length),
    0,
  );
const shot = async (state, width) => {
  // Scroll only the content container: header and navigation retain their own space.
  await page
    .locator(".flow-scroll,.guide-scroll")
    .evaluate((el) => el.scrollTo({ top: 0 }));
  if (state === "timeline")
    await page
      .locator(".auto-flow .flow-overview")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    appWidth: document.querySelector(".app").getBoundingClientRect().width,
    contentBottom: document
      .querySelector(".flow-scroll,.guide-scroll")
      .getBoundingClientRect().bottom,
    navTop: document.querySelector(".page-navigation").getBoundingClientRect()
      .top,
  }));
  assert.equal(layout.width, layout.documentWidth);
  assert.ok(layout.appWidth <= 480);
  assert.ok(layout.contentBottom <= layout.navTop);
  const path = `reports/flow-v6-ux-${state}-${width}.png`;
  await page.screenshot({ path });
  pass(`${width} ${state} layout`, { ...layout, screenshot: path });
};
try {
  for (const [width, height] of [
    [390, 844],
    [480, 920],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "/flow");
    await b("自動進行を開始").waitFor();
    await shot("idle", width);
    await b("自動進行を開始").click();
    await playing();
    await shot("playing", width);
    await b("今の音声を止める").click();
    await stopped();
    await shot("stopped", width);
    await b("進行を一時停止").click();
    await shot("paused", width);
    await b("進行を再開").click();
    await shot("running", width);
    await page.locator(".auto-flow .flow-overview > summary").click();
    await shot("timeline", width);
    await page
      .getByRole("button", { name: "00:43 乱数表の説明", exact: true })
      .click();
    await b("移動して案内").click();
    await b("設定を開く").click();
    await setVolume(30);
    await page.waitForFunction(() =>
      window.__media.some(
        (a) => !a.paused && a.src.endsWith("43-random-table-single.wav"),
      ),
    );
    assert.equal((await lastAudio()).volume, 0.3);
    pass(
      `${width} volume change during chime preserves delayed announcement`,
      await lastAudio(),
    );
    await shot("volume", width);
    await b("設定を開く").click();
    await b("今の音声を止める").click();
    await b("個別進行").click();
    await shot("manual", width);
    await page
      .getByRole("button", { name: "03 ロングラリー", exact: true })
      .click();
    assert.equal(
      await page.locator(".flow-scroll").evaluate((el) => el.scrollTop),
      0,
    );
    pass(`${width} manual STEP selection returns current content to top`);
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "使い方", exact: true })
      .click();
    await page.getByRole("heading", { name: "うぃる進行の使い方" }).waitFor();
    await shot("guide", width);
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "進行", exact: true })
      .click();
    await page.getByRole("progressbar").waitFor();
    await endFlow();
    await stopped();
  }
  // One uninterrupted actual WAV must follow 100 -> 50 -> 20 -> 30.
  await page.setViewportSize({ width: 390, height: 844 });
  await b("設定を開く").click();
  await setVolume(100);
  await b("設定を開く").click();
  await b("自動進行を開始").click();
  await playing();
  const index = await page.evaluate(() =>
    window.__media.findLastIndex((a) => !a.paused),
  );
  await b("設定を開く").click();
  const volumeEvidence = [];
  for (const slider of [100, 50, 20, 30]) {
    await setVolume(slider);
    const row = await page.evaluate(
      (i) => ({
        volume: window.__media[i].volume,
        paused: window.__media[i].paused,
        currentTime: window.__media[i].currentTime,
      }),
      index,
    );
    assert.equal(row.volume, slider / 100);
    assert.equal(row.paused, false);
    volumeEvidence.push({ slider, ...row });
  }
  pass(
    "same active WAV follows 100 50 20 30 without replacement",
    volumeEvidence,
  );
  await b("設定を開く").click();
  await endFlow();
  await b("設定を開く").click();
  await setVolume(50);
  await b("チャイムを試聴").click();
  const master = await page.evaluate(() => window.__gain[0].gain.value);
  assert.equal(master, 0.5);
  const frequencies = await page.evaluate(() => window.__frequency.slice(0, 9));
  const expected = [659.25, 830.61, 987.77].flatMap((f) =>
    [1, 2.01, 2.98].map((p) => f * p),
  );
  assert.equal(frequencies.length, 9);
  assert.deepEqual(await page.evaluate(() => window.__frequencyRamps), []);
  frequencies.forEach((f, i) => assert.ok(Math.abs(f - expected[i]) < 0.001));
  await setVolume(20);
  await page.waitForFunction(
    () => Math.abs(window.__gain[0].gain.value - 0.2) < 0.00001,
  );
  await b("今の音声を止める").click();
  await b("設定を開く").click();
  pass("restored original three bell pitches and live common chime gain", {
    frequencies,
    masterBefore: 0.5,
    masterAfter: 0.2,
    source: "4c7a9b5",
  });
  // Real local ENGINE response, including a volume update while synthesis is pending.
  await page.evaluate(() => {
    localStorage.setItem(
      "will-optional-voice-modes",
      JSON.stringify({ standard: true, voicevox: true }),
    );
    localStorage.setItem("will-voice-mode", "voicevox");
    localStorage.setItem("will-voicevox-style-id", "3");
  });
  await page.reload();
  await b("個別進行").click();
  await page.getByText("開催設定", { exact: true }).click();
  await b("案内文を編集").click();
  await page
    .getByLabel("このSTEPの案内文")
    .fill(
      "音声音量の確認です。近くのかたと、ゆっくりテニスを楽しみましょう。".repeat(
        3,
      ),
    );
  let release;
  const gate = new Promise((r) => (release = r));
  let pending = false;
  await page.route("**/api/voicevox/tts", async (route) => {
    pending = true;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await gate;
    await route.fulfill({ response });
  });
  await b("もう一度聞く").click();
  for (let i = 0; i < 50 && !pending; i++) await page.waitForTimeout(100);
  assert.ok(pending);
  await b("設定を開く").click();
  await setVolume(30);
  release();
  await playing();
  const liveStart = await lastAudio();
  assert.ok(liveStart.src.startsWith("blob:"));
  assert.equal(liveStart.volume, 0.3);
  await setVolume(50);
  const liveChange = await lastAudio();
  assert.equal(liveChange.volume, 0.5);
  pass(
    "live VOICEVOX pending synthesis uses latest volume and playing audio updates",
    { liveStart, liveChange },
  );
  await b("設定を開く").click();
  await b("今の音声を止める").click();
  await page.unroute("**/api/voicevox/tts");
  await page.evaluate(() =>
    localStorage.setItem("will-voice-mode", "standard"),
  );
  await page.reload();
  await b("個別進行").click();
  await page.getByText("開催設定", { exact: true }).click();
  await b("案内文を編集").click();
  await page
    .getByLabel("このSTEPの案内文")
    .fill("標準音声の音量も確認します。");
  await b("設定を開く").click();
  await setVolume(20);
  assert.ok(
    (await page.locator(".flow-session-settings").innerText()).includes(
      "音量の変更は次の再生から反映",
    ),
  );
  await b("設定を開く").click();
  await b("もう一度聞く").click();
  const standard = await page.evaluate(() => window.__utterances.at(-1));
  assert.ok(Math.abs(standard.volume - 0.2) < 0.00001);
  await b("今の音声を止める").click();
  pass(
    "standard speech receives shared volume with explicit next-playback guidance",
    standard,
  );
  assert.deepEqual(errors, []);
  pass("no runtime errors");
  writeFileSync(
    "reports/flow-v6-ux-audit.json",
    JSON.stringify(
      {
        auditedAt: new Date().toISOString(),
        base,
        checks,
        errors,
        method:
          "Real Chromium with native Audio, AudioContext, SpeechSynthesis and real local VOICEVOX ENGINE; slider operated with native keyboard input",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
