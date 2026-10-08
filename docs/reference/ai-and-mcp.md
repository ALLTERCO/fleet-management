<!-- audience: public -->
# AI and MCP Reference

This is the short entrypoint for agents and AI tooling.

## Start Here

Read in this order:

1. [Repository rules](../../AGENTS.md), then the area rule for your task
2. `llms.txt` and `docs/generated/ai-index.json`
3. The exact generated contract or stable doc named by the index

For Fleet Manager install/deploy commands and `deploy/deploy-public.sh` options,
read `docs/deployment.md` first. For a separate UI or BM template UI,
read `docs/reference/separate-ui-host-sdk.md` and the Host SDK contracts named
by the index.

Use the smallest source that answers the question. Do not hand-edit files under
`docs/generated/`; change source code or stable docs, then run `npm run generate`
from the repo root.

## Critical system flows

This table is the navigation source for `python3 tools/knowledge/check.py --flows`.
The generated AI index already points to this reference. Each guide links its
owner, authoritative data, boundaries, failure behavior, reusable code and tests.
Use current source when a graph or memory result disagrees. Source review and
file existence are not passing-test or live-system evidence.

<!-- knowledge-flows:start -->
| Task | Flow guide |
|---|---|
| Onboard or admit a device | [Device onboarding](../internal/architecture/workflows/device-onboarding.md) |
| Change identity or permission behavior | [Authentication and permissions](../internal/architecture/auth-authz-flow.md) |
| Send a command or diagnose optimistic state | [Entity commands](../internal/architecture/workflows/actuator-command-optimistic-ui.md) |
| Store, recover or query energy | [Energy storage](../internal/architecture/workflows/energy-storage.md) |
| Diagnose an alert or delivery | [Notifications](../internal/architecture/notifications.md) |
| Install, update or recover a deployment | [Deployment](../internal/ops/deployment.md) |
<!-- knowledge-flows:end -->

Run the [session brief and maintenance checks](../../tools/knowledge/README.md)
before trusting derived knowledge. Architecture Atlas is not part of this
workflow. For design choices, follow the
[research and decision rules](../internal/ENGINEERING_RULES.md#research-reuse-and-design-decisions).
Record why, alternatives, sources, acceptance status and revisit triggers in the
existing decision directory. Do not create another issue list or memory-only fact.

## Doc Layers

| Layer | Use |
|---|---|
| `docs/generated/` | Facts from code. Never hand-edit. |
| `docs/reference/` | Stable how-to docs and operator/developer entrypoints. |
| `docs/architecture/` | Why the system works this way. |

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
wrappers, use them only when extending the SDK itself. The full list with
notes is in `docs/generated/api-catalog.json` under `escapeHatches`.

The SDK also exports `HOST_METHOD_METADATA` and `HOST_ESCAPE_HATCHES` (from
`@/shell/template-host`): per-method namespaceKind, risk flags, and the
recommended wrapper, generated from the catalog. `HOST_NAMESPACE_GUIDE`
entries carry `kind` too. UI code can answer "is this safe, what should I
call instead" without leaving the SDK.

## Install And Separate UI

| Task | Read |
|---|---|
| Install or update Fleet Manager | `docs/deployment.md`, then `docs/public/reference/deploy-public-reference.md` for deeper deploy behavior. |
| Run a dev Fleet Manager from source | `./deploy/deploy-public.sh up --env dev` (login `admin` / `admin`). |
| Add demo data | `./deploy/deploy-public.sh seed` (`--dev` for a dev-mode install). |
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

The live endpoint accepts only a scoped access key carrying `mcp:read`,
`mcp:write`, or `mcp:full`, or an OAuth token from an MCP app. Browser
sessions are refused, whatever the role. Normal RBAC still applies. Destructive
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

Tools: the full list, with toolset and read-only flag, is the table in
[AI and MCP operations](ai-mcp-operations.md#tools).

## Boundaries

Generated contracts are facts. Stable docs explain how to use those facts.
Plans explain what happened while building the system. When they disagree, fix
the stable doc or generator and rerun `npm run generate`.
