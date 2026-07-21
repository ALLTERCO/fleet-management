# Separate UI and Host SDK guide

Use this guide when building a Fleet Manager UI that is not the standard
frontend screen.

## Rule

Separate UIs should use Fleet Manager through the Host SDK contract first.
Raw RPC/OpenAPI calls are for backend/API integration work or for extending the
host layer itself.

## Sources Of Truth

Read these in order:

1. `docs/generated/ai-index.json`
2. `docs/generated/host-sdk-index.json`
3. `frontend/src/shell/template-host/index.ts`
4. `frontend/src/shell/template-host/generated/contract.ts`
5. `docs/generated/api.openapi.json`

The current Host SDK is source code in this repo. It is not documented here as a
published npm package.

## Fleet Manager Runtime

For dev Fleet Manager runtime with demo data:

```bash
./deploy/deploy.sh up --env dev --seed
```

Use `--seed` only with `up`. In `dev`, it starts the demo seed flow after the
dev backend is reachable.

For a plain local runtime without seed data:

```bash
./deploy/deploy.sh up --env local
```

For a Docker local/test deployment with demo data:

```bash
./deploy/deploy.sh up --env local --seed
```

Seed is for demo data: countries, buildings, groups, tags, persona, and
optional demo devices. Do not use it as production initialization.

You can also add demo data later to an already running local/test deployment:

```bash
./deploy/deploy.sh seed --env local
```

For production:

```bash
./deploy/deploy.sh up --env prod --domain fm.acme.example
```

Full deploy script options are documented in `docs/reference/deployment.md`.
Detailed deploy architecture is documented in
`docs/architecture/deploy-reference.md`.

## Standard FM UI

The default mode builds the standard Fleet Manager UI:

```bash
./deploy/deploy.sh up --env local --mode fm
```

`--mode fm` is the default. It rejects BM manifest/template flags so a standard
FM deploy cannot accidentally reuse a custom UI selection.

## Template UI

Use BM mode when the same Fleet Manager backend/runtime should be built with a
selected template UI:

```bash
./deploy/deploy.sh up \
  --env local \
  --mode bm \
  --manifest docs/internal/bm/examples/bm-deploy-request.supermarket.json \
  --template-source /path/to/business-manager-templates
```

Facts from the deploy guide:

- `--mode bm` requires `--manifest <request.json>`.
- `--mode bm` requires `--template-source <templates checkout>`.
- `--mode fm` does not accept BM manifest/template flags.

## Using The Host SDK

Inside the main frontend/template runtime:

```ts
import {host} from '@/shell/template-host';
```

Use domains from `host`, for example:

```ts
const page = await host.devices.list({limit: 50});
const graph = await host.relationships.getDeviceGraph({shellyID, depth: 1});
const alerts = await host.alerts.listInstances({});
```

Before using a domain, check `docs/generated/host-sdk-index.json` for the module
and exported methods. Per-method detail (kind, schemas, permission, safety
hints, recommended wrapper) is in `docs/generated/api-catalog.json` — or in
code via the `HOST_METHOD_METADATA` export from `@/shell/template-host`.

`host.api`, `call`, `listAll`, `useTemplateRpc`, and `host.devices.call` are
raw escape hatches: supported, but they skip the curated wrappers. Prefer the
named domain methods; use the escape hatches only when extending the SDK.

### Reading device data — live, history, totals

The `host.<domain>.method()` calls above are one-shot. For **live** values use
the reactive composables; the store updates from the status stream, so cards
re-render with no polling.

```ts
// Live: one device's current power (reactive)
import {useDeviceCapabilities} from '@/shell/template-host';
const caps = useDeviceCapabilities(shellyID);
// caps.value.energyPower → current watts; caps.value.energyTotal → kWh
```

```ts
// History: one device, or a group total (sum computed in SQL, not the UI)
const series = await host.energyReports.query({
  scope: {group: groupId},   // or devices: ['shelly-xxxx'] — mutually exclusive
  from, to, tags: ['total_power'], bucket: '1 hour',
  perDevice: false,          // one combined series per bucket
});
```

For a **live total across a group**, do not sum per-device live values in the
UI, which does not scale. Use `useMetric` (one front door for live or history,
single or many, whole device or a component). It ships in the Host SDK `energy`
domain; check `docs/generated/host-sdk-index.json` for its exact export. Metric
tags (`power`, `total_power`, `total_act_energy`, …) are defined once on the
backend; never invent one in the UI.

## Fully Separate UI

A UI in another repo or another origin has two integration choices:

- Use the generated OpenAPI/RPC contracts directly.
- Create a local host adapter that exposes the same Host SDK shape.

For a fully separate origin, handle auth, CORS, session refresh, and deployment
origin rules as integration work. Do not assume the in-repo alias
`@/shell/template-host` exists outside this frontend.

## MCP Agent Flow

When an AI agent is using the Fleet Manager docs MCP, it should read:

- `fm://docs/ai-index`
- `fm://ui/host-contract`
- `fm://ui/host-sdk-index`
- `fm://api/openapi`
- `fm://api/rpc-inventory`

Then it should use `search_docs` for:

- `docs/reference/deployment.md`
- `docs/reference/separate-ui-host-sdk.md`
- `docs/architecture/deploy-reference.md`

The MCP server is documentation and contract lookup only. It does not install
Fleet Manager and it does not execute live Fleet Manager RPCs.
