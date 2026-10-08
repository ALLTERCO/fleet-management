<!-- audience: public -->
# Separate UI and Host SDK guide

Use this guide when building a Fleet Manager UI that is not the standard
frontend screen.

## Rule

Separate UIs should use Fleet Manager through the Host SDK contract first.
Raw RPC/OpenAPI calls are for backend/API integration work or for extending the
host layer itself.

The SDK keeps one framework-neutral core with thin Vue/React bindings. It does
not create a complete SDK per renderer.

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

For a development runtime, run Fleet Manager from source with hot reload:

```bash
./deploy/deploy-public.sh up --env dev
```

It needs Node.js 24 and Docker. The login is `admin` / `admin`. Dev mode has no
SSO and runs over plain HTTP, so use it only on a trusted machine.

To add demo data to a running deployment:

```bash
./deploy/deploy-public.sh seed --dev     # dev mode login (admin / admin)
./deploy/deploy-public.sh seed           # a normal deployment with Zitadel
```

Seed is for demo data: countries, buildings, groups, tags, persona, and
optional demo devices. Do not use it as production initialization.

For a normal deployment with HTTPS:

```bash
./deploy/deploy-public.sh up --ssl --domain fm.example.com
```

The install and upgrade steps are in the
[Deployment Guide](../deployment.md). The full command reference is in
[`deploy-public.sh` reference](../public/reference/deploy-public-reference.md).

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
hints, recommended wrapper) is in `docs/generated/api-catalog.json`, or in
code via the `HOST_METHOD_METADATA` export from `@/shell/template-host`.

`host.api`, `call`, `listAll`, `useTemplateRpc`, and `host.devices.call` are
raw escape hatches: supported, but they skip the curated wrappers. Prefer the
named domain methods; use the escape hatches only when extending the SDK.

### Reading device data, live, history, totals

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
  scope: {group: groupId},   // or devices: ['shelly-xxxx'], mutually exclusive
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

## Region, Currency And Billing Time Zone

Three organization-level settings sound alike and are not. A template that
confuses them can produce a wrong bill.

- **Region** (`organizationProfile.localeDefault`, a BCP-47 tag such as
  `en-GB`) decides only how a date, a number, or an amount is WRITTEN, day
  order, decimal separator, symbol placement. Never use it to guess a
  currency or a time zone.
- **Currency** decides what a person is CHARGED. It always comes from the
  tariff (the `tariffs` and `billing` domains, e.g. `billing.quote().currency`),
  never from the region and never from `organizationProfile.currencyDefault`
  (that field is only a fallback default for a new tariff or a report with no
  tariff scope).
- **Billing time zone** decides which DAY a reading is counted on. It always
  comes from the tariff's own time zone and `billingDay`, never from the
  region and never from `organizationProfile.timezoneDefault` (that field
  only anchors a report that has no tariff-specific zone).

Prefer the `format` helper over reading `organizationProfile.localeDefault`
directly, a raw tag can be misused, `format.amount` cannot, because it
requires the currency instead of guessing one:

```ts
import {useFormat} from '@/shell/template-host'; // or '@host/vue', '@host/react'

const format = useFormat();
format.date(reading.ts);                    // "Mar 4, 2026", in the org's region
format.number(reading.kwh);                  // "1,234.5", in the org's region
format.amount(quote.total, quote.currency);  // quote.currency is the tariff's own
```

`format` is also on the framework-neutral `TemplateRuntimeContext` as
`context.format`, next to `context.organizationProfile`. See `FleetFormat` in
`frontend/src/shell/template-host/core/types.ts` for the full type.

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

- `docs/deployment.md`
- `docs/reference/separate-ui-host-sdk.md`
- `docs/public/reference/deploy-public-reference.md`

The MCP server is documentation and contract lookup only. It does not install
Fleet Manager and it does not execute live Fleet Manager RPCs.
