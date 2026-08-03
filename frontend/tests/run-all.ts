/**
 * Runs every frontend test file in one process and reports a combined tally.
 *
 *   npm run test          (from frontend/)
 *
 * Individual files also run standalone:
 *   npx --prefix ../server tsx --tsconfig tsconfig.app.json tests/pricing.test.ts
 */
import { results } from './harness.js';
import { run as runPricing } from './pricing.test.js';
import { run as runCheckout } from './checkout-math.test.js';

const SUITES: { name: string; run: (standalone?: boolean) => void }[] = [
  { name: 'pricing.test.ts', run: runPricing },
  { name: 'checkout-math.test.ts', run: runCheckout },
];

let totalPassed = 0;
let totalFailed = 0;
const allFindings: string[] = [];

for (const suite of SUITES) {
  console.log(`\n############ ${suite.name} ############`);
  suite.run(false);
  totalPassed += results.passed;
  totalFailed += results.failed;
  for (const f of results.findings) allFindings.push(`${suite.name} > ${f.suite} > ${f.test}: ${f.detail}`);
}

console.log(`\n=============================================`);
console.log(`FRONTEND TOTAL  passed=${totalPassed} failed=${totalFailed}`);
if (allFindings.length) {
  console.log(`\nFINDINGS:`);
  for (const f of allFindings) console.log(`  - ${f}`);
}
process.exit(totalFailed > 0 ? 1 : 0);
