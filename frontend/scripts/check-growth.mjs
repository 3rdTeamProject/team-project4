import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const context = { window: {} };
runInNewContext(readFileSync(new URL('../public/garden/growth.js', import.meta.url), 'utf8'), context);
const growth = context.window.GardenGrowth;
const start = '2026-01-01';
const date = days => new Date(Date.parse(start) + days * 86400000).toISOString().slice(0, 10);
for (const total of [45, 60, 85, 90, 100]) {
  const seed = { plantedAt: start, method: 'seed' };
  for (const [elapsed, expected] of [[0,1],[Math.ceil(total*.1)-1,1],[Math.ceil(total*.1),2],[Math.ceil(total*.3),3],[Math.ceil(total*.65),4],[total-1,4],[total,5],[total+10,5]]) {
    assert.equal(growth.stage(seed,total,date(elapsed)),expected);
  }
  const seedling = { ...seed, method: 'seedling' };
  assert.equal(growth.stage(seedling, total, start), 3);
  assert.equal(growth.stage(seedling, total, date(total - Math.ceil(total * .3))), 5);
}
assert.equal(growth.stage({ plantedAt: start, harvestedAt: start }, 60, start), 5);
assert.equal(growth.stage({ plantedAt: '2027-01-01' }, 60, start), 1);
console.log('Growth boundaries and seedling offsets passed.');
