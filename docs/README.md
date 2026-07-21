# `docs/` — folder convention

Doc tree split by **purpose** and **audience**, not by topic.

| Folder | Audience | Shape | Tracked? | Served via `/api/docs/`? |
|---|---|---|---|---|
| `docs/architecture/` | humans + AI agents | narrative explainers (read end-to-end) | yes | planned |
| `docs/concepts/` | humans + AI agents | terse rule-style references, front-loaded with rules | yes | planned |
| `docs/api/` | API integrators | API decision rules + handler comparisons | yes | planned |
| `docs/reference/` | self-hosting operators + new contributors | stable how-tos (setup guides, env vars, runbooks) | yes | planned |
| `docs/devices/` | device integrators | per-device support notes | gitignored (private deploy ships them) | planned |
| `docs/generated/` | API consumers | auto-generated OpenAPI HTML + JSON inventories | partial (api.html is gitignored — built at deploy) | `/api/docs`, `/api/docs/openapi.json` |
| `docs/internal/` | the team only | plans, audits, agent briefs, design work, mockups, research, status, ops runbooks | gitignored | never |

Top-level files:
- `CHANGELOG.md` — public-facing change log.
- `release-notes-v1.md` — version-specific release notes.

## Where things land

| If you're writing… | It goes in |
|---|---|
| "how does subsystem X work" (narrative, end-to-end) | `architecture/` |
| "what's the difference between A and B" / "DO NOT confuse X with Y" rules | `concepts/` |
| "how do I set up Z" (stable, infrequently-changing) | `reference/` |
| "for version N of Z we…" decisions about an API surface | `api/` |
| dated plan / design exploration / roadmap | `internal/plans/` |
| dated audit / review of code or process | `internal/audits/` |
| one-off briefing doc for a specific work item | `internal/briefs/` |
| weekly status / progress | `internal/status/` |
| research note (3rd-party tools, benchmarks, surveys) | `internal/research/` |
| per-device support notes | `devices/` |
| visual mockup, UX sketch | `internal/mockups/` |
| operator runbook (rotating secrets, removing actions) | `internal/ops/` |

## Generated contracts

Run generation from the repo root:

```bash
npm run generate
```

This is the single entrypoint for generated API docs, OpenAPI, backend
inventories, frontend/backend dependency maps, the Host SDK contract, AI
indexes, and the Node-RED catalog. Use the gate when you only want to check
whether committed generated files are current:

```bash
npm run generate:gates
```

Do not hand-edit `docs/generated/`. Change the source contract or handwritten
prose, then rerun `npm run generate`.

To catch a stale `docs/generated/` before it reaches CI, activate the pre-push
gate once per clone (it runs `npm run generate:gates` on push):

```bash
git config core.hooksPath scripts/hooks
```

Run it on a clean, single-author worktree — uncommitted work elsewhere makes the
regen drift and blocks the push.

## Why two folders look similar

- **`architecture/` vs. `concepts/`** — both stable, both for AI + humans. Architecture is **narrative**: read it end-to-end. Concepts is **rules**: scan a table, find the rule, follow the code pointer. When the same topic could fit either, write the architecture doc and a thin concepts sibling that points back; agents skim concepts first.
- **`reference/` vs. `architecture/`** — Reference is **operator-facing how-to** ("set FM_HEAP_SIZE to X"). Architecture is **engineer-facing why** ("the heap is sized to absorb the WebSocket buffer because…"). If the doc is mostly "run this command, set this env", it's reference.
- **`internal/plans/` vs. `architecture/`** — Plans are **dated, time-limited, often superseded**. Architecture is **durable, version-less, kept current**. A plan that ships becomes architecture; the plan stays for history in `internal/plans/_archive/`.
- **`internal/agents/` vs. `concepts/AGENT_RULES_*`** (if added later) — Agent files are **who owns what**. Concept "rules" docs are **cross-cutting facts every agent must know regardless of role**. Different shape.

## Migration history (this layout introduced 2026-06-03)

Before: 35+ loose .md at root + 15+ folders mixed by topic. The signal "is this for public consumption" was buried in `.gitignore`. Now it's in the path.

See `docs/internal/status/2026-06-03-where-we-are.md` for the migration record.
