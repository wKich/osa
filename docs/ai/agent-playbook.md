# Agent playbook: stand up a sandboxed Maki

Ordered, executable steps for a coding agent. Run every command from the
repository root. After each phase, run its verification and stop on a
mismatch — do not work around a failed check by weakening isolation.

The only inputs required from the user:

- a model API key — exported in the environment, or already present in a Maki
  or OpenCode credential store — and
- the project path to upload (optional; skip the upload steps to work in an
  empty workspace).

If a denial blocks the task, read `docs/setup-guide.md` §8 and
`docs/ai/references.md` before changing anything. Never relax an invariant
listed at the end of this file.

## Phase 0 — Preflight

```sh
docker version --format '{{.Server.Version}}'
openshell status
uname -m
```

Verify: Docker `28.0` or later; `openshell status` shows `Status: Connected`;
`uname -m` is a supported architecture (`arm64` or `x86_64`).

Then choose the provider (decision point A):

- If `maki-oss` is available, prefer the wizard: run `maki-oss provider setup`
  (interactive) or `maki-oss provider setup --from maki --credential <slug>
  --yes` for a credential already in a store. It imports the curated profile
  and creates the provider, so skip to Phase 3.
- Otherwise map an exported key to its curated profile:
  - `ANTHROPIC_API_KEY` → `examples/providers/maki-anthropic.yaml`, type
    `maki-anthropic`
  - `OPENROUTER_API_KEY` → `examples/providers/maki-openrouter.yaml`, type
    `maki-openrouter`
  - `DEEPSEEK_API_KEY`, `SYNTHETIC_API_KEY`, `OPENAI_API_KEY`,
    `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `ZHIPU_API_KEY`, or
    `OPENCODE_API_KEY` → the matching `maki-*` profile under
    `examples/providers/`; use the catalog table in `docs/providers.md` to
    pick between plans (for example Z.AI coding vs standard).
- If no key is available, stop and ask the user to export one or to run
  `maki-oss provider setup`. Do not accept a key pasted into the conversation,
  and do not put a key on a command line.

OAuth-only credentials (for example a ChatGPT or xAI OAuth login) are not
usable here; report that and point at `docs/migrating-providers.md` instead of
extracting tokens.

## Phase 1 — Build the image

```sh
docker build --build-arg MAKI_VERSION=0.6.5 -t maki-agent:local examples/maki-image
docker run --rm maki-agent:local maki --version
IMAGE=maki-agent:local
```

Verify: the build succeeds and prints `maki 0.6.5`.

The base image is agent-only: no MCP servers, no MCP-specific runtime, and no
personal UI preferences. It starts every Maki session in YOLO mode because
OpenShell, not Maki, is the permission boundary; the baked deny rules still
apply. If the task needs a server, runtime, or UI preference, build an
environment image on top and use its tag instead of the base:

```sh
docker build -t maki-agent:reference examples/environments/reference
IMAGE=maki-agent:reference
```

For a user-owned store, follow the environment playbook
([`docs/ai/environment-playbook.md`](environment-playbook.md)); never edit
`examples/maki-image/` for a personal choice. Set the same tag in the helper's
`image` setting when using `maki-oss`.

## Phase 2 — Load the provider profile and create the provider

If Phase 0 used `maki-oss provider setup`, the lint, import, and provider
creation already happened; run the verification commands below and skip to
Phase 3. Otherwise substitute the profile file and type chosen in Phase 0:

```sh
openshell profile lint -f examples/providers/maki-anthropic.yaml
openshell profile import -f examples/providers/maki-anthropic.yaml --global
openshell provider create --name maki-anthropic --type maki-anthropic --from-existing
```

Verify:

```sh
openshell profile describe maki-anthropic
openshell provider list
```

Expected: the profile shows the provider's endpoint and binary
(`api.anthropic.com:443` and `/usr/local/bin/maki` for this example); the
provider list names the instance and exposes credential key names only (never
values). If `provider create` fails, the key environment variable is missing
for the type's `discovery` section.

## Phase 3 — Choose the sandbox policy

Default: `examples/policies/maki-minimal.yaml` (no network rules of its own;
the provider adds the model endpoint).

Decision point B — does the task need `git push` to GitHub?

- No: keep `maki-minimal.yaml`.
- Yes: copy `examples/policies/maki-git-push.yaml` to a scratch file, replace
  its two repository placeholders (owner and repository name, case-sensitive),
  and import/attach the upstream `github` profile plus a GitHub provider for
  credentials.

Policy choice is fixed into the sandbox at creation; network rules can be
changed later with `openshell policy set`.

## Phase 4 — Create the sandbox

Decision point C — is there a project to upload?

Before uploading, make the project a git repo with its dependency directories
gitignored. `openshell sandbox upload` applies `.gitignore` filtering only
inside a git work tree and warns when it uploads everything, so an un-ignored
`.venv`, `node_modules`, or `target` directory is copied into the sandbox at
full size — a macOS `.venv` round-tripped 491 MB of useless, non-executable
files into a Linux sandbox once. The session patch does not bring ignored files
back, but the upload still pays for them in time and disk. Ignore the
dependency directories so the upload carries only the source.

```sh
cd "$PROJECT_PATH"
git init
printf '.venv/\nnode_modules/\ntarget/\n__pycache__/\n' >>.gitignore
git add -A && git commit -qm init
```

```sh
# With a project (uploads require the create command to have no trailing
# main command; Maki is launched later with sandbox exec):
openshell sandbox create --name maki \
  --from "$IMAGE" \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-anthropic \
  --upload "$PROJECT_PATH:/sandbox/project"

# Without a project:
openshell sandbox create --name maki \
  --from "$IMAGE" \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-anthropic
```

Verify:

```sh
openshell sandbox list
openshell policy get maki --full
```

Expected: the sandbox reaches `Ready`; the effective policy contains
`/usr/local/bin/maki -> api.anthropic.com:443` contributed by the provider
(`_provider_*` rule). A missing provider rule means the provider attachment
failed.

## Phase 5 — Run the isolation checks

Execute every check in `docs/verification.md` and confirm each expected
output. Do not proceed on a failure; report it with the command output.

## Phase 6 — Run Maki

Smoke test first (cheap, proves model access end to end):

```sh
openshell sandbox exec -n maki --workdir /sandbox/project --no-login-shell -- \
  maki -p "Reply with OK." --output-format json
```

Then run the real task the same way: pass the user's task text as the argument
to `-p` in place of the smoke-test string.

`sandbox exec` starts a new process, so it picks up the current provider
placeholders. Use `--output-format json` for machine-readable results.

### Helper shortcut

If `maki-oss` is available (from this repository), it performs Phases 2–7 —
except cleanup — in one command per project:

```sh
maki-oss provider setup        # one-time; remembers the provider
cd "$PROJECT_PATH"
maki-oss                       # ensure sandbox + interactive Maki + safe sync
maki-oss run "the task text"   # headless variant
```

The helper still uses provider profiles and the minimal policy, and never
relaxes the invariants below. Use the raw commands when you need explicit
control or are debugging the boundary itself.

## Phase 7 — Collect results and clean up

```sh
openshell sandbox download maki /sandbox/project ./project-out
openshell sandbox delete maki
```

Downloads are limited to paths inside the sandbox working directory — keep
results under `/sandbox`. When the project was run through `maki-oss`, the
session already collected a patch at exit; this download is the explicit
full-copy escape hatch, not the default sync path.

## Invariants (never relax these to make a command work)

- No host bind mounts. Move files with `sandbox upload` / `sandbox download`.
- No secrets via `openshell sandbox create --env` or `sandbox exec --env`.
  Credentials come from provider profiles only.
- Egress stays deny-by-default. Add the narrowest missing rule, never `tls:
  skip`, `access: full`, or a wildcard host to fix a denial.
- The sandbox process stays non-root (uid/gid 1500).
- Never run `maki auth login` inside a sandbox, and never set a provider
  base-URL override there (for example `ANTHROPIC_BASE_URL`,
  `OPENROUTER_BASE_URL`, or `DEEPSEEK_BASE_URL`).
- Do not edit `examples/` to match a failing local state; fix the local state
  or report the drift.
