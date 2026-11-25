/**
 * Checks that CI builds the Soroban contracts from the committed lockfile.
 *
 * A workflow that resolves dependencies at run time (`cargo update`,
 * `cargo generate-lockfile`) tests a dependency graph nobody reviewed, and one
 * that runs Cargo without `--locked` lets the graph drift silently. These
 * helpers read workflow text and Cargo files as plain text, so they need no
 * YAML or TOML parser and run under `node --test` like the other scripts here.
 */

/** Subcommands that change the resolved graph, so they have no place in CI. */
export const GRAPH_CHANGING_SUBCOMMANDS = new Set(["update", "generate-lockfile"]);

/** Subcommands that resolve dependencies and so must run with `--locked`. */
export const LOCK_REQUIRED_SUBCOMMANDS = new Set([
  "bench",
  "build",
  "b",
  "check",
  "c",
  "clippy",
  "doc",
  "d",
  "fetch",
  "install",
  "metadata",
  "run",
  "r",
  "rustc",
  "rustdoc",
  "test",
  "t",
  "tree",
  "vendor",
]);

/** The wasm build wrapper has no `--locked` flag, so it needs a guard before it. */
const CONTRACT_BUILD = /(^|[\s;&|(])(stellar|soroban)\s+contract\s+build\b/;

/**
 * The shell command lines of every `run:` step in a workflow, with the line
 * number each started on. Backslash continuations are joined; comments dropped.
 */
export function workflowCommands(text) {
  const lines = text.split(/\r?\n/);
  const commands = [];
  let blockIndent = null;

  const push = (start, raw) => {
    const command = raw.replace(/(^|\s)#.*$/, "").trim();
    if (command) commands.push({ line: start + 1, command });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;

    if (blockIndent !== null) {
      if (line.trim() === "") continue;
      if (indent > blockIndent) {
        let joined = line.trim();
        const start = i;
        while (joined.endsWith("\\") && i + 1 < lines.length) {
          i += 1;
          joined = `${joined.slice(0, -1).trim()} ${lines[i].trim()}`;
        }
        push(start, joined);
        continue;
      }
      blockIndent = null;
    }

    const step = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (!step) continue;
    const value = step[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      blockIndent = step[1].length + (line.trimStart().startsWith("-") ? 2 : 0);
    } else if (value) {
      push(i, value);
    }
  }
  return commands;
}

/** The `cargo` invocations in one command line, split on `&&`, `||`, `;` and `|`. */
function cargoInvocations(command) {
  const found = [];
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    const match = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*cargo\s+(.*)$/.exec(segment);
    if (!match) continue;
    // Cargo accepts global flags before the subcommand (`cargo --locked test`).
    const tokens = match[1].trim().split(/\s+/);
    const subcommand = tokens.find((token) => !token.startsWith("-") && !token.startsWith("+"));
    if (subcommand) found.push({ subcommand, args: tokens.join(" ") });
  }
  return found;
}

/**
 * Whether Cargo itself was given --locked or --frozen. Anything after a bare
 * `--` belongs to the program Cargo runs, such as the test binary.
 */
const isLocked = (args) => /(^|\s)--(locked|frozen)(\s|=|$)/.test(args.split(/\s--(?:\s|$)/)[0]);

/**
 * Problems in one workflow file. Each is `{ file, line, message }`; an empty
 * list means every Cargo call is locked and nothing re-resolves the graph.
 */
export function findCargoViolations(file, text) {
  const violations = [];
  let lockedGuardSeen = false;

  for (const { line, command } of workflowCommands(text)) {
    for (const { subcommand, args } of cargoInvocations(command)) {
      if (GRAPH_CHANGING_SUBCOMMANDS.has(subcommand)) {
        violations.push({
          file,
          line,
          message:
            `\`cargo ${subcommand}\` changes the dependency graph at run time. ` +
            "Commit the lockfile instead and update it in a reviewed change.",
        });
      } else if (LOCK_REQUIRED_SUBCOMMANDS.has(subcommand)) {
        // A locked `cargo install` pins the installed tool's own lockfile, not
        // this workspace's, so it is no guard for the contract build.
        if (isLocked(args)) lockedGuardSeen ||= subcommand !== "install";
        else {
          violations.push({
            file,
            line,
            message: `\`cargo ${subcommand}\` must run with --locked so it cannot change Cargo.lock.`,
          });
        }
      }
    }

    if (CONTRACT_BUILD.test(command) && !lockedGuardSeen) {
      violations.push({
        file,
        line,
        message:
          "`stellar contract build` takes no --locked flag; run a locked Cargo command " +
          "(for example `cargo metadata --locked`) earlier in the workflow so a stale lockfile fails first.",
      });
    }
  }
  return violations;
}

/** Name and version of every `[[package]]` in a Cargo.lock. */
export function lockedPackages(lockText) {
  const packages = [];
  const pattern = /\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g;
  for (const match of lockText.matchAll(pattern)) packages.push({ name: match[1], version: match[2] });
  return packages;
}

/** Exact (`=x.y.z`) requirements in a manifest's `[workspace.dependencies]`. */
export function exactWorkspacePins(manifestText) {
  const section = /\[workspace\.dependencies\]\r?\n([\s\S]*?)(?=\r?\n\[|$)/.exec(manifestText);
  if (!section) return [];
  const pins = [];
  for (const line of section[1].split(/\r?\n/)) {
    const entry = /^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"=([^"]+)"|\{[^}]*version\s*=\s*"=([^"]+)")/.exec(line);
    if (entry) pins.push({ name: entry[1], version: entry[2] ?? entry[3] });
  }
  return pins;
}

/**
 * Whether the lockfile agrees with the exact pins in the manifest: each pinned
 * crate must be locked at that version and at no other. Returns messages.
 */
export function findLockfileProblems(manifestText, lockText) {
  const problems = [];
  const locked = lockedPackages(lockText);
  if (locked.length === 0) return ["Cargo.lock lists no packages."];

  for (const pin of exactWorkspacePins(manifestText)) {
    const versions = locked.filter((p) => p.name === pin.name).map((p) => p.version);
    if (versions.length === 0) {
      problems.push(`${pin.name} is pinned to =${pin.version} in Cargo.toml but is missing from Cargo.lock.`);
    } else if (versions.length !== 1 || versions[0] !== pin.version) {
      problems.push(
        `${pin.name} is pinned to =${pin.version} in Cargo.toml but Cargo.lock resolves ${versions.join(", ")}.`,
      );
    }
  }
  return problems;
}

/** Whether any ignore file would stop git tracking a Cargo.lock. */
export function ignoresCargoLock(ignoreTexts) {
  const pattern = /^(?:\/|\*\*\/|[\w./-]+\/)?(?:Cargo\.lock|\*\.lock)$/;
  return ignoreTexts.some((text) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => line && !line.startsWith("#") && !line.startsWith("!") && pattern.test(line)),
  );
}
