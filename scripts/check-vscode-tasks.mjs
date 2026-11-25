#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { findVscodeTaskViolations } from './lib/vscode-tasks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

try {
  const paths = findVscodeTaskViolations(root);
  if (paths.length > 0) {
    for (const filePath of paths) console.error(filePath);
    process.exitCode = 1;
  } else {
    console.log('No tracked VS Code tasks with runOn: folderOpen found.');
  }
} catch (error) {
  console.error(`Unable to check tracked VS Code task files: ${error.message}`);
  process.exitCode = 1;
}
