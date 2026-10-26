# osa agent instructions

This repository (`osa`) documents and automates running your coding agent:
Maki, OpenCode, or Claude Code, inside NVIDIA OpenShell sandboxes. The agent
front-ends are `maki-oss` (Maki), `opencode-oss` (OpenCode), and `claude-oss`
(Claude Code); their command names, environment prefixes, and config paths are
unchanged by the repository rename. The sandbox is the security boundary; all
work in this repository must preserve it.

Start here:

- `docs/ai/onboarding.md` — choose the agent you already run, then follow the
  same-agent path for Maki, OpenCode, or Claude Code.
- `docs/ai/host-playbook.md` — provision the shared host tooling (engine,
  OpenShell, repository, shell) for any agent; hands off to the agent playbook.
- `docs/ai/environment-playbook.md` — compose a personal environment (MCP
  servers, runtimes, preferences) on the base image; hands off to the
  reference store under `examples/environments/reference/`.
- `docs/ai/playbooks/maki.md` — ordered, executable steps to build the image,
  load provider profiles, create a sandbox, and run Maki.
- `docs/ai/references.md` — curated upstream documentation (OpenShell and
  Maki), the only index of external documentation links in this repository.

Supporting docs: `docs/setup-guide.md` (full walkthrough),
`docs/ai/verification/maki.md` (Maki isolation checklist; the OpenCode and
Claude pages sit beside it), `docs/glossary.md` (vocabulary),
`docs/verification-log.md` (dry-run record), `docs/oskhs.md` (kiss
adapter, Track B). Canonical configuration lives in
`examples/`; docs reference those files instead of duplicating them. The base
image is agent-only; personal MCP servers, runtimes, and UI preferences belong
in an environment store built from `examples/environments/reference/`.

## Security invariants

Never violate these, even to make a command succeed:

- **No host bind mounts.** Project files move in and out through
  `openshell sandbox upload` / `download`.
- **No secrets through `--env` or `--env-from`.** Model and service credentials
  go through OpenShell provider profiles (placeholder + proxy substitution); the sandbox
  only ever sees an opaque stand-in, never the key.
- **Never spell the placeholder.** OpenShell's proxy rejects any request body
  containing the literal placeholder prefix with a 403, and Maki sends loaded
  context — this file, any doc it opens, any shell output it echoes — in every
  request body. One literal spelling in a file the agent reads breaks every
  later request. Describe the placeholder in prose; never quote it here, in
  `docs/`, or in any file the agent may load.
- **Egress stays deny-by-default.** Every endpoint is an explicit policy or
  provider-profile decision; add the narrowest rule and never use `tls: skip`,
  `access: full`, or wildcard hosts to fix a denial.
- **Non-root sandbox user.** Processes run as uid/gid 1500 (`sandbox`), and the
  filesystem policy stays minimal (`/sandbox`, `/tmp`, and the `/dev/null` sink writable, system paths
  read-only).
- **Maki never authenticates inside the sandbox.** Do not run
  `maki auth login`, and do not set `ANTHROPIC_BASE_URL` /
  `OPENROUTER_BASE_URL` there: it would leave the credential unbound.
- **Claude Code never authenticates inside the sandbox either.** Do not run
  `/login`, `claude auth`, or `claude setup-token` there (create the
  subscription token on the host), do not set `ANTHROPIC_BASE_URL` or an
  `apiKeyHelper`, and never mount or upload the host's `~/.claude`,
  `~/.claude.json`, or `~/.config/anthropic`.
- **Codex never authenticates inside the sandbox.** Do not run `codex login`
  there, and never create, upload, or mount an `auth.json` or the host's
  `~/.codex`. The ChatGPT login happens on the host in a throwaway
  `CODEX_HOME` (`codex-oss provider setup`), and the gateway keeps and
  refreshes the tokens. Do not override the provider's base URL: it would
  leave the credential unbound.
