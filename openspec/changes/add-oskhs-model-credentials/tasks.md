# Tasks

## 1. Derivation

- [x] 1.1 `oskhs/src/kiss/model.ts`: parse `modelProvider` → profile YAML
      (id, endpoint, rules, auth), provider name, fingerprint, Maki
      `providers.toml`, model spec; verify unit tests for OpenAI and
      Anthropic URLs with and without a path, a non-default port, missing
      fields, and that no output contains the key; lint every generated
      profile with `openshell profile lint` in a test gated on the CLI

## 2. Sync

- [x] 2.1 Sync: import the profile when unknown; create/update/re-create
      the provider by fingerprint with the key only in the child's
      environment; attach it and detach every other provider of the
      sandbox; state file 0600; verify with the recording runner (argv never
      holds the key; create vs update vs re-create; detach of extras)
- [x] 2.2 Sandbox round uses it: write `providers.toml`, `--model
      kiss/<id>`, sandbox created with only the project provider; internal
      models need `--internal-models`; fallback flags; verify unit tests and
      `make test-oskhs`, `bunx tsc --noEmit -p oskhs`

## 3. Live exit

- [ ] 3.1 Dev stand: project `kiss-local` (OpenAI protocol,
      `syn:large:text`) and project `minecraft` marked at project level with
      a new kiss provider (Anthropic protocol, `hf:deepseek-ai/DeepSeek-
      V4.1-Flash-1017`); one question each; verify each answer, each
      sandbox's single provider, its `providers.toml`, and Maki's session
      model; record in `evidence/model-live.md`
- [ ] 3.2 Verify the credential variable in both sandboxes is a stand-in and
      no other credential variable exists; verify a request with the
      stand-in to a non-inference path is refused (real sandbox, and the
      generated rules on a throwaway copy that admits curl)
- [ ] 3.3 Rotate: change the provider record's key fingerprint input (re-save
      the same key under a new type is not possible — instead switch
      `minecraft` to the OpenAI provider) and verify the next round
      re-creates the provider and detaches the old one
- [ ] 3.4 Internal model refused on a worker without `--internal-models`

## 4. Docs

- [ ] 4.1 `docs/oskhs.md` (model and credential sync, internal models,
      flags) and roadmap B1.3d done (noting the `--credential KEY`
      substitution for `--secret-material-env`); verify
      `scripts/check-links.sh docs/oskhs.md docs/roadmap.md` and
      `openspec validate add-oskhs-model-credentials --strict`
