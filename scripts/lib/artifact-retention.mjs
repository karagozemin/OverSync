/**
 * Scans GitHub Actions workflow YAML for `actions/upload-artifact` steps and
 * flags any evidence or Slither upload that lacks an explicit, bounded
 * `retention-days` value (issue #384).
 *
 * This is a line-based scanner rather than a full YAML parse: workflow files
 * use `${{ }}` expression syntax that isn't always friction-free through a
 * generic YAML library, and a step's boundaries (its list-item indentation)
 * are easy to track with indentation alone.
 */

const STEP_START = /^(\s*)-\s/;
const UPLOAD_ARTIFACT_USES = /uses:\s*actions\/upload-artifact@/;
const NAME_FIELD = /^\s*name:\s*(.+?)\s*$/m;
const RETENTION_FIELD = /^\s*retention-days:\s*(\S+)\s*$/m;
const EVIDENCE_OR_SLITHER = /evidence|slither/i;

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 90;

function stepBlocks(yamlText) {
  const lines = yamlText.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i].match(STEP_START);
    if (!start) {
      i++;
      continue;
    }
    const indent = start[1].length;
    const startLine = i;
    const blockLines = [lines[i]];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      if (line.trim() === "") {
        blockLines.push(line);
        j++;
        continue;
      }
      const indentMatch = line.match(/^(\s*)\S/);
      const lineIndent = indentMatch ? indentMatch[1].length : 0;
      if (lineIndent <= indent) break;
      blockLines.push(line);
      j++;
    }
    blocks.push({ text: blockLines.join("\n"), startLine });
    i = j;
  }
  return blocks;
}

function hasBoundedRetention(block) {
  const match = block.match(RETENTION_FIELD);
  if (!match) return false;
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= MIN_RETENTION_DAYS && value <= MAX_RETENTION_DAYS;
}

/**
 * @param {string} yamlText Raw contents of a workflow file.
 * @param {string} fileLabel Path used in violation messages.
 * @returns {{ file: string, line: number, artifactName: string, reason: string }[]}
 */
export function findArtifactRetentionViolations(yamlText, fileLabel) {
  const violations = [];
  for (const block of stepBlocks(yamlText)) {
    if (!UPLOAD_ARTIFACT_USES.test(block.text)) continue;

    const nameMatch = block.text.match(NAME_FIELD);
    const artifactName = nameMatch ? nameMatch[1] : "(unnamed)";
    if (!EVIDENCE_OR_SLITHER.test(artifactName)) continue;

    if (!hasBoundedRetention(block.text)) {
      const reason = RETENTION_FIELD.test(block.text)
        ? `retention-days must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`
        : "missing retention-days";
      violations.push({ file: fileLabel, line: block.startLine + 1, artifactName, reason });
    }
  }
  return violations;
}
