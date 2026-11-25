// Runs every test suite in order and stops at the first failure. Usage: npm test (or node tests/run.mjs)
import { spawnSync } from 'node:child_process';

const suites = ['check', 'function', 'history', 'stats', 'discord', 'leaders', 'extras', 'budget', 'ui'];
for (const name of suites) {
  const r = spawnSync(process.execPath, ['--no-warnings', new URL(`./${name}.mjs`, import.meta.url).pathname], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\n✗ tests/${name}.mjs failed`); process.exit(r.status || 1); }
}
console.log(`\n✓ All ${suites.length} test suites passed`);
