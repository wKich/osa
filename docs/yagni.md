# YAGNI guidance (ponytail)

Every coding agent that works in this repository — OpenCode on the host,
Maki in the sandbox — gets the ponytail YAGNI ruleset from project-scoped
configuration. Nothing host-global is installed or modified. Upstream links
are in [`docs/ai/references.md`](ai/references.md), this repository's single
index of external documentation.

## What is installed

| Piece | Location | Consumed by |
|---|---|---|
| Pinned plugin declaration | [`opencode.json`](../opencode.json) — `plugins: ["@dietrichgebert/ponytail@5.3.2"]` | OpenCode (ruleset, `/ponytail*` commands, skills) |
| Vendored skill copies | `.maki/skills/ponytail*/SKILL.md` (six directories) | Maki only |

The skills deliberately live in `.maki/skills/`, not `.opencode/skills/`:
OpenCode scans `.opencode/skills/` and would register each skill twice (once
from disk, once from the plugin), while Maki scans `.maki/skills/` only.
Each agent sees each skill exactly once, with the same IDs.

## Default level

The default ponytail level for this repository is **`full`** — ponytail's own
default, so a fresh checkout needs no extra state.

Caveat: `/ponytail <level>` during a session persists ponytail's level to
host-level state (`$XDG_CONFIG_HOME/opencode/.ponytail-active`), outside this
repository. Switching levels here changes the level for other projects on the
same machine; this repository never writes that state itself. `/ponytail off`
is the escape hatch for a single session when the ruleset is in the way.

## Verify the install

```sh
# 1. Plugin declared here, pinned, global config untouched
grep -c '"@dietrichgebert/ponytail@5.3.2"' opencode.json      # expect 1
grep -c ponytail ~/.config/opencode/opencode.json             # expect 0

# 2. Plugin loads for this project
opencode plugin list                                          # ponytail 5.3.2 listed

# 3. Ruleset and level command: open `opencode` here, run `/ponytail`
#    (reports `full`) and `/ponytail-review` (offered by the plugin).

# 4. Maki sees all six skills
maki prompt --tools | grep -c ponytail                        # all six ids present

# 5. No duplicate copies in OpenCode's scanned skill directories
test ! -d .opencode/skills/ponytail && echo ok                 # expect ok
```

The six skills: `ponytail`, `ponytail-review`, `ponytail-audit`,
`ponytail-debt`, `ponytail-gain`, `ponytail-help`.

## Dev-only note

The `.maki/skills/ponytail*/` copies and the `opencode.json` plugin declaration
are maintainer tooling for working on this repository. They are not part of the
base image (`examples/maki-image/`) and not part of the reference environment
store (`examples/environments/reference/`); a user's environment store is theirs
to compose and does not inherit them.

## Refresh (bump the pin and re-copy the skills together)

The pinned version and the `.maki/skills/` copies must move in one step so
they cannot drift silently. From the repository root:

```sh
V=5.3.2  # new version
tmp=$(mktemp -d) && (cd "$tmp" && npm pack "@dietrichgebert/ponytail@$V" --silent \
  && tar xzf dietrichgebert-ponytail-$V.tgz)
for s in ponytail ponytail-review ponytail-audit ponytail-debt ponytail-gain ponytail-help; do
  rm -rf ".maki/skills/$s" && cp -R "$tmp/package/skills/$s" ".maki/skills/$s"
done
rm -rf "$tmp"
# then update the pin in opencode.json and re-run the verify steps above
```

Upstream docs (plugin API, ponytail install notes) are indexed in
[`docs/ai/references.md`](ai/references.md).
