import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { findVscodeTaskViolations } from './vscode-tasks.mjs';

const temporaryDirectories = [];

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vscode-task-check-'));
  temporaryDirectories.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  return root;
}

function writeTaskFile(root, filePath, content, { tracked = true } = {}) {
  const absolutePath = path.join(root, filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  if (tracked) execFileSync('git', ['add', '--', filePath], { cwd: root });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('findVscodeTaskViolations', () => {
  it('checks only tracked VS Code task files', () => {
    const root = createRepository();
    writeTaskFile(
      root,
      '.vscode/tasks.json',
      '{"tasks":[{"runOn":"folderOpen"}]}',
      { tracked: false },
    );
    writeTaskFile(
      root,
      'packages/app/.vscode/tasks.json',
      '{"tasks":[{"runOn":"folderOpen"}]}',
    );

    assert.deepEqual(findVscodeTaskViolations(root), ['packages/app/.vscode/tasks.json']);
  });

  it('detects automatic tasks in valid JSONC', () => {
    const root = createRepository();
    writeTaskFile(
      root,
      '.vscode/tasks.json',
      `{
        // Editor task configuration
        "tasks": [
          { "label": "automatic", "runOptions": { "runOn": "folderOpen", }, },
        ],
      }`,
    );

    assert.deepEqual(findVscodeTaskViolations(root), ['.vscode/tasks.json']);
  });

  it('fails closed on malformed tracked task files', () => {
    const root = createRepository();
    writeTaskFile(root, '.vscode/tasks.json', '{"tasks": [');

    assert.deepEqual(findVscodeTaskViolations(root), ['.vscode/tasks.json']);
  });

  it('fails closed when a tracked task file cannot be read', () => {
    const root = createRepository();
    writeTaskFile(root, '.vscode/tasks.json', '{"tasks": []}');
    rmSync(path.join(root, '.vscode/tasks.json'));

    assert.deepEqual(findVscodeTaskViolations(root), ['.vscode/tasks.json']);
  });
});
