# AI and MCP Reference

This is the short entrypoint for agents and AI tooling.

## Start Here

Read in this order:

1. `llms.txt`
2. `docs/generated/ai-index.json`
3. The exact generated contract or stable doc named by the index

For Fleet Manager install/deploy commands and `deploy/deploy.sh` parameters,
read `docs/reference/deployment.md` first. For a separate UI or BM template UI,
read `docs/reference/separate-ui-host-sdk.md` and the Host SDK contracts named
by the index.

Use the smallest source that answers the question. Do not hand-edit files under
`docs/generated/`; change source code or stable docs, then run `npm run generate`
from the repo root.

## Doc Layers

| Layer | Use |
|---|---|
| `docs/generated/` | Facts from code. Never hand-edit. |
| `docs/reference/` | Stable how-to docs and operator/developer entrypoints. |
| `docs/architecture/` | Why the system works this way. |
| `docs/internal/plans/` | History and planning, not the shipped source of truth. |

## UI Rule

Use the Host SDK for UI and template work:

```ts
import {host} from '@/shell/template-host';
```

Normal UI code should call `host.devices`, `host.virtualDevices`,
`host.bluetoothDevices`, `host.relationships`, and the other host domains.
Raw `sendRPC` should stay inside `frontend/src/shell/template-host/` or legacy
low-level device configuration wrappers.

`host.api`, `call`, `listAll`, `useTemplateRpc`, and `host.devices.call` are
raw escape hatches. They stay supported, but they skip the curated domain
wrappers — use them only when extending the SDK itself. The full list with
notes is in `docs/generated/api-catalog.json` under `escapeHatches`.

The SDK also exports `HOST_METHOD_METADATA` and `HOST_ESCAPE_HATCHES` (from
`@/shell/template-host`): per-method namespaceKind, risk flags, and the
recommended wrapper, generated from the catalog. `HOST_NAMESPACE_GUIDE`
entries carry `kind` too. UI code can answer "is this safe, what should I
call instead" without leaving the SDK.

## Install And Separate UI

| Task | Read |
|---|---|
| Install or update Fleet Manager | `docs/reference/deployment.md`, then `docs/architecture/deploy-reference.md` for deeper deploy behavior. |
| Run local demo-seeded dev FM | `./deploy/deploy.sh up --env dev --seed` (`--seed` starts demo data after the dev backend is reachable). |
| Run demo-seeded Docker local/test FM | `./deploy/deploy.sh up --env <env> --seed`. |
| Build standard FM UI | `./deploy/deploy.sh up --env <env> --mode fm` (`fm` is the default). |
| Build BM template UI | `./deploy/deploy.sh up --env <env> --mode bm --manifest <request.json> --template-source <templates checkout>`. |
| Build a separate UI | `docs/reference/separate-ui-host-sdk.md`, `docs/generated/host-sdk-index.json`, and `frontend/src/shell/template-host/generated/contract.ts`. |

## Common Host SDK Flows

Get the relationship graph for a device:

```ts
const graph = await host.relationships.getDeviceGraph({
    shellyID,
    depth: 1,
    include: ['membership', 'components', 'virtualBindings', 'bluetooth']
});
```

Promote a BLU/BTHome gateway child into a first-class Bluetooth device:

```ts
const candidates = await host.bluetoothDevices.listCandidates({
    gatewayExternalId
});

const promoted = await host.bluetoothDevices.promoteFromGateway({
    gatewayExternalId,
    componentKey: candidates.items[0].componentKey,
    makePrimary: true
});
```

Create a composed virtual device and bind a role:

```ts
const created = await host.virtualDevices.create({
    kind: 'composed',
    name: 'Bedroom climate',
    typeKey: 'climate_sensor'
});

await host.virtualDevices.bindings.create({
    externalId: created.externalId,
    expectedRevision: created.revision,
    roleKey: 'temperature',
    source: {
        deviceExternalId: sourceDeviceId,
        componentKey: 'temperature:0'
    }
});
```

Delete virtual or Bluetooth devices safely:

```ts
const current = await host.virtualDevices.get({externalId});

await host.virtualDevices.delete({
    externalId,
    expectedRevision: current.revision,
    retention: 'tombstone'
});

await host.bluetoothDevices.delete({
    externalId: bluetoothExternalId,
    retention: 'tombstone',
    unpairFromGateway: true,
    ignoreGatewayErrors: false
});
```

Set the device kind and cost center:

```ts
await host.devices.setKind({
    shellyID,
    kind: 'submeter',
    costCenter: 'CC-2204'
});
```

Set a visual asset:

```ts
await host.devices.setImage({
    shellyID,
    imageAssetId
});
```

## Priority Contracts

Use these exact generated contracts when checking backend shape or MCP lookup.
UI code should still call the Host SDK wrappers above.

| Flow | Exact contracts |
|---|---|
| Device graph | `device.Relationships.Get`, `device.Relationships.Query` |
| BLU candidate and promotion | `bthome.ListGateways`, `bthome.Device.Rename`, `virtualdevice.Bluetooth.Candidate.List`, `virtualdevice.Bluetooth.PromoteFromGateway` |
| Bluetooth lifecycle | `virtualdevice.Bluetooth.List`, `virtualdevice.Bluetooth.Get`, `virtualdevice.Bluetooth.Update`, `virtualdevice.Bluetooth.Delete`, `virtualdevice.Bluetooth.Transport.List` |
| Virtual lifecycle | `virtualdevice.List`, `virtualdevice.Create`, `virtualdevice.Get`, `virtualdevice.Update`, `virtualdevice.Delete` |
| Virtual bindings | `virtualdevice.Binding.ListSources`, `virtualdevice.Binding.ValidateDraft`, `virtualdevice.Binding.Create`, `virtualdevice.Binding.List` |
| Visual assets | `device.SetImage`, `virtualdevice.Image.CreateUploadTicket`, `virtualdevice.Bluetooth.Image.CreateUploadTicket` |
| Asset role | `device.SetKind` |
| Device removal | `device.Delete` |
| HTTP API docs | `GET /openapi.json`, `POST /rpc`, `GET /rpc/:method`, `POST /rpc/:method` |
| Asset delivery | `GET /assets/:id`, `POST /uploads/asset` |

## MCP

Fleet Manager has one MCP core with two transports:

- Local stdio is documentation-only. Start it with
  `node backend/scripts/fleet-docs-mcp-server.mjs`. The public source release
  includes `mcp.example.json` as a client configuration example.
- A running Fleet Manager serves `POST /mcp` on its normal HTTP port. This
  transport supports documentation, governed reads, and confirmed writes.

The live endpoint requires an admin session or a scoped access key carrying
`mcp:read`, `mcp:write`, or `mcp:full`. Normal RBAC still applies. Destructive
writes require confirmation. Stateful calls are audited and rate-limited.
See `docs/reference/ai-mcp-operations.md` for setup and limits.

| Resource | Use |
|---|---|
| `fm://docs/ai-index` | Small map of AI-readable docs and contracts. |
| `fm://api/openapi` | OpenAPI contract for API tools. |
| `fm://api/rpc-inventory` | Exact RPC owner, source, permission, and method lookup. |
| `fm://api/api-catalog` | Agent method catalog: namespaceKind, safety hints, recommended Host SDK wrapper. |
| `fm://ui/host-contract` | Typed Host SDK contract. |
| `fm://ui/host-sdk-index` | Host SDK module/export lookup. |
| `fm://ui/frontend-backend-dependencies` | Existing frontend/backend dependency map. |

Tools:

| Tool | Use |
|---|---|
| `read_resource_chunk` | Read a bounded part of a large listed MCP resource. Continue with `nextOffset` until it is null. |
| `get_api_method` | One-method lookup: namespaceKind (device or fleet-manager), schemas, permission, safety hints, recommended Host SDK wrapper. Prefer this. |
| `get_rpc_method` | Exact RPC inventory lookup (declaration provenance, source). |
| `search_docs` | Simple doc search. |
| `find_frontend_callers` | Find UI callers before changing a backend contract. |
| `fm_read` | Run a permitted Fleet Manager read as the authenticated user. |
| `fm_write` | Prepare or execute a permitted Fleet Manager write. |
| `fm_confirm_write` | Confirm the exact destructive write returned by `fm_write`. |

## Boundaries

Generated contracts are facts. Stable docs explain how to use those facts.
Plans explain what happened while building the system. When they disagree, fix
the stable doc or generator and rerun `npm run generate`.
