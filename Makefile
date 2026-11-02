# osa development tasks.
#
#   make build         build the Rust core and print the binary path
#   make test          stub-backed suite (no Docker, no gateway, no network)
#   make test-core     the Rust core's offline unit and integration tests
#   make test-conformance  the same suite in strict conformance mode
#   make test-conformance-self  harness self-test (normalizer + leak scan)
#   make test-all      every suite: shell, bridge, dashboard, oskhs + MongoDB
#   make test-oskhs    oskhs round library suite (bun, no gateway)
#   make verify-dev-environment  prove the development image is usable
#   make lint          shellcheck + fish syntax checks
#   make lint-profiles lint every example provider profile with the real CLI
#   make install-fish  symlink the fish plugin into the user's config
#   make openspec-update refresh OpenSpec tool files and Maki command copies

SHELL := /bin/sh

# The Rust core: one workspace, one binary named `osa`. The toolchain is
# pinned in rust-toolchain.toml; the first build needs crates.io.
OSA_CORE_MANIFEST := osa-core/Cargo.toml
OSA_CORE_BIN := osa-core/target/release/osa

.PHONY: build test test-core test-conformance test-conformance-self verify-dev-environment test-all test-oskhs test-bridge test-ui test-journeys test-journeys-live compat compat-drift maki-drift lint lint-docs lint-profiles install-fish openspec-update sync-openspec

build:
	cargo build --release --manifest-path $(OSA_CORE_MANIFEST)
	@printf '%s\n' "$(CURDIR)/$(OSA_CORE_BIN)"
	@test -x "$(CURDIR)/$(OSA_CORE_BIN)"

test:
	tests/run-tests.sh

# Proves the development image (examples/environments/dev) is usable. Run it
# inside that image: every pinned runtime resolves, the front end builds with
# the network off, and the suites pass against the image's loopback MongoDB.
# It fails naming the first missing or mismatched runtime and never skips a
# check.
verify-dev-environment:
	@scripts/verify-dev-environment.sh

# Offline: temporary state roots and stub executables only, so no gateway,
# Docker, or network at runtime.
test-core:
	@command -v cargo >/dev/null 2>&1 || { echo 'test-core: cargo not found (install the pinned Rust toolchain from rust-toolchain.toml)' >&2; exit 1; }
	cargo test --workspace --manifest-path $(OSA_CORE_MANIFEST)

# The same case set in strict conformance mode: a case without a golden must be
# listed in tests/conformance/excluded.txt, and a recording that differs from
# its golden fails. Needs only POSIX sh and the stubs under tests/stub.
test-conformance:
	OSA_CONFORMANCE_STRICT=1 tests/run-tests.sh

# Proves the normalizer cannot hide a real argv change and that the leak scan
# catches a backend that moves a credential into argv.
test-conformance-self:
	tests/conformance/self-test.sh

# The verification gate (CI runs exactly this): the shell suite with the
# conformance layer in strict mode, then the core, bridge, dashboard, and oskhs
# suites, including the MongoTaskStore tests against OSKHS_TEST_MONGO_URI. The
# body is scripts/test-all.sh, which runs without make so an agent can run the
# same gate inside a sandbox (make cannot spawn a child process there).
test-all:
	@scripts/test-all.sh

# Offline oskhs suite: round library over a recording runner. No Docker,
# gateway, or network. Skips with a message when bun is absent.
test-oskhs:
	@if command -v bun >/dev/null 2>&1; then \
		cd oskhs && bun test; \
	else \
		echo 'bun not found; skipping oskhs test suite'; \
	fi

# Offline bridge suite: goldens, contract/wire rules, session API over a
# spawned bridge. No Docker, gateway, or network. Skips with a message when
# bun is absent; never part of `make test`.
test-bridge:
	@if command -v bun >/dev/null 2>&1; then \
		cd bridge && bun test; \
	else \
		echo 'bun not found; skipping bridge test suite'; \
	fi

# TUI-level discovery pass against the real opencode binary: boot, prompt, and
# permission invariants with a transcript capture compared against the defect
# inventory (open defects record their reproduction instead of failing).
# Skips with a message when opencode or bun are absent; never part of `make test`.
test-ui:
	@if command -v opencode >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then \
		bridge/test/tui-discovery.sh; \
	else \
		echo 'opencode or bun not found; skipping TUI discovery pass'; \
	fi

# Journey recording: drive the real OpenCode TUI against a loopback scripted
# provider and the same TUI against the bridge, then compare normalized screen
# snapshots per checkpoint and rewrite catalog status/evidence. Needs a PTY and
# the real opencode binary; skips cleanly and never joins `make test`.
test-journeys:
	@if command -v opencode >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then \
		bun bridge/test/journeys/harness/record.ts && bun scripts/gen-compat.ts; \
	else \
		echo 'opencode or bun not found; skipping journey recording'; \
	fi

# Live journey run: the same scripted journeys against the real pinned Maki in
# one throwaway OpenShell sandbox. Skips cleanly (exit 0, no file change) when
# openshell, a reachable gateway, opencode, bun, or the project image is
# unavailable; never part of `make test`.
test-journeys-live:
	@engine="$${MAKI_OSS_ENGINE:-docker}"; image="$${MAKI_OSS_IMAGE:-maki-agent:local}"; \
	if command -v openshell >/dev/null 2>&1 \
		&& openshell status >/dev/null 2>&1 \
		&& command -v opencode >/dev/null 2>&1 \
		&& command -v bun >/dev/null 2>&1 \
		&& command -v "$$engine" >/dev/null 2>&1 \
		&& "$$engine" image inspect "$$image" >/dev/null 2>&1; then \
		bun bridge/test/journeys/harness/live.ts && bun scripts/gen-compat.ts; \
	else \
		echo 'live journey run skipped: openshell, a reachable gateway, opencode, bun, or the project image is unavailable'; \
	fi

# Regenerate docs/compatibility.md from statuses.json + defects.json and fail
# when the regenerated report differs from the committed one, so a status
# edit cannot land without its report (and vice versa).
compat:
	bun scripts/gen-compat.ts
	git diff --exit-code docs/compatibility.md

# Contract drift gate: first the SDK/gateway pin (the typed client and the
# gateway must be the same OpenShell release, checked offline), then a
# re-capture of the installed OpenCode contract against the vendored copy. The
# contract half skips with a message when a required binary is absent; never
# part of `make test`.
compat-drift:
	@scripts/pin-drift.sh
	@if command -v bun >/dev/null 2>&1; then \
		bun scripts/compat-drift.ts; \
	else \
		echo 'bun not found; skipping contract drift gate'; \
	fi

# Maki-side drift check: the image's pinned Maki against the latest release,
# with release notes and whether the SDK surface (sdk_mode.rs, cli.rs, the MCP
# handshake) changed between the tags. Exits non-zero when it did, so every
# pin-blocked row is re-triaged; reads only. Never part of `make test`.
maki-drift:
	@if command -v bun >/dev/null 2>&1; then \
		bun scripts/maki-drift.ts; \
	else \
		echo 'bun not found; skipping Maki drift check'; \
	fi

lint-docs:
	scripts/check-playbooks.sh

lint: lint-docs
	shellcheck -x bin/maki-oss bin/opencode-oss bin/claude-oss bin/codex-oss bin/osa tests/run-tests.sh tests/conformance/harness.sh tests/conformance/normalize.sh tests/conformance/self-test.sh tests/conformance/backends/leaky.sh tests/conformance/backends/drift.sh tests/stub/openshell tests/stub/docker tests/stub/bun tests/stub/opencode tests/stub/codex
	fish -n fish/functions/__oss_run.fish
	fish -n fish/functions/maki-oss.fish
	fish -n fish/conf.d/maki-oss.fish
	fish -n fish/completions/maki-oss.fish
	fish -n fish/functions/opencode-oss.fish
	fish -n fish/completions/opencode-oss.fish
	fish -n fish/completions/osa.fish
	cargo fmt --all --manifest-path $(OSA_CORE_MANIFEST) -- --check
	cargo clippy --workspace --manifest-path $(OSA_CORE_MANIFEST) -- -D warnings

# Lints the shipped provider profiles against the real openshell CLI. Skips
# with a clear message when the CLI is absent; not part of `make test`.
lint-profiles:
	@if command -v openshell >/dev/null 2>&1; then \
		status=0; \
		for profile in examples/providers/*.yaml; do \
			openshell profile lint -f "$$profile" || status=1; \
		done; \
		exit $$status; \
	else \
		echo 'openshell CLI not found; skipping profile lint'; \
	fi

install-fish:
	bin/maki-oss fish install

# Mirror the generated OpenSpec commands into the flat layout Maki discovers.
# Source of truth: .opencode/commands/opsx-*.md — Maki does not read
# .opencode/commands, and the .claude copies are nested and carry a name that
# would override the filename. `make openspec-update` chains both steps.
sync-openspec:
	mkdir -p .maki/commands
	rm -f .maki/commands/opsx-*.md
	cp .opencode/commands/opsx-*.md .maki/commands/

openspec-update:
	openspec update
	$(MAKE) sync-openspec
