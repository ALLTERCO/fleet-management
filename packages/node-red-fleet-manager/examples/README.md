# Fleet Manager Node-RED examples

Importable flows. Every method and event they use exists in Fleet Manager;
`test/examples.test.js` checks this against the generated catalog and the
backend event inventory.

| File | What it does | Nodes used |
|---|---|---|
| `basic-rpc-flow.json` | One RPC call (`system.Describe`) | fm-server, fm-rpc |
| `device-offline-alert.json` | Device offline for 5 minutes, send a message through a channel with `channel.Test` | fm-trigger-status, function, fm-notification |
| `sunset-schedule.json` | Every day at 18:00, `light.Set` on every device of a group (from `device.List`) | inject, fm-device, function, fm-component-action |
| `energy-rollup.json` | Every hour, sum `energy.Query` for the last hour and store it with `variables.Set` | inject, function, fm-energy, fm-variable |
| `alert-to-webhook.json` | `Alert.Created` / `Alert.Resolved` posted to an outside URL | fm-device-event, function, http request |
| `power-threshold-switch-off.json` | Power above 2000 W for 30 s turns the switch off | fm-trigger-threshold, function, fm-component-action |
| `webhook-to-switch.json` | An outside call to `/automation-hooks/<hook id>` turns a switch on or off | fm-webhook-in, function, fm-component-action |

Values you must change are named in each tab's description (group id,
channel id, device id, outside URL, hook secret).

`channel.Test` sends straight through one channel. Fleet Manager has no
send-only notification method, so the service account holds
`notification:update` for it. For production alerting, prefer alert rules
with notification routing.

All examples run with the default service account permissions. The hourly
energy rollup reads the whole fleet (`dashboard:read`) and saves a variable
(`action:update`).

## Importing

1. Open Node-RED at `<your-fm>/node-red/red/`
2. Menu → Import → Clipboard → paste the JSON
3. Check the `fm-server` config node (empty fields use the sidecar environment)
4. Deploy

## Authentication

In the managed sidecar the `fm-server` node uses
`FM_NODE_RED_SERVICE_TOKEN` from the environment when its token field is
empty. The service account's permissions decide what a flow may do.
