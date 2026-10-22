import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  exactWorkspacePins,
  findCargoViolations,
  findLockfileProblems,
  ignoresCargoLock,
  lockedPackages,
  workflowCommands,
} from "./cargo-locked.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFileSync(resolve(repoRoot, path), "utf8");

/** The Soroban steps of ci.yml as they were before the lockfile was trusted. */
const OLD_CI = `
jobs:
  soroban:
    steps:
      - name: Install Stellar CLI
        run: |
          cargo install --locked stellar-cli --version 22.8.1
          stellar --version
      - name: Install Stellar CLI
        run: |
          cargo binstall -y stellar-cli --version 22.8.1
          stellar --version
      - name: Who needs ed25519-dalek 3.0.0
        run: cargo tree -i ed25519-dalek@3.0.0
        continue-on-error: true
      - name: Pin ed25519-dalek to 2.x
        run: cargo update -p ed25519-dalek@3.0.0 --precise 2.2.0
      - name: Build WASM
        run: stellar contract build
      - name: Pin ed25519-dalek to the 2.x line
        run: |
          cargo generate-lockfile
          cargo update -p ed25519-dalek@3.0.0 --precise 2.2.0
      - name: Run unit tests
        run: cargo test --release
`;

describe("workflowCommands", () => {
  it("reads inline, block and dash-prefixed run steps with their line numbers", () => {
    const text = [
      "steps:",
      "  - run: cargo build --locked", // 2
      "  - name: Two",
      "    run: |",
      "      cargo test --locked", // 5
      "",
      "      cargo tree --locked", // 7
      "  - name: Three",
      "    run: cargo fetch --locked", // 9
    ].join("\n");

    assert.deepEqual(workflowCommands(text), [
      { line: 2, command: "cargo build --locked" },
      { line: 5, command: "cargo test --locked" },
      { line: 7, command: "cargo tree --locked" },
      { line: 9, command: "cargo fetch --locked" },
    ]);
  });

  it("ignores comments, step names and keys that merely mention cargo", () => {
    const text = [
      "# cargo update is not allowed",
      "steps:",
      "  - name: cargo update the lock",
      "    uses: cargo-bins/cargo-binstall@main",
      "    with:",
      "      key: cargo update",
      "  - run: |",
      "      # cargo generate-lockfile",
      "      echo hi # cargo update",
    ].join("\n");

    assert.deepEqual(workflowCommands(text), [{ line: 9, command: "echo hi" }]);
  });

  it("joins a command continued with a backslash", () => {
    const text = ["run: |", "  cargo test \\", "    --release \\", "    --locked", "  echo done"].join("\n");

    assert.deepEqual(workflowCommands(text), [
      { line: 2, command: "cargo test --release --locked" },
      { line: 5, command: "echo done" },
    ]);
  });
});

describe("findCargoViolations", () => {
  const run = (command) => findCargoViolations("ci.yml", `run: ${command}`);

  it("rejects commands that change the dependency graph", () => {
    for (const command of [
      "cargo update",
      "cargo update -p ed25519-dalek@3.0.0 --precise 2.2.0",
      "cargo generate-lockfile",
      "cargo +1.86.0 update",
    ]) {
      const [violation, ...rest] = run(command);
      assert.match(violation.message, /changes the dependency graph/, command);
      assert.equal(rest.length, 0, command);
    }
  });

  it("requires --locked on every Cargo command that resolves dependencies", () => {
    for (const sub of ["build", "test", "check", "clippy", "doc", "run", "fetch", "tree", "metadata", "install", "bench"]) {
      assert.equal(run(`cargo ${sub} --release`).length, 1, sub);
      assert.equal(run(`cargo ${sub} --release --locked`).length, 0, sub);
    }
  });

  it("accepts --frozen as well, and the flag before or after the subcommand", () => {
    assert.deepEqual(run("cargo test --frozen"), []);
    assert.deepEqual(run("cargo --locked test"), []);
    assert.deepEqual(run("cargo +1.86.0 --locked --offline fetch"), []);
    assert.deepEqual(run("cargo test --release --locked -- --nocapture"), []);
  });

  it("does not take a --locked meant for the test binary as Cargo's", () => {
    assert.equal(run("cargo test -- --locked").length, 1);
    assert.equal(run("cargo run --release -- --locked").length, 1);
  });

  it("checks each command of a chain and ignores tools that are not Cargo subcommands", () => {
    assert.equal(run("cd soroban && cargo test --release").length, 1);
    assert.equal(run("cargo test --locked && cargo build").length, 1);
    assert.deepEqual(run("cargo fmt --check"), []);
    assert.deepEqual(run("cargo binstall -y stellar-cli --version 22.8.1"), []);
    assert.deepEqual(run("cargo audit"), []);
    assert.deepEqual(run("echo cargo update"), []);
  });

  it("allows an environment prefix and a toolchain selector", () => {
    assert.deepEqual(run("RUSTFLAGS=-Dwarnings cargo +1.86.0 test --locked"), []);
    assert.equal(run("RUSTFLAGS=-Dwarnings cargo +1.86.0 test").length, 1);
  });

  it("wants a locked Cargo command before `stellar contract build`", () => {
    const unguarded = findCargoViolations("ci.yml", "run: stellar contract build");
    assert.equal(unguarded.length, 1);
    assert.match(unguarded[0].message, /no --locked flag/);

    const guarded = findCargoViolations(
      "ci.yml",
      ["- run: cargo metadata --locked --format-version 1 > /dev/null", "- run: stellar contract build"].join("\n"),
    );
    assert.deepEqual(guarded, []);
  });

  it("does not count a locked `cargo install` as a guard, and the guard must come first", () => {
    const afterInstall = findCargoViolations(
      "ci.yml",
      ["- run: cargo install --locked stellar-cli", "- run: stellar contract build"].join("\n"),
    );
    assert.equal(afterInstall.length, 1);

    const guardAfter = findCargoViolations(
      "ci.yml",
      ["- run: stellar contract build", "- run: cargo metadata --locked"].join("\n"),
    );
    assert.equal(guardAfter.length, 1);
    assert.equal(guardAfter[0].line, 1);
  });

  it("reports the file and the line of each violation", () => {
    const [violation] = findCargoViolations("a.yml", "jobs:\n  x:\n    steps:\n      - run: cargo build");

    assert.equal(violation.file, "a.yml");
    assert.equal(violation.line, 4);
  });

  it("flags every problem in the workflow as it was before the lockfile was trusted", () => {
    const violations = findCargoViolations("ci.yml", OLD_CI);

    assert.deepEqual(
      violations.map((v) => v.message.match(/`(cargo \w[\w-]*|stellar contract build)`/)?.[1]),
      ["cargo tree", "cargo update", "stellar contract build", "cargo generate-lockfile", "cargo update", "cargo test"],
    );
  });
});

describe("Cargo.lock against the manifest", () => {
  const manifest = (deps) =>
    `[workspace]\nmembers = ["a"]\n\n[workspace.dependencies]\n${[deps].flat().join("\n")}\n\n[profile.release]\nlto = true\n`;
  const lock = (...packages) => packages.map(([n, v]) => `[[package]]\nname = "${n}"\nversion = "${v}"\n`).join("\n");

  it("reads exact pins, in both spellings, and skips ranges", () => {
    assert.deepEqual(
      exactWorkspacePins(
        manifest(['soroban-sdk = "22.0.8"', 'ed25519-dalek = "=2.2.0"', 'rand = { version = "=0.8.5", default-features = false }']),
      ),
      [
        { name: "ed25519-dalek", version: "2.2.0" },
        { name: "rand", version: "0.8.5" },
      ],
    );
    assert.deepEqual(exactWorkspacePins("[package]\nname = \"x\"\n"), []);
  });

  it("reads the packages of a lockfile", () => {
    assert.deepEqual(lockedPackages(lock(["a", "1.0.0"], ["b", "2.1.0"])), [
      { name: "a", version: "1.0.0" },
      { name: "b", version: "2.1.0" },
    ]);
  });

  it("is satisfied when each pin is locked at exactly that version", () => {
    assert.deepEqual(findLockfileProblems(manifest('ed25519-dalek = "=2.2.0"'), lock(["ed25519-dalek", "2.2.0"], ["x", "1.0.0"])), []);
  });

  it("names a pin the lockfile resolves differently, such as the 3.x release", () => {
    const problems = findLockfileProblems(manifest('ed25519-dalek = "=2.2.0"'), lock(["ed25519-dalek", "3.0.0"]));

    assert.deepEqual(problems, ["ed25519-dalek is pinned to =2.2.0 in Cargo.toml but Cargo.lock resolves 3.0.0."]);
  });

  it("flags a second version of a pinned crate and a missing one", () => {
    const two = findLockfileProblems(manifest('ed25519-dalek = "=2.2.0"'), lock(["ed25519-dalek", "2.2.0"], ["ed25519-dalek", "3.0.0"]));
    assert.match(two[0], /resolves 2\.2\.0, 3\.0\.0/);

    const missing = findLockfileProblems(manifest('ed25519-dalek = "=2.2.0"'), lock(["x", "1.0.0"]));
    assert.match(missing[0], /missing from Cargo\.lock/);
  });

  it("flags an empty lockfile", () => {
    assert.deepEqual(findLockfileProblems(manifest('a = "=1.0.0"'), ""), ["Cargo.lock lists no packages."]);
  });
});

describe("ignoresCargoLock", () => {
  it("spots the patterns that would stop git tracking the lockfile", () => {
    for (const line of ["Cargo.lock", "/Cargo.lock", "**/Cargo.lock", "soroban/Cargo.lock", "*.lock"]) {
      assert.equal(ignoresCargoLock([`target/\n${line}\n`]), true, line);
    }
  });

  it("leaves unrelated patterns, comments and negations alone", () => {
    assert.equal(ignoresCargoLock(["*.pid.lock\npackage-lock.json\nyarn.lock\n# Cargo.lock\n!Cargo.lock\n"]), false);
    assert.equal(ignoresCargoLock([""]), false);
  });
});

describe("this repository", () => {
  it("runs Cargo from the committed lockfile in every workflow", () => {
    const dir = ".github/workflows";
    const violations = readdirSync(resolve(repoRoot, dir))
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) => findCargoViolations(`${dir}/${name}`, read(`${dir}/${name}`)));

    assert.deepEqual(
      violations.map((v) => `${v.file}:${v.line} ${v.message}`),
      [],
    );
  });

  it("tracks soroban/Cargo.lock", () => {
    assert.equal(ignoresCargoLock([read(".gitignore"), read("soroban/.gitignore")]), false);
  });

  it("locks every exactly pinned workspace dependency at its pinned version", () => {
    assert.deepEqual(findLockfileProblems(read("soroban/Cargo.toml"), read("soroban/Cargo.lock")), []);
  });

  it("keeps ed25519-dalek on the 2.x line the contract tests need", () => {
    const versions = lockedPackages(read("soroban/Cargo.lock"))
      .filter((p) => p.name === "ed25519-dalek")
      .map((p) => p.version);

    assert.equal(versions.length, 1);
    assert.match(versions[0], /^2\./);
  });
});
