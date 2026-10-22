/**
 * Duplicate-key detection for dotenv-style files (issue #355).
 *
 * `env.example` once declared `DATABASE_URL` twice — once in the coordinator
 * section and once under a stray "Persistence" comment. Both lines were
 * identical, so nothing broke, but an operator editing one copy would silently
 * lose the change to the other, and reviewers could no longer tell which value
 * deployment actually picked up.
 *
 * This module never touches the filesystem: it takes already-read content and
 * reports duplicates, so the same rules can be exercised by tests and by the
 * CLI in `../check-env-docs.mjs`.
 */

/** A key we track: an upper-case env-style identifier (`FOO`, `VITE_BAR_1`). */
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Every declared key in a dotenv-style document, in file order.
 *
 * Blank lines, comments (including indented ones, and commented-out example
 * keys like `#   INFURA_API_KEY=...`) and lines without `=` are ignored, and
 * keys that are not upper-case env-style identifiers are skipped, matching how
 * `check-env-docs.mjs` documents env vars.
 *
 * @param {string} content
 * @returns {{ name: string, line: number }[]} 1-based line numbers.
 */
export function parseEnvKeys(content) {
  const keys = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    if (ENV_KEY.test(name)) {
      keys.push({ name, line: i + 1 });
    }
  }

  return keys;
}

/**
 * Keys declared more than once, so callers can fail instead of silently
 * collapsing them the way a `Set` would.
 *
 * @param {string} content
 * @returns {{ name: string, lines: number[] }[]}
 */
export function findDuplicateEnvKeys(content) {
  const occurrences = new Map();

  for (const { name, line } of parseEnvKeys(content)) {
    if (!occurrences.has(name)) occurrences.set(name, []);
    occurrences.get(name).push(line);
  }

  return [...occurrences.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([name, lines]) => ({ name, lines }));
}
