import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedStep, OnceLedger, sweepCircle, damp, InputState, seededRandom } from '../skills/reference-to-game/assets/runtime/core.mjs';
test('simulation is invariant to render cadence', () => {
  for (const hz of [30, 60, 120, 144]) {
    const clock = new FixedStep(); let distance = 0;
    for (let i = 0; i < hz * 10; i++) clock.advance(1 / hz, dt => distance += 7 * dt);
    assert.ok(Math.abs(distance - 70) < 1e-8);
  }
});
test('long stalls are bounded and reset removes accumulated time', () => {
  const clock = new FixedStep(); let steps = 0; clock.advance(300, () => steps++); assert.equal(steps, 8);
  clock.reset(); assert.equal(clock.time, 0); assert.equal(clock.accumulator, 0);
  assert.throws(() => clock.advance(NaN, () => {}));
});
test('stable rewards cannot double count and reset clears them', () => {
  const ledger = new OnceLedger(); assert.equal(ledger.claim('token-2'), true); assert.equal(ledger.claim('token-2'), false);
  assert.deepEqual(new OnceLedger(ledger.snapshot()).snapshot(), ['token-2']); ledger.reset(); assert.equal(ledger.claim('token-2'), true);
});
test('sweep catches fast tunneling, tangency and initial overlap', () => {
  assert.equal(sweepCircle([-10,0],[10,0],[0,0],1), .45);
  assert.equal(sweepCircle([-1,1],[1,1],[0,0],1), .5);
  assert.equal(sweepCircle([0,0],[0,0],[0,0],1), 0);
  assert.equal(sweepCircle([-2,2],[2,2],[0,0],1), null);
});
test('damping half-life composes across frames', () => {
  assert.equal(damp(0,10,1,1),5); let x=0;for(let i=0;i<60;i++)x=damp(x,10,1,1/60);
  assert.ok(Math.abs(x-5)<1e-9);
});
test('blur clears held inputs; dispose removes listeners', () => {
  const target = new EventTarget(), doc = new EventTarget(); let suspended=0;
  const input = new InputState(target,doc,()=>suspended++);
  const key=new Event('keydown');Object.defineProperty(key,'code',{value:'Space'});target.dispatchEvent(key);
  assert.ok(input.held.has('Space'));assert.equal(input.consume('Space'),true);assert.equal(input.consume('Space'),false);
  target.dispatchEvent(new Event('blur'));assert.equal(input.held.size,0);assert.equal(suspended,1);
  input.dispose();target.dispatchEvent(key);assert.equal(input.held.size,0);
});
test('scenery seed is repeatable and independent', () => {
  const a=seededRandom(42),b=seededRandom(42),c=seededRandom(43);
  const aa=Array.from({length:30},a);assert.deepEqual(aa,Array.from({length:30},b));assert.notDeepEqual(aa,Array.from({length:30},c));assert.ok(aa.every(x=>x>=0&&x<1));
});
