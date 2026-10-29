// End-to-end check of the storyteller flow in real Chromium with a fake microphone.
// usage: BASE=http://localhost:3000 node e2e/interview.e2e.mjs [screenshotDir]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// playwright is pre-installed globally in CI/dev containers; fall back to a local install
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE ?? 'http://localhost:3000';
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });

const api = async (path, init) => {
  const res = await fetch(BASE + path, init);
  assert.ok(res.ok, `${path} -> ${res.status}`);
  return res.json();
};

const step = (msg) => console.log(`• ${msg}`);

const created = await api('/api/storytellers', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'คุณยายมาลี', callName: 'ยาย', creatorName: 'ภูมิ' }),
});
step(`created storyteller ${created.recordToken}`);

// a continuous tone stands in for a voice (Chromium's default fake mic only beeps briefly)
const voiceWav = path.join(os.tmpdir(), 'moradok-e2e-voice.wav');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', voiceWav]);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voiceWav}`],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// ---- landing + new ----
await page.goto(BASE + '/');
await page.getByText('เริ่มเก็บเรื่องเล่า').first().waitFor();
await shot(page, '01-landing');

await page.goto(BASE + '/new');
await page.getByPlaceholder('เช่น คุณยายมาลี').fill('คุณตาสมชาย');
await page.getByRole('button', { name: 'ตา', exact: true }).click();
await page.getByPlaceholder('เช่น ภูมิ').fill('มิ้นท์');
await shot(page, '02-new');
await page.getByRole('button', { name: 'สร้างสมุดชีวิต' }).click();
await page.waitForURL(/\/m\/[A-Za-z0-9_-]+\?new=1/);
await page.getByText('สร้างเรียบร้อย').waitFor();
assert.equal(await page.locator('textarea').count(), 11);
await shot(page, '03-manage');
step('create via /new -> manage page with 11 questions');

// ---- interview ----
await page.goto(`${BASE}/r/${created.recordToken}`);
await page.getByText('สวัสดีครับคุณยายมาลี').waitFor();
await shot(page, '04-welcome');
await page.getByRole('button', { name: 'เริ่มคุยกัน' }).click();

// mic check: hears the tone -> "ได้ยินเสียงแล้ว" -> moves on by itself
await page.getByText('ได้ยินเสียงแล้วครับ').waitFor({ timeout: 10000 });
step('mic check heard the voice and auto-advanced');

// the story comes first: intro caption before question 1
await page.getByText('ไม่มีถูกไม่มีผิด').waitFor({ timeout: 15000 });
await shot(page, '05a-intro');
step('intro story shown before the first question');

for (let i = 1; i <= 3; i++) {
  const finish = page.getByRole('button', { name: 'เล่าจบแล้ว' });
  await page.getByText(`ข้อ ${i} จาก 11`).waitFor({ timeout: 40000 });
  if (i === 2) {
    // story line between questions can be skipped straight to the question
    await page.getByRole('button', { name: 'ข้ามไปที่คำถามเลย' }).click({ timeout: 15000 });
    step('skipped the story line before question 2');
  }
  await finish.and(page.locator(':not([disabled])')).waitFor({ timeout: 40000 }); // listening
  await page.waitForTimeout(1500); // "speak" for a bit
  if (i === 1) await shot(page, '05-listening');
  await finish.click();
  step(`answered question ${i}`);
}
await page.getByText('ข้อ 4 จาก 11').waitFor();

// wait for uploads to drain
for (let t = 0; t < 40; t++) {
  const s = await api(`/api/r/${created.recordToken}`);
  if (s.nextIndex === 3) break;
  await page.waitForTimeout(250);
}
const session = await api(`/api/r/${created.recordToken}`);
assert.equal(session.nextIndex, 3, 'three answers stored on the server');
step('server has 3 answers');

// skip one
await page.getByRole('button', { name: 'ข้ามข้อนี้' }).click();
await page.getByText('ข้อ 5 จาก 11').waitFor();

// ---- resume after closing the tab ----
await page.reload();
await page.getByText('มาเล่าต่อจากคราวก่อนกันนะครับ').waitFor();
step('resume message after reload');
await page.getByRole('button', { name: 'เริ่มคุยกัน' }).click();
await page.getByText('ยินดีที่ได้คุยกันอีกครั้ง', { exact: false }).waitFor({ timeout: 20000 });
await page.getByText('ข้อ 5 จาก 11').waitFor({ timeout: 20000 });
step('resumed at question 5 with the welcome-back line');
await page.close();

// ---- manage page shows progress ----
const manage = await context.newPage();
manage.on('pageerror', (e) => errors.push(e.message));
await manage.goto(`${BASE}/m/${created.manageToken}`);
await manage.getByText('ยายเล่าแล้ว 3 จาก 11 ข้อ').waitFor();
assert.equal(await manage.getByText(/✓ ยายเล่าแล้ว/).count(), 3);
await manage.getByText('ยายข้ามข้อนี้').waitFor();
await shot(manage, '07-manage-progress');
step('manage page shows 3/11 answered with per-question badges');
await manage.close();

// ---- life book ----
const book = await context.newPage();
book.on('pageerror', (e) => errors.push(e.message));
await book.goto(`${BASE}/b/${created.bookToken}`);
await book.getByRole('heading', { name: 'คุณยายมาลี' }).waitFor();
const cards = await book.locator('article').count();
assert.equal(cards, 3, 'book shows the 3 saved answers (skip hidden)');
const canAac = await book.evaluate(() => document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"'));
step(`book has ${cards} stories; chromium AAC support: "${canAac || 'no'}"`);
if (canAac) {
  await book.getByRole('button', { name: 'เล่น', exact: true }).first().click();
  await book.waitForTimeout(1500);
  const t = await book.evaluate(() => document.querySelector('article audio').currentTime);
  assert.ok(t > 0.3, `audio plays (currentTime=${t})`);
  step(`audio plays in book (t=${t.toFixed(2)}s)`);

  // the time shown on the card must move while it plays, not just the hidden element.
  // Clips here are short, so sample: some moment must show the pause button AND a time past 0:00.
  const sawCardPlaying = async (ms) => {
    for (let t = 0; t < ms; t += 150) {
      const states = await book.$$eval('article', (cards) =>
        cards.map((c) => ({ label: c.querySelector('button[aria-label]')?.getAttribute('aria-label'), time: c.querySelector('.justify-between span')?.textContent })),
      );
      if (states.some((st) => st.label === 'หยุด' && st.time !== '0:00')) return true;
      await book.waitForTimeout(150);
    }
    return false;
  };
  await book.waitForTimeout(2500); // let the first clip finish
  await book.getByRole('button', { name: 'เล่น', exact: true }).nth(1).click();
  assert.ok(await sawCardPlaying(4000), 'card time display advances while playing');
  step('card shows elapsed time while playing');

  // "เล่นทั้งเล่ม" plays through the cards themselves, so their controls follow along
  await book.waitForTimeout(2500);
  await book.getByRole('button', { name: /เล่นทั้งเล่ม/ }).click();
  assert.ok(await sawCardPlaying(10000), 'play-all moves the card time + shows pause');
  await book.getByRole('button', { name: /หยุดเล่นทั้งเล่ม/ }).click();
  step('"เล่นทั้งเล่ม" drives the card player (time + pause button visible)');
}
await shot(book, '06-book');

assert.deepEqual(errors, [], 'no page errors');
await browser.close();
console.log('E2E OK');
