<!-- audience: public -->
# Fleet Manager documentation

This is the map of the public Fleet Manager documentation.

## Where to start

| You want to | Read |
|---|---|
| Understand what Fleet Manager does and how to use it | [Fleet Manager Product Guide](product-guide/README.md), starting with [Understand Fleet Manager](product-guide/understand-fleet-manager.md) |
| Decide whether Fleet Manager fits your premises | [Evaluate Fleet Manager](product-guide/evaluate-fleet-manager.md) |
| Install, update or roll back Fleet Manager | `deploy/public/deployment.md`, then [reference/deploy-public-reference.md](reference/deploy-public-reference.md) |
| Build a client against the API | `docs/api/guides/` (start with `00-introduction.md`) |
| Look up an API method | `docs/generated/api.md` and `docs/generated/api.openapi.json` |
| Use Fleet Manager from an AI agent | `docs/reference/ai-and-mcp.md` and `docs/reference/ai-mcp-operations.md` |
| Build a separate UI on the Host SDK | `docs/reference/separate-ui-host-sdk.md` |
| Write a plugin | `docs/reference/plugins.md` |

## Folders

| Folder | What is in it |
|---|---|
| `docs/public/product-guide/` | The product guide: what Fleet Manager does, organizing devices, backups, firmware, device settings, evaluation |
| `docs/public/guides/` | Step-by-step guides: email, Teams and Telegram alerts, alert grouping, dashboards, dev-mode login |
| `docs/public/reference/` | Exact commands, flags and settings: the deploy guide, the tuning guide and the settings list |
| `docs/public/architecture/` | How a feature works from start to end: energy and reports, code layout |
| `docs/public/concepts/` | Short rules for shared words: device model, ids, tags, categories |
| `docs/api/` | API guides for integrators |
| `docs/generated/` | Contracts made from the code. Do not edit them by hand. |
| `docs/reference/` | Other public references (RPCs, events, entities, backups, observability, rollback) |

Every hand-written public doc starts with the line `<!-- audience: public -->`.
