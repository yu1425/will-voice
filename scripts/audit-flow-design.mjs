// Verify the requested information hierarchy and controls in actual rendered layouts.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const { chromium } = await import(
  process.env.WILL_PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.WILL_AUDIT_URL ?? "http://127.0.0.1:3002";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(() => {
  window.__offset = 0;
  const now = Date.now;
  Date.now = () => now() + window.__offset;
});
const b = (name) =>
  page.getByRole("button", {
    name: name === "もう一度聞く" ? /^(案内を聞く|もう一度聞く)$/ : name,
    exact: true,
  });
const pass = (name, evidence) => {
  checks.push({ name, pass: true, evidence });
  console.log("PASS " + name);
};
try {
  for (const [width, height] of [
    [390, 844],
    [480, 920],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "/flow");
    await b("自動進行を開始").click();
    await page.locator(".auto-flow .flow-overview > summary").click();
    await b("00:10 ロングラリー").click();
    await b("移動して案内").click();
    await b("今の音声を止める").click();
    await page.locator(".auto-flow .flow-overview > summary").click();
    await page.evaluate(() => {
      const s = JSON.parse(
        localStorage.getItem("will-standard-two-hour-auto-flow"),
      );
      window.__offset +=
        s.startedAt + s.accumulatedPausedMs + 875000 - Date.now();
    });
    await page.waitForFunction(() =>
      /00:14:3[56]/.test(
        document.querySelector(".flow-progress__clock strong").textContent,
      ),
    );
    await b("進行を一時停止").click();
    await page
      .locator(".flow-scroll")
      .evaluate((el) => el.scrollTo({ top: 0 }));
    const next = page.getByRole("region", {
      name: "次のメニュー",
      exact: true,
    });
    assert.ok((await next.innerText()).includes("クロスラリー"));
    assert.ok((await next.innerText()).includes("00:20"));
    assert.match(
      await next.locator(".flow-countdown").innerText(),
      /^あと 5:2[45]$/,
    );
    assert.ok(
      (
        await page.getByRole("region", { name: "その次のメニュー" }).innerText()
      ).includes("サーブ・リターン"),
    );
    const frozen = await next.innerText();
    await page.waitForTimeout(1100);
    assert.equal(await next.innerText(), frozen);
    const layout = await page.evaluate(() => {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const style = (selector) => {
        const s = getComputedStyle(document.querySelector(selector));
        return {
          fontSize: s.fontSize,
          background: s.backgroundColor,
          radius: s.borderRadius,
        };
      };
      return {
        switch: box(".flow-mode-switch"),
        gear: box(".settings-toggle"),
        card: box(".flow-progress"),
        content: box(".flow-scroll"),
        title: box(".flow-progress h1"),
        clock: box(".flow-progress__clock"),
        bar: box(".flow-progress__bar"),
        next: box(".flow-progress__next"),
        later: box(".flow-progress__later"),
        primary: box(".flow-controls"),
        audio: box(".flow-audio-controls"),
        timeline: box(".auto-flow .flow-overview"),
        extras: box(".flow-extras"),
        settings: box(".flow-session-settings"),
        nav: box(".page-navigation"),
        titleStyle: style(".flow-progress h1"),
        nextStyle: style(".flow-progress__next"),
        primaryStyle: style(".flow-controls button"),
        audioStyle: style(".flow-audio-controls button"),
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    assert.equal(layout.documentWidth, width);
    assert.ok(layout.gear.height >= 44 && layout.gear.width >= 44);
    assert.ok(layout.audio.bottom < layout.nav.top);
    assert.ok(layout.card.bottom <= layout.content.bottom);
    assert.ok(
      await page
        .locator(".flow-progress__later h2")
        .evaluate(
          (el) =>
            el.getBoundingClientRect().bottom <=
            el.nextElementSibling.getBoundingClientRect().top,
        ),
    );
    assert.equal(
      await page.locator(".auto-flow .flow-overview > summary").innerText(),
      "全体の進行",
    );
    assert.ok(
      layout.title.top < layout.next.top && layout.next.top < layout.later.top,
    );
    assert.ok(
      layout.later.bottom < layout.primary.top &&
        layout.primary.bottom < layout.audio.top,
    );
    assert.ok(
      layout.timeline.bottom < layout.extras.top &&
        layout.extras.bottom < layout.settings.top,
    );
    assert.equal(Number.parseFloat(layout.titleStyle.fontSize), 26);
    assert.equal(layout.nextStyle.background, "rgb(243, 245, 248)");
    assert.notEqual(
      layout.primaryStyle.background,
      layout.audioStyle.background,
    );
    assert.ok(layout.primary.height >= 48 && layout.primary.height <= 52);
    const screenshot = `reports/flow-v6-design-${width}.png`;
    await page.screenshot({ path: screenshot });
    pass(
      `${width} current/next/later hierarchy, frozen countdown and all primary/audio controls above fold`,
      { ...layout, screenshot, next: frozen },
    );
    const settings = page.locator(".flow-session-settings");
    await settings.locator("summary").click();
    assert.equal(
      await settings.getByRole("button", { name: "2面", exact: true }).count(),
      0,
    );
    assert.ok(
      await settings
        .getByText("進行中はコート数を変更できません", { exact: true })
        .isVisible(),
    );
    assert.equal(
      await page
        .locator(".auto-flow .flow-overview")
        .getByRole("button", { name: "自動進行を終了", exact: true })
        .count(),
      0,
    );
    await b("自動進行を終了").click();
    await page
      .getByRole("heading", { name: "自動進行を終了しますか？", exact: true })
      .waitFor();
    await b("キャンセル").click();
    assert.ok(await b("進行を再開").isVisible());
    pass(
      `${width} readonly court row and end confirmation cancel preserve the paused session`,
    );
    await b("進行を再開").click();
    await b("もう一度聞く").click();
    await b("今の音声を止める").click();
    await page
      .getByText("次の案内は自動で再生されます", { exact: false })
      .waitFor();
    assert.equal(
      await page.locator(".flow-audio-state").first().innerText(),
      "待機中",
    );
    assert.equal(await b("今の音声を止める").isDisabled(), true);
    await page.waitForTimeout(2700);
    assert.equal(await page.locator(".flow-audio-notice").count(), 0);
    pass(
      `${width} stop feedback expires, status returns to waiting, stop stays visible disabled`,
    );
    await b("自動進行を終了").click();
    await b("終了する").click();
    await b("自動進行を開始").waitFor();
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("will-standard-two-hour-auto-flow"),
      ),
      null,
    );
    await b("個別進行").click();
    await page
      .getByRole("heading", { name: "ロングラリー", exact: true })
      .waitFor();
    assert.equal(
      (await page.locator(".flow-step-position").innerText()).trim(),
      "STEP 03 / 12",
    );
    assert.ok(await b("全文を見る").isVisible());
    assert.equal(await b("今の音声を止める").isDisabled(), true);
    const manualScreenshot = `reports/flow-v6-design-manual-${width}.png`;
    await page.screenshot({ path: manualScreenshot });
    pass(
      `${width} manual STEP 03, truncated preview and matching audio controls`,
      { screenshot: manualScreenshot },
    );
    await b("自動進行").click();
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    "reports/flow-v6-design-audit.json",
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
