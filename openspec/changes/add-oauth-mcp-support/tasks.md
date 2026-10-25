# Tasks

## 1. Re-ship the OAuth exemplar

- [ ] 1.1 Restore `examples/providers/mcp-linear.yaml` (carrying the Linear
  client-auth limitation in its header until fixed upstream) and the
  `[mcp.linear]` entry in `examples/environments/reference/config/mcp.toml`,
  then rebuild the reference environment image; verify with
  `openshell profile lint -f examples/providers/mcp-linear.yaml`
  passing, `python3 -c 'import tomllib; tomllib.load(open("examples/environments/reference/config/mcp.toml","rb"))'`
  parsing, `grep -Ei "sk-|ghp_|Bearer [A-Za-z0-9]" examples/environments/reference/config/mcp.toml`
  returning nothing, and `docker run --rm maki-agent:reference cat /sandbox/.config/maki/mcp.toml`
  showing every server with no credential value

## 2. Document the host-side flow

- [ ] 2.1 Document the OAuth flow end to end: declare the server in the
  host's `~/.config/maki/mcp.toml` (url only), `maki mcp auth <server>` on the
  host, `maki-oss provider setup` / `openshell provider create --runtime-credentials`,
  `openshell provider refresh configure ... --secret-material-env refresh_token=<ENVVAR>`
  (secret never in argv), `maki-oss provider attach`; restore the OAuth point
  in `docs/mcp-migration.md` §4 (it currently defers here); verify with each
  step naming a command and its expected output, and `scripts/check-links.sh`
  passing

## 3. Upstream report

- [ ] 3.1 File the client-authentication mismatch against NVIDIA/OpenShell
  (public clients per RFC 6749 §2.3.1 authenticate with body parameters only;
  Linear returns 401/400 for Basic and for mixed methods, with the isolated
  evidence in `docs/verification-log.md` §5.2); verify by the issue URL being
  recorded in `docs/verification-log.md` and in the profile header

## 4. Live verification

- [ ] 4.1 Complete a host login and get one OAuth-gated server answering a
  tool call from a sandbox session: `maki-oss mcp status` reports the server
  with all gates satisfied, a headless run lists its `*__*` tools, and
  `openshell sandbox exec -n <name> -- env` shows the OAuth variable as an
  opaque stand-in only; record only the shape — "each OAuth variable resolves
  to an opaque stand-in; values not recorded" — and never spell the
  placeholder prefix in any file (see `AGENTS.md`); verify by the tool name
  appearing in one run's output and by `grep -c "placeholder prefix" docs/verification-log.md`
  matching only the sentences that describe the shape
- [ ] 4.2 If the passing server is not Linear, lift the limitation note from
  `examples/providers/mcp-linear.yaml` only when Linear itself passes a retest;
  otherwise keep the note and point at the upstream issue; verify with
  `openshell profile lint` passing and the header still naming the reason
