# maki-oss development tasks.
#
#   make test          stub-backed suite (no Docker, no gateway, no network)
#   make test-oskhs    oskhs round library suite (bun, no gateway)
#   make lint          shellcheck + fish syntax checks
#   make lint-profiles lint every example provider profile with the real CLI
#   make install-fish  symlink the fish plugin into the user's config
#   make openspec-update refresh OpenSpec tool files and Maki command copies

SHELL := /bin/sh

.PHONY: test test-oskhs test-bridge test-ui test-journeys test-journeys-live compat compat-drift maki-drift lint lint-profiles install-fish openspec-update sync-openspec

test:
	tests/run-tests.sh

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

# Contract drift gate: re-capture the installed OpenCode contract and report
# route/schema deltas against the vendored copy. Skips with a message when a
# required binary is absent; never part of `make test`.
compat-drift:
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

lint:
	shellcheck -x bin/maki-oss bin/opencode-oss lib/oss-core.sh tests/run-tests.sh tests/stub/openshell tests/stub/docker tests/stub/bun tests/stub/opencode
	fish -n fish/functions/maki-oss.fish
	fish -n fish/conf.d/maki-oss.fish
	fish -n fish/completions/maki-oss.fish
	fish -n fish/functions/opencode-oss.fish
	fish -n fish/completions/opencode-oss.fish

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
