#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const DOC_FILES = [
  'README.md',
  'ROADMAP.md',
  'ARCHITECTURE.md',
  ...readdirSync(resolve(ROOT, 'docs'))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => `docs/${f}`),
];

const ALLOWLIST = [];

const LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]*)\)/g;

let exitCode = 0;
let totalChecked = 0;
let brokenCount = 0;

function err(file, link, msg) {
  console.error(`  \u274C ${file}: ${msg} (link: \`${link}\`)`);
  brokenCount++;
  exitCode = 1;
}

function anchorId(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function extractHeadings(fp) {
  try {
    const content = readFileSync(fp, 'utf-8');
    const headings = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) headings.push(anchorId(m[2]));
    }
    return headings;
  } catch {
    return null;
  }
}

function checkFile(baseFile, rawUrl) {
  let url = rawUrl.trim();
  let lineRange = null;
  const lrMatch = url.match(/^(.+):(\d+)(?:-(\d+))?$/);
  if (lrMatch) {
    url = lrMatch[1];
    lineRange = { start: parseInt(lrMatch[2]), end: lrMatch[3] ? parseInt(lrMatch[3]) : parseInt(lrMatch[2]) };
  }

  let anchor = null;
  const hashIdx = url.indexOf('#');
  if (hashIdx !== -1) {
    anchor = url.slice(hashIdx + 1);
    url = url.slice(0, hashIdx);
  }

  if (ALLOWLIST.includes(rawUrl.trim())) return;

  // Anchor-only link within the same file
  if (!url) {
    if (anchor) {
      const headings = extractHeadings(resolve(ROOT, baseFile));
      if (headings && !headings.includes(anchorId(anchor))) {
        err(baseFile, rawUrl, `Anchor "#${anchor}" not found in same file`);
      }
    }
    return;
  }

  // External URL — format validation only
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const valid = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url);
    if (!valid) err(baseFile, rawUrl, `Malformed external URL`);
    return;
  }

  // Mailto: skip
  if (url.startsWith('mailto:')) return;

  // Relative path
  const resolved = url.startsWith('/')
    ? resolve(ROOT, url.slice(1))
    : resolve(dirname(resolve(ROOT, baseFile)), url);

  if (!resolved.startsWith(ROOT)) return;

  if (!existsSync(resolved)) {
    err(baseFile, rawUrl, `File not found: ${relative(ROOT, resolved)}`);
    return;
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) return;

  if (anchor) {
    const headings = extractHeadings(resolved);
    if (headings && !headings.includes(anchorId(anchor))) {
      err(baseFile, rawUrl, `Anchor "#${anchor}" not found in ${relative(ROOT, resolved)}`);
    }
  }
}

for (const docFile of DOC_FILES) {
  const fp = resolve(ROOT, docFile);
  if (!existsSync(fp)) {
    console.error(`\u26A0 Warning: ${docFile} not found, skipping`);
    continue;
  }

  const content = readFileSync(fp, 'utf-8');
  const links = [...content.matchAll(LINK_RE)];

  console.log(`\uD83D\uDCC4 ${docFile} (${links.length} links)`);

  for (const [, , url] of links) {
    totalChecked++;
    checkFile(docFile, url);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Checked ${totalChecked} links across ${DOC_FILES.length} files`);
if (brokenCount > 0) {
  console.error(`\u2717 ${brokenCount} broken link(s) found`);
} else {
  console.log('\u2713 All links are valid');
}
console.log(`${'='.repeat(50)}`);

process.exit(exitCode);
