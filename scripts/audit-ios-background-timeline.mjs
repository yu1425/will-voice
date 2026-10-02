import assert from 'node:assert/strict';
const { chromium } = await import(process.env.WILL_PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.WILL_AUDIT_URL;
if (!base) throw new Error('Set WILL_AUDIT_URL');
const browser = await chromium.launch({ headless: true, executablePath: process.env.WILL_CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await context.addInitScript(() => {
  window.__wake = { requests: 0, sentinels: [] };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        window.__wake.requests++;
        const listeners = [];
        const sentinel = {
          released: false,
          addEventListener(type, listener) { if (type === 'release') listeners.push(listener); },
          async release() {
            if (this.released) return;
            this.released = true;
            for (const listener of listeners) listener();
          },
        };
        window.__wake.sentinels.push(sentinel);
        return sentinel;
      },
    },
  });
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const button = (name) => page.getByRole('button', { name, exact: true });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('will-standard-two-hour-auto-flow')));
const timeline = () => page.locator('audio[src*="background-timeline-"]');
const timelineState = () => page.evaluate(() => {
  const a = [...document.querySelectorAll('audio')].find((el) => el.src.includes('background-timeline-'));
  return a ? { src: a.src, paused: a.paused, ended: a.ended, currentTime: a.currentTime, volume: a.volume } : null;
});
const menu = async () => {
  const trigger = button('メニューを開く');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.tap();
  await page.locator('.page-menu-panel').waitFor();
};
try {
  await page.goto(base + '/flow');
  await button('2面').tap();
  const readiness = page.locator('.flow-readiness');
  await readiness.locator('summary').tap();
  await button('音声を準備').tap();
  await readiness.getByText('音声準備完了', { exact: true }).waitFor({ timeout: 60000 });
  await button('自動進行を開始').tap();
  await page.waitForFunction(() => {
    const a = [...document.querySelectorAll('audio')].find((el) => el.src.includes('background-timeline-2court-'));
    return a && !a.paused && a.readyState >= 2;
  });
  let state = await timelineState();
  assert.ok(state?.src.includes('background-timeline-2court-plain.m4a') || state?.src.includes('background-timeline-2court-chime.m4a'));
  assert.equal((await stored()).status, 'running');
  const startPosition = state.currentTime;
  await page.waitForTimeout(1200);
  state = await timelineState();
  assert.ok(state.currentTime > startPosition + 0.5, JSON.stringify({ startPosition, state }));

  await menu();
  await page.locator('.page-menu-panel').getByRole('link', { name: '使い方', exact: false }).tap();
  await page.getByRole('heading', { name: '使い方', exact: true }).waitFor();
  const awayStart = (await timelineState()).currentTime;
  await page.waitForTimeout(1200);
  const awayEnd = await timelineState();
  assert.equal((await stored()).status, 'running');
  assert.equal(awayEnd.paused, false);
  assert.ok(awayEnd.currentTime > awayStart + 0.5, JSON.stringify({ awayStart, awayEnd }));

  await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const sentinel = window.__wake.sentinels.at(-1);
    if (sentinel && !sentinel.released) await sentinel.release();
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenStart = (await timelineState()).currentTime;
  await page.waitForTimeout(900);
  const hiddenEnd = await timelineState();
  assert.equal((await stored()).status, 'running');
  assert.equal(hiddenEnd.paused, false);
  assert.ok(hiddenEnd.currentTime > hiddenStart + 0.3);
  const wakeBefore = await page.evaluate(() => window.__wake.requests);
  await page.evaluate(() => {
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction((before) => window.__wake.requests > before, wakeBefore);

  await menu();
  await page.locator('.page-menu-panel').getByRole('link', { name: '進行', exact: false }).tap();
  await page.getByRole('button', { name: '一時停止', exact: true }).waitFor();
  await page.getByRole('button', { name: '一時停止', exact: true }).tap();
  const pausedAt = (await timelineState()).currentTime;
  await page.waitForTimeout(900);
  assert.ok(Math.abs((await timelineState()).currentTime - pausedAt) < 0.2);
  assert.equal((await stored()).status, 'paused');
  await page.getByRole('button', { name: '再開', exact: true }).tap();
  await page.waitForTimeout(700);
  const resumedState = await timelineState();
  assert.equal(resumedState.paused, false);
  assert.ok(resumedState.currentTime > pausedAt + 0.1);

  const overview = page
    .locator('section[aria-label="自動進行"]')
    .locator('.flow-overview');
  if (!(await overview.evaluate((el) => el.open))) await overview.locator('summary').tap();
  await overview.locator('button[aria-label$="00:20 クロスラリー"]').tap();
  await page.waitForTimeout(300);
  state = await timelineState();
  assert.ok(state.currentTime >= 1199.5 && state.currentTime < 1202, JSON.stringify(state));

  await menu();
  await page.locator('.page-menu-panel').getByRole('button', { name: '設定', exact: true }).tap();
  const chime = page.getByRole('switch', { name: 'チャイム', exact: true });
  const wasChecked = await chime.isChecked();
  const beforeSwitch = (await timelineState()).currentTime;
  if (wasChecked) await chime.uncheck(); else await chime.check();
  await button('設定を閉じる').tap();
  await page.waitForTimeout(500);
  const afterSwitch = await timelineState();
  assert.equal(afterSwitch.paused, false);
  assert.ok(Math.abs(afterSwitch.currentTime - beforeSwitch) < 2);
  assert.notEqual(afterSwitch.src.includes('-chime.m4a'), wasChecked);

  assert.equal(await timeline().count(), 1);
  console.log('PASS: one continuous native two-hour timeline stays playing across internal navigation and simulated background, pauses/resumes/seeks, and switches chime variants without resetting progress');
} finally {
  await context.close();
  await browser.close();
}
