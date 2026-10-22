# Live exit for add-oskhs-model-credentials (B1.3d)

Recorded 2026-10-23 on the kiss dev stand and the local gateway. Two marked
projects with different kiss model providers:

| project | marker | kiss provider | protocol | base URL | model |
|---|---|---|---|---|---|
| `kiss-local` | channel `kiss-local-test` | `syn:large:text` | openai | `https://api.synthetic.new/openai/v1` | `syn:large:text` |
| `minecraft` | project | `oskhs-anthropic` (created for this check; key copied inside Mongo from `default`) | anthropic | `https://api.synthetic.new/anthropic` | `hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` |

Worker: `bun oskhs/src/cli.ts worker --once --mirror-dir <mirrors>
--internal-models --agent-name svc_kiss` — no `--model`, no `--provider`.
`repo-kiss-local` still had the hand-attached `maki-synthetic` from B1.3c.

## 3.1 Each project answers with its own model

```
oskhs: imported profile oskhs-openai-api-synthetic-new-24a91d
oskhs: imported profile oskhs-anthropic-api-synthetic-new-4f8e55
oskhs: created provider oskhs-minecraft (oskhs-anthropic-api-synthetic-new-4f8e55)
oskhs: created provider oskhs-kiss-local (oskhs-openai-api-synthetic-new-24a91d)
oskhs: creating sandbox repo-minecraft
oskhs: detached maki-synthetic from repo-kiss-local
oskhs: sync repo-minecraft/dmitry.lazarev_ascii-minecraft-mimo-2.6-pro: 3482593 bytes, 1 updated, 0 pruned
oskhs: sync repo-minecraft/dmitry.lazarev_kiss: 12582507 bytes, 1 updated, 0 pruned
oskhs: round o13d0002 in repo-minecraft:/sandbox/tasks/o13d0002 (dmitry.lazarev_ascii-minecraft-mimo-2.6-pro, dmitry.lazarev_kiss)
oskhs: attached oskhs-kiss-local to repo-kiss-local
oskhs: sync repo-kiss-local/dmitry.lazarev_kiss: 0 bytes, 0 updated, 0 pruned
oskhs: sync repo-kiss-local/dmitry.lazarev_ascii-minecraft-mimo-2.6-pro: 0 bytes, 0 updated, 0 pruned
oskhs: round o13d0001 in repo-kiss-local:/sandbox/tasks/o13d0001 (dmitry.lazarev_kiss, dmitry.lazarev_ascii-minecraft-mimo-2.6-pro)
```

| task | reply | checked against the mirror |
|---|---|---|
| `o13d0001` (kiss-local): lines in `run.sh`? | «В файле `run.sh` … — **7** строк.» | `wc -l` → 7 |
| `o13d0002` (minecraft): Rust edition? | «**2021**» | `edition = "2021"` |

Per sandbox after the round:

| | `repo-kiss-local` | `repo-minecraft` |
|---|---|---|
| attached providers | `oskhs-kiss-local` only (`maki-synthetic` detached) | `oskhs-minecraft` only |
| provider type | `oskhs-openai-api-synthetic-new-24a91d` | `oskhs-anthropic-api-synthetic-new-4f8e55` |
| `providers.toml` | `protocol = "openai"`, `base_url = ".../openai/v1"`, `api_key_env = "OSKHS_MODEL_API_KEY"`, `id = "syn:large:text"` | `protocol = "anthropic"`, `base_url = ".../anthropic"`, same variable, `id = "hf:deepseek-ai/DeepSeek-V4.1-Flash-1017"` |
| Maki session `model` | `kiss/syn:large:text` | `kiss/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` |
| effective policy, network | one rule: `api.synthetic.new:443`, `POST /openai/v1/chat/completions`, `GET /openai/v1/models`, binary `/usr/local/bin/maki` | one rule: `api.synthetic.new:443`, `POST /anthropic/v1/messages`, `GET /anthropic/v1/models`, binary `/usr/local/bin/maki` |

## 3.2 Placeholders only; non-inference paths refused

Both sandboxes: `env OSKHS_MODEL_API_KEY stand-in` (the gateway-issued
token ending in the variable's name), no other credential variable.

- Real sandbox: `curl` with the stand-in to `GET /openai/v1/files` → no
  connection at all (HTTP code `000`): the rule admits only `maki`.
- The generated profile, re-imported under another id with `/usr/bin/curl`
  added to its binaries (throwaway sandbox `oskhs-probe`, deleted after),
  stand-in in the `Authorization` header:

```
GET /openai/v1/models -> 200
GET /openai/v1/files -> 403 "error":"policy_denied"
POST /openai/v1/embeddings -> 403 "error":"policy_denied"
POST /anthropic/v1/messages -> 403 "error":"policy_denied"
DELETE /openai/v1/models/x -> 403 "error":"policy_denied"
GET /v1/organization -> 403 "error":"policy_denied"
```

## 3.3 Provider change is re-synced

`minecraft` switched to `syn:large:text` (OpenAI protocol). Next round:

```
oskhs: created provider oskhs-minecraft (oskhs-openai-api-synthetic-new-24a91d)
oskhs: attached oskhs-minecraft to repo-minecraft
```

(the old Anthropic-type instance was detached and deleted first); reply
«`ascii-minecraft`», `providers.toml` now `protocol = "openai"`. A key-only
change takes the `provider update --credential` path (unit-tested; the dev
stand has a single key).

## 3.4 Internal model on a worker without `--internal-models`

`o13d0004` → `state: closed`, `runtimeState: failed`, `errorMessage: model
'syn:large:text' is internal (isExternal: false); this oskhs worker runs
without --internal-models, its gateway does not reach it`; no gateway call.

## Key handling

The key was read by the oskhs process from the task document and given to
`openshell provider create/update` as `--credential OSKHS_MODEL_API_KEY`
with the value only in the child's environment (asserted for every call in
`test/model.test.ts`). No file oskhs wrote contains it; the fingerprint
state file (`providers.json`, mode 0600) holds a truncated hash.
