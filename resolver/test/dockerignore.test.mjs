import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const rules = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

function isIgnored(path) {
  return rules.some((rule) => {
    assert.match(rule, /^[\w.*-]+$/, `unsupported Docker ignore rule: ${rule}`);
    const pattern = rule.replaceAll('.', '\\.').replaceAll('*', '[^/]*');
    return new RegExp(`^${pattern}(?:/|$)`).test(path);
  });
}

test('resolver Docker context excludes local files and generated artifacts', () => {
  for (const path of [
    '.git/config', '.env', '.env.local', 'operator.env', 'operator.env.local',
    'node_modules/pkg/index.js', 'dist/index.js', 'coverage/index.html',
    '.coverage/data', '.nyc_output/data', 'coverage.lcov', '.cache/data',
    '.eslintcache', '.turbo/data', '.pnpm-store/data', 'tsconfig.tsbuildinfo',
    '.vscode/tasks.json', '.idea/workspace.xml', 'operator.code-workspace',
    '.DS_Store', 'debug.log', 'tmp/data', 'temp/data'
  ]) {
    assert.ok(isIgnored(path), `${path} would enter the Docker context`);
  }
});

test('resolver Dockerfile inputs remain in the build context', () => {
  for (const input of ['Dockerfile', 'package.json', 'tsconfig.json', 'src/index.ts']) {
    assert.ok(!isIgnored(input), `${input} is excluded`);
  }
});
