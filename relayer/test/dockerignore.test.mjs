import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { test } from 'node:test';

const patterns = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

// The policy uses simple Docker globs without negations. Check each path and
// its parent directories, since ignoring a directory excludes its contents.
function isIgnored(file) {
  const parts = file.split('/');
  return parts.some((_, index) => {
    const path = parts.slice(0, index + 1).join('/');
    return patterns.some((pattern) => matchesGlob(path, pattern));
  });
}

test('relayer build context excludes local state and workspace files', () => {
  assert.ok(!patterns.some((pattern) => pattern.startsWith('!')));

  for (const file of [
    '.env', 'src/.env.local', 'src/secrets/key.txt', 'src/operator.pem',
    'orders.db', 'data/orders.db-wal', 'data/orders.sqlite',
    'data/orders.sqlite3-shm', 'relay-submissions.json',
    'relay-submissions.json.123.tmp', 'event-history/events.json',
    'logs/relayer.log', 'logs/relayer.log.1', 'src/nested/error.log',
    'node_modules/pkg/index.js', 'src/node_modules/pkg/index.js',
    'dist/index.js', '.cache/build.json', '.pnpm-store/pkg',
    'coverage/report.html', 'tmp/debug.txt', 'test/unit.test.ts',
    '.git/config', '.vscode/settings.json',
  ]) {
    assert.ok(isIgnored(file), `Build context includes ${file}`);
  }
});

test('relayer Dockerfile inputs remain in the build context', () => {
  for (const file of ['Dockerfile', 'package.json', 'tsconfig.json', 'src/index.ts']) {
    assert.ok(!isIgnored(file), `Dockerfile input is ignored: ${file}`);
  }
});
