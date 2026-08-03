/**
 * Zero-dependency test harness for the frontend's pure logic.
 *
 * The frontend has no test runner of its own and these tests only exercise
 * plain functions (no DOM, no React), so they run straight through `tsx`
 * rather than pulling in a framework. Imports use relative paths instead of
 * the `@/` alias so no bundler-style resolution is needed either.
 */

export interface Finding {
  suite: string;
  test: string;
  detail: string;
}

export const results = { passed: 0, failed: 0, findings: [] as Finding[] };
let currentSuite = 'general';

export function suite(name: string): void {
  currentSuite = name;
  console.log(`\n=== ${name} ===`);
}

export function check(name: string, condition: boolean, detail = ''): boolean {
  if (condition) {
    results.passed++;
    console.log(`  PASS  ${name}`);
    return true;
  }
  results.failed++;
  results.findings.push({ suite: currentSuite, test: name, detail });
  console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  return false;
}

export function eq<T>(name: string, actual: T, expected: T): boolean {
  return check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Prints the tally. Exits the process unless the aggregator (run-all.ts) is driving. */
export function summary({ exit = true } = {}): void {
  console.log(`\n---------------------------------------------`);
  console.log(`passed=${results.passed} failed=${results.failed}`);
  if (results.findings.length) {
    console.log(`\nFINDINGS:`);
    for (const f of results.findings) console.log(`  [${f.suite}] ${f.test}\n      ${f.detail}`);
  }
  if (exit) process.exit(results.failed > 0 ? 1 : 0);
}

export function resetResults(): void {
  results.passed = 0;
  results.failed = 0;
  results.findings.length = 0;
}

/** True when this module was executed directly rather than imported by run-all.ts. */
export function isEntrypoint(moduleUrl: string): boolean {
  return process.argv[1] != null && moduleUrl.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() ?? '');
}

/** Deterministic PRNG so a failing randomized case can be reproduced exactly. */
export function makeRandom(seed: number) {
  let s = seed;
  return {
    next(): number {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    },
    int(min: number, max: number): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(this.next() * arr.length)];
    },
  };
}
