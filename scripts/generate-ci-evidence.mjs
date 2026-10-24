// generate-ci-evidence.mjs
// This script collects safe CI metadata from environment variables and writes a concise evidence summary.
// It intentionally avoids including any secrets or sensitive values.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  DEFAULT_RETENTION_DAYS,
  formatCompactLicenseMarkdown,
  generateProductionLicenseReport,
} from './lib/license-report.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function getEnv(name, fallback = 'N/A') {
  return process.env[name] ?? fallback;
}

const summary = {
  commit_sha: getEnv('GITHUB_SHA'),
  workflow_name: getEnv('GITHUB_WORKFLOW'),
  workflow_run_id: getEnv('GITHUB_RUN_ID'),
  workflow_run_number: getEnv('GITHUB_RUN_NUMBER'),
  run_timestamp: new Date().toISOString(),
  ref: getEnv('GITHUB_REF'),
  branch_or_pr: getEnv('GITHUB_HEAD_REF') !== 'N/A' ? getEnv('GITHUB_HEAD_REF') : getEnv('GITHUB_REF'),
  // The following fields can be overridden via env vars if needed.
  packages_tested: getEnv('CI_PACKAGES_TESTED', 'N/A'),
  build_commands: getEnv('CI_BUILD_COMMANDS', 'N/A'),
  test_commands: getEnv('CI_TEST_COMMANDS', 'N/A'),
  overall_build_status: getEnv('JOB_STATUS') === 'success' ? 'success' : 'failure',
  overall_test_status: getEnv('JOB_STATUS') === 'success' ? 'success' : 'failure',
  artifact_links: getEnv('CI_ARTIFACT_LINKS', 'N/A'),
};

function formatMarkdown(data) {
  return `# CI Evidence Summary\n\n` +
    `- **Commit SHA:** ${data.commit_sha}\n` +
    `- **Workflow:** ${data.workflow_name}\n` +
    `- **Run ID:** ${data.workflow_run_id}\n` +
    `- **Run Number:** ${data.workflow_run_number}\n` +
    `- **Timestamp:** ${data.run_timestamp}\n` +
    `- **Ref:** ${data.ref}\n` +
    `- **Branch/PR:** ${data.branch_or_pr}\n` +
    `- **Packages/Services Tested:** ${data.packages_tested}\n` +
    `- **Build Commands:** ${data.build_commands}\n` +
    `- **Test Commands:** ${data.test_commands}\n` +
    `- **Overall Build Status:** ${data.overall_build_status}\n` +
    `- **Overall Test Status:** ${data.overall_test_status}\n` +
    `- **Artifact Links:** ${data.artifact_links}\n`;
}

const lockfileText = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');
const licenseReport = generateProductionLicenseReport({
  lockfileText,
  repoRoot,
  retentionDays: DEFAULT_RETENTION_DAYS,
});
const licenseOutputPath = resolve(process.cwd(), 'license-report.json');
writeFileSync(licenseOutputPath, `${JSON.stringify(licenseReport, null, 2)}\n`, { encoding: 'utf8' });

const markdown = `${formatMarkdown(summary)}\n${formatCompactLicenseMarkdown(licenseReport)}`;
const outputPath = resolve(process.cwd(), 'evidence-summary.md');
writeFileSync(outputPath, markdown, { encoding: 'utf8' });
console.log('CI evidence summary written to', outputPath);
