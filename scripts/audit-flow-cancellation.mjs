import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3001";
const checks = [];
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
await context.addInitScript(() => {
  window.__audios = [];
  window.__playLog = [];
  window.__cancelCalls = 0;
  window.__speakCalls = 0;
  const A = window.Audio;
  window.Audio = function (...args) {
    const a = new A(...args);
    window.__audios.push(a);
    return a;
  };
  window.Audio.prototype = A.prototype;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const a = this;
    return play.call(a).then(() => window.__playLog.push(a.src));
  };
  const cancel = speechSynthesis.cancel.bind(speechSynthesis);
  speechSynthesis.cancel = () => {
    window.__cancelCalls++;
    cancel();
  };
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => {
    window.__speakCalls++;
    speak(u);
  };
});
const b = (name) => page.getByRole("button", { name, exact: true });
try {
  await page.goto(base + "/flow");
  await b("自動進行を開始").waitFor();
  // Real pending WAV response; old play rejection must not overwrite the new voice state.
  let release,
    blocked = false;
  const gate = new Promise((r) => (release = r));
  await page.route("**/audio/flow/v2/00-opening.wav", async (r) => {
    blocked = true;
    await gate;
    await r.continue().catch(() => {});
  });
  await b("自動進行を開始").click();
  await page.waitForFunction(() =>
    document.querySelector(".flow-audio-state")?.textContent.includes("再生中"),
  );
  await b("個別進行").click();
  assert.equal(blocked, true);
  await page
    .getByRole("button", { name: "02 ボレーボレー", exact: true })
    .click();
  await b("もう一度聞く").click();
  await page.waitForFunction(() =>
    window.__audios.some((a) => !a.paused && a.src.endsWith("05-volley.wav")),
  );
  release();
  await page.waitForTimeout(600);
  assert.ok(await b("音声を止める").isEnabled());
  assert.ok(
    await page.evaluate(() =>
      window.__audios.some((a) => !a.paused && a.src.endsWith("05-volley.wav")),
    ),
  );
  assert.equal(await page.evaluate(() => window.__speakCalls), 0);
  pass("late recorded callback cannot stop new playback or fallback");
  await b("音声を止める").click();
  await page.unroute("**/audio/flow/v2/00-opening.wav");
  // Enable live ENGINE voice for edited manual text, leaving canonical recordings untouched.
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
  await page.getByText("コート数・案内を調整", { exact: true }).click();
  await b("案内文を編集").click();
  await page
    .getByLabel("このSTEPの案内文")
    .fill(
      "音声の停止動作を確認します。近くのかたとゆっくりテニスを楽しみましょう。",
    );
  let releaseTts,
    ttsBlocked = false;
  const ttsGate = new Promise((r) => (releaseTts = r));
  await page.route("**/api/voicevox/tts", async (r) => {
    ttsBlocked = true;
    const response = await r.fetch();
    await ttsGate;
    await r.fulfill({ response }).catch(() => {});
  });
  await b("もう一度聞く").click();
  for (let n = 0; n < 50 && !ttsBlocked; n++) await page.waitForTimeout(100);
  assert.ok(ttsBlocked);
  await b("自動進行").click();
  releaseTts();
  await page.waitForTimeout(1500);
  assert.deepEqual(
    await page.evaluate(() =>
      window.__audios.filter((a) => !a.paused).map((a) => a.src),
    ),
    [],
  );
  assert.equal(await page.evaluate(() => window.__speakCalls), 0);
  pass("mode switch aborts delayed real VOICEVOX response");
  await page.unroute("**/api/voicevox/tts");
  // Actual live ENGINE synthesis and WAV playback, then stop on route change.
  await b("個別進行").click();
  await b("案内文を編集").click();
  await page
    .getByLabel("このSTEPの案内文")
    .fill("これはボイスボックス音声です。画面を切り替えると案内を停止します。");
  await b("もう一度聞く").click();
  await page.waitForFunction(() =>
    window.__audios.some((a) => !a.paused && a.src.startsWith("blob:")),
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "使い方", exact: true })
    .click();
  await page.getByRole("heading", { name: "うぃる進行の使い方" }).waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      window.__audios.filter((a) => !a.paused).map((a) => a.src),
    ),
    [],
  );
  pass("real VOICEVOX blob playback stops on flow to guide");
  await page.goto(base + "/flow");
  await page.evaluate(() =>
    localStorage.setItem("will-voice-mode", "standard"),
  );
  await page.reload();
  await b("個別進行").click();
  await page.getByText("コート数・案内を調整", { exact: true }).click();
  await b("案内文を編集").click();
  await page
    .getByLabel("このSTEPの案内文")
    .fill("ブラウザの音声を止めるします。".repeat(20));
  await b("もう一度聞く").click();
  assert.ok(await page.evaluate(() => window.__speakCalls > 0));
  const before = await page.evaluate(() => window.__cancelCalls);
  await b("自動進行").click();
  assert.ok((await page.evaluate(() => window.__cancelCalls)) > before);
  assert.equal(
    await page.evaluate(
      () => speechSynthesis.speaking || speechSynthesis.pending,
    ),
    false,
  );
  pass("SpeechSynthesis cancel on manual to auto");
  // Additional visual evidence: timeline/current labels, STEP list, and desktop width.
  for (const [width, height] of [
    [390, 844],
    [480, 920],
  ]) {
    await page.setViewportSize({ width, height });
    if (await b("自動進行を終了").isVisible())
      await b("自動進行を終了").click();
    await b("自動進行を開始").click();
    await b("進行を一時停止").click();
    await page.locator(".auto-flow .flow-overview > summary").click();
    await page
      .getByRole("button", { name: "00:40 乱数表の説明", exact: true })
      .click();
    await b("音声を止める").click();
    await page
      .locator(".flow-timeline")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `reports/flow-v3-timeline-${width}.png` });
    await b("個別進行").click();
    await page
      .locator(".flow-step-list")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `reports/flow-v3-steps-${width}.png` });
    await b("自動進行").click();
    await b("自動進行を終了").click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const rect = await page.locator(".app").boundingBox();
  assert.equal(rect.width, 480);
  assert.equal(rect.x, 480);
  pass("desktop preserves centered 480px app");
  await page.screenshot({ path: "reports/flow-v3-desktop.png" });
  writeFileSync(
    "reports/flow-v3-cancellation-audit.json",
    JSON.stringify(
      { auditedAt: new Date().toISOString(), base, checks },
      null,
      2,
    ) + "\n",
  );
} finally {
  await context.close();
  await browser.close();
}
