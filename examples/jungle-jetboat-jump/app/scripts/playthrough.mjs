// Full input-driven playthrough in headless Chrome. All control goes through real (CDP-trusted) keyboard events —
// the same path as a human player. The pilot only *reads* state to decide which keys to hold.
// Usage: node scripts/playthrough.mjs [url] [outdir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:5171/';
const outdir = process.argv[3] || 'review/playthrough';
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outdir, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const log = [];
const note = (m) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(l); log.push(l); };
page.on('console', m => { if (m.type() === 'error') note('console error: ' + m.text()); });
page.on('pageerror', e => note('page error: ' + e.message));
const failed = [];
page.on('requestfailed', r => failed.push(r.url()));
await page.goto(url);
await page.waitForFunction(() => window.__jjj && window.__jjj.ui === 'title', null, { timeout: 90000 });
note('title screen shown');
await page.screenshot({ path: `${outdir}/01-title.png` });

const held = new Set();
async function hold(keys) {
  for (const k of [...held]) if (!keys.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
const state = () => page.evaluate(() => {
  const s = __jjj.session, b = s.boat, c = s.course;
  const next = s.tokens.find(t => !t.collected && t.s > s.progressS + 4 && t.s < s.progressS + 26);
  const j = c.jump;
  return { ui: __jjj.ui, phase: s.phase, s: s.progressS, lat: s.lateral, x: b.x, z: b.z, h: b.heading, sp: b.speed, boost: b.boost, air: b.airborne,
    time: s.time, score: s.liveScore, gates: s.gatesPassed, suns: s.suns, hits: s.hits, rec: s.recoveries, L: c.length,
    nextLat: next ? next.lateral : null, rampEnd: j.rampEndS, rampLen: j.rampLength, finishS: s.finishS,
    hw: s.channelHalfWidth(s.progressS) };
});
const aim = (s, lat) => page.evaluate(([s, lat]) => { const p = __jjj.session.course.toWorld(s, lat); return [p.x, p.z]; }, [s, lat]);

async function drive(maxSec, label, opts = {}) {
  const t0 = Date.now(); let st; let shots = 0;
  const shotAt = opts.shotAt || [];
  while ((Date.now() - t0) / 1000 < maxSec) {
    st = await state();
    if (st.phase === 'finished' || st.ui === 'results') break;
    if (opts.until && opts.until(st)) break;
    const nearRamp = st.s > st.rampEnd - st.rampLen - 45 && st.s < st.rampEnd + 30;
    let tLat = nearRamp ? 0 : (st.nextLat ?? 0);
    tLat = Math.max(-st.hw + 2.5, Math.min(st.hw - 2.5, tLat));
    const look = st.air ? 16 : 9;
    const [px, pz] = await aim(st.s + look, tLat);
    const want = Math.atan2(px - st.x, pz - st.z);
    let e = want - st.h; e = Math.atan2(Math.sin(e), Math.cos(e));
    const keys = new Set(['KeyW']);
    if (e > 0.04) keys.add('KeyA'); else if (e < -0.04) keys.add('KeyD');
    if ((st.boost > 40 && Math.abs(e) < 0.12 && !st.air) || (nearRamp && st.s < st.rampEnd && st.boost > 5)) keys.add('ShiftLeft');
    await hold(keys);
    if (shotAt.length && shots < shotAt.length && st.s >= shotAt[shots][0]) { await page.screenshot({ path: `${outdir}/${shotAt[shots][1]}.png` }); shots++; }
    await page.waitForTimeout(40);
  }
  await hold(new Set());
  return st;
}

// ---- run 1: full course from the title using Enter ----
await page.keyboard.press('Enter');
await page.waitForFunction(() => __jjj.session.phase === 'running', null, { timeout: 20000 });
note('countdown done, driving');
// pause/blur checks mid-run
let st = await drive(8, 'opening');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const paused = await page.evaluate(() => ({ ui: __jjj.ui, t: __jjj.session.time }));
await page.screenshot({ path: `${outdir}/02-pause.png` });
await page.waitForTimeout(1200);
const paused2 = await page.evaluate(() => __jjj.session.time);
note(`pause: ui=${paused.ui} timer frozen=${Math.abs(paused2 - paused.t) < 1e-6}`);
await page.keyboard.press('Escape');
await page.keyboard.press('KeyM'); await page.waitForTimeout(600);
await page.screenshot({ path: `${outdir}/03-route-map.png` });
await page.keyboard.press('KeyM');
st = await drive(200, 'course', { shotAt: [[190, '04-flower-bend'], [380, '05-rock-slalom'], [578, '06-rapid-steps'], [718, '07-ramp-approach'], [734, '08-airborne'], [800, '09-after-leap'], [1030, '10-finish-lagoon']] });
note(`run1 end: phase=${st.phase} time=${st.time.toFixed(2)} score=${st.score} gates=${st.gates} suns=${st.suns} hits=${st.hits} recoveries=${st.rec}`);
await page.waitForFunction(() => __jjj.ui === 'results', null, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${outdir}/11-results.png` });
const res1 = await page.evaluate(() => ({ ...__jjj.session.results, crew: __jjj.boatView.crewCount, loops: __jjj.audio.activeLoops, stats: __jjj.stats(), save: localStorage.getItem('jungle-jetboat-jump.save') }));
note('results1 ' + JSON.stringify(res1));

// ---- restart with R from results; verify clean state, cockpit view, then retry mid-air from pause ----
await page.keyboard.press('KeyR');
await page.waitForFunction(() => __jjj.session.phase === 'countdown' || __jjj.session.phase === 'running', null, { timeout: 15000 });
const fresh = await page.evaluate(() => { const s = __jjj.session; return { time: s.time, suns: s.suns, gates: s.gatesPassed, hits: s.hits, score: s.liveScore, boost: s.boat.boost, loops: __jjj.audio.activeLoops, tokensLeft: s.tokens.filter(t => !t.collected).length, s: s.progressS.toFixed(1) }; });
note('after restart ' + JSON.stringify(fresh));
await page.waitForFunction(() => __jjj.session.phase === 'running', null, { timeout: 15000 });
await page.keyboard.press('KeyC');
st = await drive(5, 'cockpit');
await page.screenshot({ path: `${outdir}/12-cockpit.png` });
await page.keyboard.press('KeyC');
st = await drive(200, 'to-air', { until: s => s.air });
await page.screenshot({ path: `${outdir}/13-midair.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('KeyR');
await page.waitForFunction(() => __jjj.session.phase === 'countdown', null, { timeout: 15000 });
await page.waitForFunction(() => __jjj.session.phase === 'running', null, { timeout: 15000 });
const fresh2 = await page.evaluate(() => { const s = __jjj.session; return { time: s.time.toFixed(2), air: s.boat.airborne, suns: s.suns, gates: s.gatesPassed, loops: __jjj.audio.activeLoops, s: s.progressS.toFixed(1), landing: s.landingAwarded }; });
note('after mid-air retry ' + JSON.stringify(fresh2));

// ---- run 2: full course again ----
st = await drive(200, 'run2');
await page.waitForFunction(() => __jjj.ui === 'results', null, { timeout: 15000 });
const res2 = await page.evaluate(() => ({ ...__jjj.session.results, loops: __jjj.audio.activeLoops, stats: __jjj.stats(), plays: Object.fromEntries(__jjj.audio.playCount) }));
note('results2 ' + JSON.stringify(res2));
await page.screenshot({ path: `${outdir}/14-results-run2.png` });
note('failed requests: ' + JSON.stringify(failed));
const video = await page.video().path();
await ctx.close(); await browser.close();
fs.writeFileSync(`${outdir}/playthrough-log.txt`, log.join('\n') + '\n');
fs.renameSync(video, `${outdir}/playthrough.webm`);
console.log('video', `${outdir}/playthrough.webm`);
