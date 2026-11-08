// Real input-driven playtest: mouse + keyboard only (no solved-layout shortcuts). Records video.
import { chromium } from 'playwright';
import fs from 'node:fs';
const url = process.env.URL || 'http://127.0.0.1:5172/';
const outDir = process.env.OUT || 'review/playtest';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const log = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const state = () => page.evaluate(() => window.__jelly.state());
const check = (name, ok, detail = '') => { log.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
const cell = async (c, r) => page.evaluate(([c, r]) => window.__jelly.cellToScreen(c, r), [c, r]);
const hover = async (c, r) => { const p = await cell(c, r); await page.mouse.move(p.x, p.y, { steps: 8 }); await page.waitForTimeout(150); };
const clickCell = async (c, r) => { await hover(c, r); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250); };
const waitMode = async (mode, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await state()).mode === mode) return true; await page.waitForTimeout(250); } return false; };

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#playBtn:not(.hidden)', { timeout: 30000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/00-title.png` });
await page.locator('.lvl').nth(0).click();
await page.waitForTimeout(700);
let s = await state();
check('level 1 loads in build mode', s.mode === 'build' && s.level === 'connect' && s.moves === 0);

// invalid edits
await page.click('[data-tool="belt"]');
await clickCell(3, 2); // cooler (fixed)
s = await state(); check('placing on fixed machine spends no move', s.moves === 0);
await page.click('[data-tool="erase"]');
await clickCell(6, 2); // cube press
s = await state(); check('erasing fixed machine spends no move', s.moves === 0);
await clickCell(5, 0); // empty
s = await state(); check('erasing empty tile spends no move', s.moves === 0);
// run broken layout: expect jam, no completion
await page.click('#runBtn'); await page.waitForTimeout(7500);
s = await state(); check('broken layout shows a local jam', s.blocked.length > 0 && !s.complete, JSON.stringify(s.blocked));
await page.screenshot({ path: `${outDir}/01-connect-jam.png` });
await page.click('#runBtn'); await page.waitForTimeout(300);
s = await state(); check('STOP & EDIT returns to build with counts cleared', s.mode === 'build' && s.goals['bin-blue'] === 0 && s.moves === 0);
// place the missing belt, rotate it, undo/redo
await page.click('[data-tool="belt"]');
await clickCell(4, 2);
s = await state(); check('placing belt spends one move', s.moves === 1);
await hover(4, 2); await page.keyboard.press('r');
s = await state(); check('rotating placed belt spends one move', s.moves === 2);
await page.keyboard.press('Control+z');
s = await state(); check('undo rotation refunds move', s.moves === 1);
await page.keyboard.press('Control+Shift+z');
s = await state(); check('redo reapplies rotation', s.moves === 2);
await page.keyboard.press('Control+z');
await clickCell(4, 2);
s = await state(); check('identical placement is free', s.moves === 1);
await page.screenshot({ path: `${outDir}/02-connect-built.png` });
await page.click('#runBtn');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/03-connect-running.png` });
// stop & run again mid-way: no double counting
await page.click('#runBtn'); await page.waitForTimeout(300);
await page.click('#runBtn');
const ok1 = await waitMode('complete', 40000);
s = await state();
check('CONNECT completes with exactly 6 cubes', ok1 && s.goals['bin-blue'] === 6, JSON.stringify(s.goals));
check('progress saved with stars', s.save.levels.connect?.stars === 3 && s.save.levels.connect?.bestMoves === 1, JSON.stringify(s.save.levels));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/04-connect-complete.png` });
await page.click('#nextBtn'); await page.waitForTimeout(800);

// LEVEL 2 COMBINE: rotate belt-3-3 back (ccw) and place belt at 5,3
s = await state(); check('next puzzle loads COMBINE', s.level === 'combine' && s.mode === 'build');
await page.click('#runBtn'); await page.waitForTimeout(5000);
s = await state(); check('COMBINE initial layout jams', s.blocked.length > 0, JSON.stringify(s.blocked));
await page.screenshot({ path: `${outDir}/05-combine-jam.png` });
await page.click('#runBtn'); await page.waitForTimeout(300);
await page.mouse.move(5, 400); await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/05b-combine-hint.png` });
check('repair hint shown after jam', await page.evaluate(() => !document.getElementById('tip').classList.contains('hidden') && /ROTATE TO CONNECT/.test(document.getElementById('tipText').textContent)));
await hover(3, 3); await page.keyboard.press('Shift+R');
await page.click('[data-tool="belt"]');
await clickCell(5, 3);
s = await state(); check('COMBINE repaired with 2 moves', s.moves === 2, JSON.stringify({moves: s.moves, mode: s.mode, tool: s.tool}));
await page.click('#runBtn');
await page.waitForTimeout(6000);
await page.screenshot({ path: `${outDir}/06-combine-running.png` });
const ok2 = await waitMode('complete', 60000);
s = await state(); check('COMBINE completes with 8 stars', ok2 && s.goals['bin-orange'] === 8, JSON.stringify(s.goals));
await page.waitForTimeout(1500);
await page.click('#nextBtn'); await page.waitForTimeout(800);

// LEVEL 3 OPTIMIZE
s = await state(); check('next puzzle loads OPTIMIZE', s.level === 'optimize');
await hover(9, 5); await page.keyboard.press('Shift+R');
await page.click('[data-tool="belt"]');
await clickCell(5, 3);
await clickCell(8, 8);
s = await state(); check('OPTIMIZE repaired with 3 moves', s.moves === 3);
await page.click('#runBtn');
await page.waitForTimeout(9000);
await page.screenshot({ path: `${outDir}/07-optimize-running.png` });
await page.keyboard.press('p'); await page.waitForTimeout(800);
const pausedA = (await state()).simTime; await page.waitForTimeout(800); const pausedB = (await state()).simTime;
check('pause freezes simulation', (await state()).paused && pausedA === pausedB);
await page.keyboard.press('p');
const ok3 = await waitMode('complete', 90000);
await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/07b-optimize-confetti.png` });
s = await state(); check('OPTIMIZE completes 6/6/8', ok3 && s.goals['bin-orange-a'] === 6 && s.goals['bin-orange-b'] === 6 && s.goals['bin-blue'] === 8, JSON.stringify(s.goals));
await page.waitForTimeout(1600);
await page.screenshot({ path: `${outDir}/08-optimize-complete.png` });

// restart restores initial state, progression kept
await page.click('#replayBtn'); await page.waitForTimeout(600);
s = await state();
check('restart restores initial layout and moves', s.mode === 'build' && s.moves === 0 && s.level === 'optimize');
check('progression preserved after restart', Object.keys(s.save.levels).length === 3, JSON.stringify(s.save.levels));
await page.click('#runBtn'); await page.waitForTimeout(4000);
s = await state(); check('restarted level is broken again (jam / incomplete)', !s.complete);
await page.click('#runBtn');
// resize
await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/09-resized.png` });
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
fs.writeFileSync(`${outDir}/results.json`, JSON.stringify({ when: new Date().toISOString(), url, viewport: '1280x720 (then 1600x900)', browser: 'Google Chrome (Playwright channel=chrome, headless)', checks: log, errors }, null, 2));
await ctx.close();
await browser.close();
const vids = fs.readdirSync(outDir).filter((f) => f.endsWith('.webm'));
console.log('video:', vids);
console.log(`${log.filter((l) => l.ok).length}/${log.length} passed`);
