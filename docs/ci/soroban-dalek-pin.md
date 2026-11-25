# Soroban dependency pin

CI no longer runs `cargo tree -i ed25519-dalek@3.0.0`.

That step was a temporary, non-blocking investigation into which crate pulled `ed25519-dalek` 3.0.0. The pin to 2.2.0 that keeps the Soroban test build on the compatible 2.x line is now held by the committed `soroban/Cargo.lock`, not by a `cargo update` step in `.github/workflows/ci.yml`. CI runs `cargo metadata --locked` before the build and `cargo test --release --locked`, so a stale lockfile fails the job instead of being re-resolved. See "Dependencies and the lockfile" in `soroban/README.md`.
