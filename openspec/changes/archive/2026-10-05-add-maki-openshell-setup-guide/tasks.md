# Tasks

## 1. Structure and shared references

- [x] 1.1 Create `README.md` describing the project, target repo layout, and links to the guides; verify it names all three OpenSpec changes under `openspec/changes/`
- [x] 1.2 Create `docs/glossary.md` with the term list (gateway, sandbox, supervisor, base/effective policy, provider, profile, credential placeholder, Landlock, seccomp, network namespace, OCSF, policy advisor, policy prover, workspace, template); verify every term has a one-line definition and appears in `docs/ai/references.md`
- [x] 1.3 Create `docs/ai/references.md` with curated external links (OpenShell: overview, installation, support matrix, run-your-first-agent, sandboxes, policy overview/schema/default-policy, network rules, profiles, inference, security best practices, advisor, prover, observability, SDKs, docs MCP endpoint; Maki: quick start, configuration, providers, headless mode, folder trust, permissions, CLI), using `.md` URLs where available, each entry with a "verified against" version; verify each URL returns HTTP 200 via `scripts/check-links.sh`
- [x] 1.4 Add `scripts/check-links.sh` (POSIX sh) that extracts URLs from `docs/**/*.md` and checks them with `curl -fsSL --head`, reporting per-URL status; verify it exits 0 on current docs and non-zero against a fixture containing a deliberately broken URL

## 2. Canonical examples

- [x] 2.1 Create `examples/maki-image/Dockerfile` (Ubuntu 24.04 base, non-root `sandbox` user uid/gid 1500, writable `/sandbox` workspace, `iproute2`, pinned `ARG MAKI_VERSION`, Maki installed to `/usr/local/bin`); verify with `docker build --build-arg MAKI_VERSION=<pinned> -t maki-agent:local examples/maki-image`
- [x] 2.2 Create baked Maki config `examples/maki-image/config/init.lua` (workspace trust paths, `always_yolo`) and `examples/maki-image/config/permissions.toml` (deny rules that survive YOLO); verify the image build places them at `/sandbox/.config/maki/` (`docker run --rm maki-agent:local ls /sandbox/.config/maki`)
- [x] 2.3 Create `examples/providers/maki-anthropic.yaml` and `examples/providers/maki-openrouter.yaml` with `binaries: [/usr/local/bin/maki]`; verify each with `openshell profile lint -f <file>`
- [x] 2.4 Create `examples/policies/maki-minimal.yaml` (read-only system paths, read-write `/sandbox` and `/tmp`, non-root process, no extra network rules) and `examples/policies/maki-git-push.yaml` (adds repository-scoped GitHub push + API rules); verify both parse with `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))"` and that the minimal policy matches the documented `openshell` acceptance flow

## 3. Setup guide

- [x] 3.1 Write `docs/setup-guide.md` sections: intro + isolation model; prerequisites (Docker Desktop host networking on, Enhanced Container Isolation off, OpenShell install, `openshell status`); build the Maki image; model access (import profile, create provider with `--from-existing`); sandbox policy; run Maki (interactive, headless, upload/download caveat); isolation verification; troubleshooting; next steps. Every configuration block references an `examples/` path instead of inlining a duplicate
- [x] 3.2 Add a terms section linking to `docs/glossary.md`, and a "verified against OpenShell v0.1.2, Maki <pinned>" header that names the tested platform
- [x] 3.3 Write `docs/verification.md` with the isolation checklist: denied egress (`curl` to a non-allowed host is blocked), placeholder-only credential (`printenv` of the credential variable shows only the opaque stand-in, never the value), host paths invisible (`ls /Users` fails), effective policy review (`openshell policy get <name> --full`), attached provider list, and denial logs (`openshell logs --source sandbox`); each check states its exact command and expected output

## 4. AI-agent reference pack

- [x] 4.1 Write `docs/ai/agent-playbook.md`: ordered executable steps with exact `openshell`/`docker` commands, decision points (provider choice, project upload path, git push or not), and the verification check to run after each phase; verify it contains no unresolved placeholders other than the user's API key and project path
- [x] 4.2 Add root `AGENTS.md` pointing to `docs/ai/agent-playbook.md` and `docs/ai/references.md`, restating the security invariants (no bind mounts, no `--env` secrets, deny-by-default egress, non-root sandbox user); verify a reader of only `AGENTS.md` can locate both files

## 5. End-to-end verification

- [x] 5.1 Dry-run the guide on a machine with Docker + OpenShell: build the image, lint and import both provider profiles, create a sandbox, run Maki headlessly against a test prompt, then execute every check in `docs/verification.md`; record actual outputs and any corrections in `docs/verification-log.md`
- [x] 5.2 Run `openspec validate add-maki-openshell-setup-guide --strict` and fix any reported issue
