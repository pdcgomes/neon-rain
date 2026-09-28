/**
 * End-to-end check of the Lab's Missions tool in headless Chrome. Needs the dev server running.
 *
 *   npm run dev            # in another terminal
 *   node scripts/lab-e2e.ts [--url http://localhost:5173]
 */
import { spawnSync } from 'node:child_process';

const i = process.argv.indexOf('--url');
const base = i >= 0 ? process.argv[i + 1] : 'http://localhost:5173';
const code = `import('/scripts/lab-e2e.browser.js').then((m) => m.run()).catch((e) => 'FAIL ' + e.stack)`;
const r = spawnSync(
  process.execPath,
  [new URL('./shot.ts', import.meta.url).pathname, '--url', `${base}/lab.html?tool=missions`, '--size', '1500x900', '--wait', '5000', '--eval', code, '--shot', '300:shots/lab-e2e.png'],
  { encoding: 'utf8' },
);
const out = `${r.stdout}${r.stderr}`;
const report = out.split('\n').filter((l) => /^(\[eval\]|PASS|FAIL|\[exception\]|\[eval error\])/.test(l));
console.log(report.join('\n'));
if (!/\[eval\]/.test(out) || /FAIL|\[exception\]|\[eval error\]/.test(out)) process.exit(1);
