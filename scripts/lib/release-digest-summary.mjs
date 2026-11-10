import { fileURLToPath } from "node:url";

/**
 * Formats and validates the immutable container image digest and tag list for
 * `$GITHUB_STEP_SUMMARY` in `.github/workflows/release.yml` (issue #375).
 */

const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/i;

export function formatReleaseDigestSummary({ digest, tags }) {
  const cleanDigest = typeof digest === "string" ? digest.trim() : "";
  if (!SHA256_DIGEST_RE.test(cleanDigest)) {
    throw new Error(
      `Invalid or missing container image digest "${cleanDigest}"; expected sha256:<64-hex>`,
    );
  }

  const tagList = (Array.isArray(tags) ? tags : String(tags ?? "").split(/\r?\n|,/))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (tagList.length === 0) {
    throw new Error("Container release summary requires at least one published image tag");
  }

  const lines = [
    "## Published Resolver Container Image",
    "",
    `- **Immutable Digest:** \`${cleanDigest.toLowerCase()}\``,
    "- **Published Tags:**",
    ...tagList.map((tag) => `  - \`${tag}\` (\`${ tag.split(":")[0] }@${cleanDigest.toLowerCase()}\`)`),
    "",
  ];

  return lines.join("\n");
}

export function verifyReleaseDigestSummaryWorkflow(workflowText) {
  const source = String(workflowText);
  const violations = [];

  if (!/id:\s*build/.test(source)) {
    violations.push("Build + push step in release.yml must declare 'id: build'");
  }
  if (!source.includes("steps.build.outputs.digest")) {
    violations.push(
      "release.yml must pass steps.build.outputs.digest to the release summary step",
    );
  }
  if (!source.includes("steps.meta.outputs.tags")) {
    violations.push(
      "release.yml must include steps.meta.outputs.tags in the release summary step",
    );
  }
  if (!source.includes("GITHUB_STEP_SUMMARY")) {
    violations.push(
      "release.yml must write the digest and tag list to $GITHUB_STEP_SUMMARY",
    );
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

if (isMain) {
  try {
    const markdown = formatReleaseDigestSummary({
      digest: process.env.IMAGE_DIGEST,
      tags: process.env.IMAGE_TAGS,
    });
    process.stdout.write(markdown);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
