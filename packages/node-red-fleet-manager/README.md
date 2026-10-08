# Fleet Manager Node-RED Nodes

Node-RED nodes for Shelly Fleet Manager. Version 0.1.0, Apache-2.0.
Not published to npm yet; it ships inside the Fleet Manager Node-RED sidecar.

Needs Node-RED 4 or newer and Node.js 20 or newer.

## Nodes

| Node | What it does |
|---|---|
| `fm-server` | Connection to Fleet Manager (URL, WebSocket URL, service token). |
| `fm-device-event` | Starts a flow from Fleet Manager events (`Shelly.Status`, `Shelly.Connect`, `Entity.Event`, `Alert.Created`, ...). |
| `fm-trigger-threshold` | Fires when a status value goes above or below a limit, optionally for N seconds. Second output when it is back to normal. |
| `fm-trigger-status` | Fires when a device goes online or offline, optionally only after N seconds. Can send the current state on start. |
| `fm-trigger-button` | Fires on button and input presses (`single_push`, `double_push`, `long_push`, ...). |
| `fm-webhook-in` | Starts a flow from an outside HTTP call to `/automation-hooks/<hook id>` on Fleet Manager, checked with a per-hook secret. |
| `fm-target` | Puts a target (devices, groups, places, tags, fleet) on `msg.fm.target`; only methods whose `target` has these fields use it (today `certificate.PreflightPush`). |
| `fm-rpc` and the operation nodes | Call one Fleet Manager method: `fm-tag`, `fm-group`, `fm-location`, `fm-device`, `fm-component-catalog`, `fm-component-state`, `fm-component-action`, `fm-schedule`, `fm-variable`, `fm-webhook`, `fm-script`, `fm-firmware`, `fm-backup`, `fm-certificate`, `fm-diagnostics`, `fm-alert`, `fm-report`, `fm-energy`, `fm-notification`, `fm-audit`. |

Event and trigger nodes can watch all devices, chosen devices, a group or a
place. Groups and places are turned into device ids through Fleet Manager and
refreshed every few minutes. The editor has device, group and place pickers.

## Safety

The catalog leaves out risky methods: database access, firmware writes and
OTA, device security material, credentials, tokens, users and roles. The
nodes also refuse those methods at runtime, even when the method name comes
from a message. The full list is `deniedMethods` in `generated/catalog.json`.
Fleet Manager still checks the service account's permissions on every call.

By default (`FM_NODE_RED_PERMISSIONS` unset) Node-RED may read devices,
groups, places, tags, dashboards and variables, control devices, save
variables and send through notification channels. It may not change device
settings or create, change or delete groups, places or tags: flows run
unattended, so writes stay limited to what the shipped nodes need. The
pickers, scope filters, activity reports and examples need exactly these;
`lib/fm-methods.js` lists the methods the package calls on its own.

## Audit and activity

Every HTTP call to Fleet Manager carries:

- `x-fm-automation-flow-id`
- `x-fm-automation-node-id`
- `x-fm-automation-flow-name` (URI-encoded)

Nodes also report runs and errors with `automation.ReportActivity`. Reports
are throttled (one run per node per 30 s, one error per node per 5 s) and never
break a flow, even on a Fleet Manager without that method. A refused report
logs a node warning, at most once per node every 10 minutes.

## Event connection

Each event node keeps one WebSocket subscription. It shows green only after
Fleet Manager confirms the subscription, retries with growing delays (up to
60 s, with jitter), and asks Fleet Manager to replay what it missed after a
short drop.

## Settings from the environment

- `FM_BASE_URL`, `FM_WS_URL`: used when the `fm-server` fields are empty.
- `FM_NODE_RED_SERVICE_TOKEN`: used when the `fm-server` token is empty.
- `FM_NODE_RED_RPC_TIMEOUT_MS`: HTTP call timeout, default 30000.

## Turning it on

- Self-hosted (public installer): `./deploy/deploy-public.sh up --nodered`
- Private stack: `./deploy/deploy.sh up --with nodered`

Both install this package from the shipped folder; npm access is not needed.

## Local image (private stack)

```sh
docker build -f packages/node-red-fleet-manager/Dockerfile.local \
  -t fm-nodered:local \
  packages/node-red-fleet-manager

NODE_RED_IMAGE=fm-nodered:local ./deploy/deploy.sh up --with nodered
```

Users open the editor through Fleet Manager at `/node-red/red`.

## Examples

See `examples/README.md`. Import them from the Node-RED menu.

## Catalog

`generated/catalog.json` is written by:

```sh
cd backend
npx tsx scripts/generate/node-red-catalog.ts
```

The same generator writes `docs/generated/node-red-catalog.{json,md}`; the
two JSON copies are identical.

## Tests

```sh
node --test packages/node-red-fleet-manager/test/
```

No extra dependencies: the tests use a small fake Node-RED runtime.
