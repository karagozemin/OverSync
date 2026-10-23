import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function stripJsonComments(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (character === '\n' || character === '\r') {
        inLineComment = false;
        output += character;
      } else {
        output += ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (character === '*' && next === '/') {
        output += '  ';
        index += 1;
        inBlockComment = false;
      } else {
        output += character === '\n' || character === '\r' ? character : ' ';
      }
      continue;
    }

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === '/' && next === '/') {
      output += '  ';
      index += 1;
      inLineComment = true;
    } else if (character === '/' && next === '*') {
      output += '  ';
      index += 1;
      inBlockComment = true;
    } else {
      output += character;
    }
  }

  if (inBlockComment) throw new SyntaxError('Unterminated block comment');
  return output;
}

function parseJsonc(source) {
  const withoutComments = stripJsonComments(source.replace(/^\uFEFF/, ''));
  let output = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];

    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === ',') {
      let nextIndex = index + 1;
      while (/\s/.test(withoutComments[nextIndex] ?? '')) nextIndex += 1;
      if (withoutComments[nextIndex] !== '}' && withoutComments[nextIndex] !== ']') {
        output += character;
      } else {
        output += ' ';
      }
    } else {
      output += character;
    }
  }

  return JSON.parse(output);
}

function isTaskFile(filePath) {
  return /(^|\/)\.vscode\/tasks\.json$/.test(filePath);
}

export function findVscodeTaskViolations(root) {
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((filePath) => filePath && isTaskFile(filePath));

  const violations = [];

  for (const filePath of trackedFiles) {
    try {
      const parsed = parseJsonc(readFileSync(path.join(root, filePath), 'utf8'));
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        !Array.isArray(parsed.tasks) ||
        parsed.tasks.some(
          (task) => task === null || typeof task !== 'object' || Array.isArray(task),
        ) ||
        parsed.tasks.some(
          (task) =>
            task.runOptions !== undefined &&
            (task.runOptions === null ||
              typeof task.runOptions !== 'object' ||
              Array.isArray(task.runOptions)),
        )
      ) {
        throw new SyntaxError('Invalid VS Code tasks configuration');
      }

      if (
        parsed.tasks.some(
          (task) =>
            task.runOn === 'folderOpen' ||
            task.runOptions?.runOn === 'folderOpen',
        )
      ) {
        violations.push(filePath);
      }
    } catch {
      violations.push(filePath);
    }
  }

  return [...new Set(violations)];
}
