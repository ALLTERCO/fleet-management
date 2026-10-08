<!-- audience: public -->
# Dashboards: authoring guide

Last updated: 2026-04-26

## Concepts

A dashboard is a typed UI surface scoped to one of: a group, a location, a tag,
or unscoped (fleet). It contains a `settings` blob and an ordered list of
`items` (widgets).

- **Type**: one of `classic | analytics | overview | energy | environment | control | safety | map` (`DASHBOARD_TYPES` in `backend/src/types/api/dashboard.ts`). The API accepts all of them. The web Create panel offers only Classic, Energy and Environment; the other types cannot be created from the panel. Existing dashboards still open: overview, map, energy and environment have their own pages, and any other type opens in the classic dashboard view.
- **Scope**: `{groupId? | locationId? | tagId?}` with `maxProperties: 1` (mutually exclusive). Omit `scope` entirely for fleet-wide dashboards. The shape is canonical across `Dashboard.*`, `Energy.*`, `Report.*`, `Scope.*`. See [`backend/src/types/api/fleet.ts`](../../../backend/src/types/api/fleet.ts).
- **Items**: each carries `{kind, size, mobileLayout?, ...typed-FK}` where the typed-FK varies per `kind`: `deviceId` (device), `deviceId + entitySubId` (entity), `groupId` (group), `locationId` (location), `tagId` (tag), `actionId` (action), `widgetKind + widgetConfig` (widget). `kind` is `device | entity | group | location | tag | action | widget`.
- **Settings**: embedded in `Dashboard.Get`. Patched via `Dashboard.Update({id, settings: {...}})`.
- **Default**: per-org. One dashboard at a time. `Dashboard.SetDefault({id})` swaps it atomically.
- **Pins**: per-user, DB-backed. Survives across devices.
- **Templates**: DB rows in `ui.dashboard_template`. 8 builtins ship; orgs can add their own. Org-scoped templates shadow builtins of the same key.

## Sizes

Fixed enum: `1x1, 2x1, 1x2, 2x2, 4x1, 4x2, 4x4` on a 4-column desktop grid.
Mobile uses a narrower set `1x1, 2x1, 1x2, 2x2` via `mobileLayout.size`. When
`mobileLayout` is absent, mobile renders single-column.

## Creating a dashboard

```jsonc
{
  "method": "Dashboard.Create",
  "params": {
    "name": "Plant 1: Energy",
    "dashboardType": "energy",
    "scope": {"groupId": 12}     // or {"locationId": 3} / {"tagId": 7} / omit for fleet
  }
}
```

`Dashboard.Create` accepts `name`, `dashboardType`, an optional `scope` and an
optional `organizationId`. Other fields are refused. The created dashboard
starts empty.

To populate from a template:

1. `Dashboard.Template.Preview({key, scope})` resolves the template
   (org-scoped first, then builtin) and returns the items it would
   materialise against the scope: without persisting.
2. `Dashboard.Item.AddBulk({dashboard, items})` adds them in one shot.

The detect-list per template is what filters items against the scope's
entities. `key` resolution: org-scoped overrides shadow builtins.

## Builtin templates

The API still lists and previews these templates (`Dashboard.Template.List`, `Preview`), including types the web Create panel does not offer. The detect-list per template determines which entity types in scope materialise as widgets:

| key | type | detected entity types |
| --- | --- | --- |
| `overview_default` | overview | em, em1, pm1, switch, temperature, humidity, illuminance, flood, smoke, presence, bthomesensor, bthomedevice, devicepower |
| `energy_default` | energy | em, em1, pm1, switch |
| `environment_default` | environment | temperature, humidity, illuminance, flood, smoke, bthomesensor |
| `control_default` | control | switch, light, cover, input, rgb, rgbw, cct, rgbcct, thermostat, blutrv, bthomecontrol |
| `safety_default` | safety | flood, smoke, presence, bthomesensor, bthomedevice, bthomecontrol |
| `map_default` | map | switch, em, em1, pm1, temperature, humidity, flood, smoke, presence, devicepower |
| `classic_blank` | classic | (empty: manual) |
| `analytics_blank` | analytics | (empty: wizard-driven) |

`bthomesensor` is the canonical entity type for **BLU door/window contact sensors, motion sensors, vibration sensors, dry-contact reed switches, and any other binary state reporter that pairs over BLU**. `bthomedevice` is the device-level summary (battery, RSSI, name, last-seen). `bthomecontrol` is buttons / remotes.

A safety dashboard scoped to a group containing BLU contact sensors materialises one widget per sensor showing its open/closed state plus battery level, alongside flood/smoke/presence cards from native sensors.

## Authoring an org-scoped template

```jsonc
{
  "method": "Dashboard.Template.Create",
  "params": {
    "key": "kitchen_overview",
    "label": "Kitchen overview",
    "dashboardType": "overview",
    "seed": {
      "detectsEntityTypes": ["em", "em1", "switch", "temperature"],
      "staticItems": [
        {"kind": "widget", "widgetKind": "clock_widget", "widgetConfig": {}, "size": "4x1"}
      ],
      "settings": {"defaultRange": "last_24h"}
    }
  }
}
```

Org templates with the same `key` as a builtin shadow the builtin for that org.
`Dashboard.Template.Delete` of a builtin is refused (`DashboardTemplateBuiltinReadonly`,
1502).

## Capturing a dashboard as a template

```jsonc
{
  "method": "Dashboard.Template.SaveFromDashboard",
  "params": {
    "dashboardId": 42,
    "key": "ops_floor_layout",
    "label": "Ops floor layout"
  }
}
```

Captures `items[]` + `settings` as the seed. The created template is org-scoped.

## Pinning + default

- `Dashboard.Pin({id, sortOrder?})`: DB-backed; persists across devices
- `Dashboard.SetDefault({id})`: atomically clears any prior default for the org
- `/dash` route logic (frontend): `GetDefault` → if id, redirect; else `List` → if empty, show gallery; else show list view

## Energy: total calculation

Energy totals are computed from `device_em.stats` (raw, short retention) and
the 15-minute rollup `device_em.energy_15min` (long-term), both tag-based
time series. Per Shelly's official Gen2+ component spec, the live status
contract differs by component family: so we run **two ingestion paths**,
each correct for the device types it covers.

### Live path: `aenergy.total` delta-extraction

[`ShellyMessageHandler.processPendingMessages`](../../../backend/src/modules/ShellyMessageHandler.ts)
runs `EM_STATS_FIELD_RE` over flattened NotifyStatus payloads. Per
Shelly's spec, `aenergy.total` (cumulative Wh) **is** present in live
status only on:

`switch | pm1 | cover | light | rgb | rgbw | cct | rgbcct`

For these, the handler computes `delta = v - lastVal` and stores it as
`total_act_energy` (Wh) when `delta > 0`. Negative deltas: counter
resets after reboot or `Switch.ResetCounters`: are dropped here.
`ret_aenergy.total` follows the same path, tagged
`total_act_ret_energy`.

**EM and EM1 live status do not carry cumulative energy** per Shelly's
spec: only instantaneous fields:

- `em:N.status`: `a/b/c_current`, `a/b/c_voltage`, `a/b/c_act_power`,
  `a/b/c_aprt_power`, `a/b/c_pf`, `a/b/c_freq`, plus aggregates
  `total_current`, `total_act_power`, `total_aprt_power`, `n_current`.
- `em1:N.status`: `voltage`, `current`, `act_power`, `aprt_power`,
  `pf`, `freq`. Each `em1:N` is an independent single-phase channel;
  a 3-channel device exposes `em1:0`, `em1:1`, `em1:2`.

The live path captures the *power* fields above (tagged `power`,
`apparent_power`, `power_factor`, etc.) for EM/EM1 but cannot derive
energy from them.

### Backfill path: `EMData.GetData` / `EM1Data.GetData`

[`ShellyEmHandler.sync`](../../../backend/src/modules/ShellyEmHandler.ts) syncs
each device on a schedule (default 540 s plus 0 to 59 s of jitter, so about
9 to 10 min; a faster catch-up lane serves devices that are behind) and is the
**sole source of energy data for em / em1**. Mode is auto-detected from
status keys (`em:N` → 3-phase, `em1:N` → single-phase): no hardcoded
model list.

Per the official `EMData` / `EM1Data` spec:

- **3-phase (`EMData.GetData`)** returns periodised history. Status
  exposes per-phase Wh counters `a_total_act_energy`,
  `b_total_act_energy`, `c_total_act_energy` plus aggregate `total_act`
  (sum of phases). `GetData` returns the same per-phase keys as
  *period totals* (already-deltas, in Wh) per bucket.
  **FM only ingests the per-phase keys** (a/b/c) and ignores the
  aggregate `total_act`, so there is no double-count. Each phase row
  lands with `tag='total_act_energy'`, `phase='a'|'b'|'c'`, `channel=0`.
- **Single-phase (`EM1Data.GetData`)** returns periodised history with
  key `total_act_energy` (Wh) per channel. One RPC call per `em1:N`
  channel; each row lands with `tag='total_act_energy'`, `phase='z'`,
  `channel = 0 | 1 | 2`.

### Mode summary: multi-meter EM

| Mode | Component(s) | Live `aenergy.total`? | Energy source | Stats rows per period (per device) |
| --- | --- | --- | --- | --- |
| 3-phase EM (Pro 3EM) | `em:0` | no | EMData.GetData per-phase | 3 (phase a/b/c, channel 0) |
| Single-phase EM (Pro 3EM-3CT63 monophase) | `em1:0..2` | no | EM1Data.GetData per channel | 3 (phase 'z', channel 0/1/2) |
| Switch / PM1 / cover / light / rgb* | one per component | yes | Live `aenergy.total` delta | 1 per energy-bearing channel |

Summing `tag='total_act_energy'` for a device yields the correct
device total in every mode: no double-counting because each
`(device, tag, channel, phase, ts)` tuple is unique by construction.

### Aggregation

There is no `Energy.Summary` method. It was removed and `Energy.Query`
replaced it. For one total per group use `Energy.Query` with `groupBy` and
`totals: true` (logical-meter path: energy tags only, buckets from 15 minutes
to 1 day). Otherwise sum the rows of a plain `Energy.Query` with a large
`bucket`. For live power use `Energy.Current`.

### Time series and totals: `Energy.Query`

```jsonc
{
  "method": "Energy.Query",
  "params": {
    "from": "2026-04-01T00:00:00Z",
    "to":   "2026-04-25T00:00:00Z",
    "tags": ["total_act_energy", "power"],
    "bucket": "1 hour",                  // 1 minute|5 minutes|15 minutes|30 minutes|1 hour|6 hours|12 hours|1 day|1 week|1 month
    "scope": {"groupId": 12},            // XOR with `devices: [shellyID,...]`
    "perDevice": true,
    "perPhase": false                    // when true, rows carry phase: 'a'|'b'|'c'
  }
}
// → { items: [{ bucket, device, shellyID, tag, value, min?, max?, phase? }],
//     total, limit, offset, has_more,
//     meta: { from, to, bucket, executionMs, fromMaterializedView? } }
```

`scope` accepts `{groupId|locationId|tagId}` (max one axis); omit `scope`
*and* `devices` for fleet-wide. Buckets of 1 and 5 minutes read raw readings;
15 minutes and longer read the 15-minute rollup. The range limit is 365 days. `perPhase: true` is the only way to read
individual phases of a 3-phase em device: without it, all three phases
are summed per bucket.

### Properties verified against code

- **No double counting.** Each emitted energy field has a unique
  `(device, tag, channel, phase, ts)` tuple: verified against the
  `EM_STATS_FIELD_RE` regex and `EMData.GetData` field set.
- **Counter wrap / reboot safety** is enforced in the live path
  (`delta > 0` filter).
- **Tariff cost** can be computed on the server. `Energy.Query` takes a
  `pricing` option (stored tariffs, device/channel assignments, up to 30 days),
  and the `Tariff.*` and `Bill.*` methods manage tariffs and bills.
- **Scope picker**: the energy dashboard settings offer "Whole fleet" or
  "A group".

### Companion live RPCs

- `fleet.GetCapabilities({scope})`: which metric capabilities the slice's
  devices can report (`uptime`, `voltage`, `current`, `power`,
  `consumption`, `returned_energy`, `temperature`, `humidity`,
  `luminance`). Derived from each device's live entity types: the device
  is the single source of truth.
- `fleet.GetMetrics({scope})`: last-known per-entity values for live
  cards, plus a 3-phase balance summary in `phaseMetrics`. No DB scan;
  offline devices are skipped. Both methods accept the same canonical
  scope shape (`{groupId|locationId|tagId}`) or no scope for fleet-wide.

## Mobile layouts

Each item may carry `mobileLayout`:

```jsonc
"mobileLayout": {
  "hidden": false,
  "size": "1x1",
  "order": 0
}
```

When a phone's viewport falls below the breakpoint, the FE picks `mobileLayout.size`/`order`. Items with `hidden: true` are skipped on mobile entirely.

## Grafana export / import

```jsonc
// FM → Grafana
{"method": "Dashboard.Export", "params": {"id": 42, "format": "grafana"}}
// → {format: "grafana", json: <Grafana dashboard JSON, schemaVersion 39>}

// Grafana → FM
{"method": "Dashboard.Import", "params": {"json": <Grafana JSON>, "format": "grafana"}}
```

- Floor `schemaVersion` is configurable via `FM_DASHBOARD_GRAFANA_SCHEMA_VERSION_FLOOR` (default 39). Import below the floor is refused (code 1506).
- FM-emitted Grafana JSON carries `tags: ['fm:<type>', ...]` plus exactly one of `fm:groupId:N`, `fm:locationId:N`, `fm:tagId:N` (the dashboard's scope axis). Unscoped dashboards omit the scope tag. An annotation `__fm_settings` rides along; round-trip preserves shape.
- Grafana panels with unmappable types become FM `widget` placeholders (the original Grafana JSON rides along in `widgetConfig`).

## Tunables (ENV)

| Var | Default | What |
| --- | --- | --- |
| `FM_DEFAULT_DASHBOARD_NAME` | `Default Dashboard` | Auto-bootstrap dashboard name (legacy: retiring). |
| `FM_DEFAULT_DASHBOARD_TYPE` | `classic` | Auto-bootstrap dashboard type. |
| `FM_DASHBOARD_MAX_ITEMS` | `200` | Hard cap per dashboard. |
| `FM_DASHBOARD_MAX_TEMPLATES_PER_ORG` | `100` | Hard cap on org-scoped templates. |
| `FM_DASHBOARD_MAX_PINS_PER_USER` | `50` | Hard cap on per-user pin count. |
| `FM_DASHBOARD_GRAFANA_SCHEMA_VERSION_FLOOR` | `39` | Min Grafana schemaVersion accepted on import. |
| `FM_DASHBOARD_GRAFANA_SCHEMA_VERSION_WRITE` | `39` | Grafana schemaVersion stamped on export. |

## Domain error codes

| Code | Kind | When |
| --- | --- | --- |
| 1500 | DashboardNotFound | id doesn't exist or wrong org |
| 1501 | DashboardTemplateNotFound | key not found |
| 1502 | DashboardTemplateBuiltinReadonly | tried to modify or delete a builtin |
| 1503 | DashboardItemNotFound | itemId doesn't belong to dashboard |
| 1504 | DashboardScopeMismatch | item's typed FK references an entity outside the dashboard scope |
| 1505 | DashboardImportSchemaMismatch | JSON doesn't match expected format |
| 1506 | DashboardImportUnsupportedGrafanaVersion | Grafana schemaVersion below floor |
| 1507 | DashboardDefaultConflict | another default exists (race; partial unique idx prevents normally) |
| 1508 | DashboardItemRefInvalid | typed FK fields don't satisfy the kind ↔ FK CHECK (e.g. `kind: 'device'` without `deviceId`) |

See [`docs/generated/api.md` §Errors](../../generated/api.md#errors) for the canonical error envelope.

## Related code

- Backend handlers: [`backend/src/model/component/DashboardComponent.ts`](../../../backend/src/model/component/DashboardComponent.ts)
- Codec: [`backend/src/modules/dashboardGrafanaCodec.ts`](../../../backend/src/modules/dashboardGrafanaCodec.ts)
- Schemas: [`backend/src/types/api/dashboard.ts`](../../../backend/src/types/api/dashboard.ts)
- DB migrations: `backend/db/migration/postgresql/ui/65{00..33}*.sql`, `20001_seed.dashboard_template.sql`
