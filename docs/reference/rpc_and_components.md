# RPCs and Components

Fleet Manager uses JSON-RPC 2.0 over WebSocket and HTTP. Method names
follow Shelly's `Component.Method` pattern; method names are
case-insensitive on input. The transport contract — auth, HTTP `/rpc`
shape, response envelopes — is described in [docs/generated/api.md](generated/api.md).

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "src": "demo",
  "method": "Admin.ListCommands",
  "params": {}
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "src": "FLEET_MANAGER",
  "dst": "demo",
  "result": ["system", "admin", "device", "switch", "cover", "..."]
}
```

The complete, auto-generated method surface lives at
[docs/generated/backend-rpc-inventory.md](generated/backend-rpc-inventory.md).

## Three API surfaces

Per-device operations are reached through three typed entry points
plus an explicit raw escape hatch.

| Surface | Use |
| --- | --- |
| `Entity.InvokeAction` | Typed actions on existing entities (`toggle`, `open`, `setBrightness`, …). Primary product-UI path. |
| `<Component>.<Method>` | Per-component canonical namespaces — `Switch`, `Cover`, `Input`, `Light`, `Rgb`, `Rgbw`, `Cct`, `RgbCct`, `BTHome`, `Cury`, `Matter`, `Pill`, `Camera`, `Meter`, `Trv`, `Thermostat`, `Ui`, `Media`, `Dali`, `Addon`, `Virtual`, `Illuminance`, `Smoke`, `Service`, `Sys`, `Mqtt`, `Ws`, `BluGw`, `Network`, `Security`. Each takes `{shellyID, id?, …}`. |
| `Device.*` (fleet primitives) | `Describe`, `List`, `Get`, `GetInfo`, `GetSetup`, `GetDeviceChannels`, `GetStatusHistory`, `GetStatusTimeline`, `Delete`, `Reboot`, `FactoryReset`, `CheckForUpdate`, `Update`, `SetProfile`, `ListProfiles`. |
| `Device.Call` | Raw firmware RPC — advanced/admin raw tools only (Actions Tab, ConfigDeployModal, user-authored automations/actions). |

For request/response shapes and live curl examples, see
[docs/generated/api.md § API Surface](generated/api.md#api-surface) and
the per-namespace reference below it (one section per registered
namespace, e.g. `device-namespace`, `user-namespace`).

## Components

A component is an encapsulated functional unit which exposes methods
for communication with the outside world. Each component declares its
own permission rules and audit policy. Method names are
case-insensitive on input.

### Default introspection methods (when enabled)

#### GetStatus

Return the current status of the component.

#### GetConfig

Return the configuration of the component.

#### SetConfig

Updates the configuration of the component (FM-side; for firmware
config use the canonical `<Component>.SetConfig`).

#### ListMethods

Returns an array of all the supported methods by the component.

#### Describe

Returns the namespace's full Describe output — methods, param/response
schemas, permissions, errors. Use this for runtime introspection of
any namespace's contract.

## Server-side components

`System` (subscriptions + runtime variables), `Admin` (raw RPC
passthrough, allowlisted Postgres helper), `Plugin` /
`PluginManager`, `MDNS`, `Web`, `Firmware`, `Backup`, `Alert`,
`Notification`, `Dashboard`, `Group`, `Location`, `Tag`, `Energy`,
`Report`, `Channel`, `Policy`, `Variables`, `Storage`,
`WaitingRoom`, `Automation`, `Presence`, `User`, `Organization`,
`Audit`, and `Mail`. These are not per-device.

### Admin

#### Admin.ListCommands

Returns all registered RPC components and their command names.

#### Admin.SendRPC

Sends a raw JSON-RPC call to one or more devices.

#### Admin.PostgresCall

Executes an allowlisted PostgreSQL stored procedure (admin only).

### Plugin

Each plugin has its own component. The name of the component is the
name of the plugin prefixed with `plugin:`. A plugin named `greetings`
is accessible through the component `plugin:greetings`. To enable the
greetings plugin:

```json
{ "id": 1, "dst": "FLEET_MANAGER", "method": "plugin:monitoring.setconfig", "src": "demo", "params": { "config": { "enable": true } } }
```

Component configuration persists on reboot. Once enabled, the plugin
auto-starts on the next boot.

### mDNS

```json
{"id":1,"dst":"FLEET_MANAGER","method":"mdns.getstatus","src":"demo"}
```

```json
{"id":1,"dst":"FLEET_MANAGER","method":"mdns.setconfig","src":"demo","params":{"config":{"enable":true}}}
```

## See also

- [docs/generated/api.md](generated/api.md) — full public API reference (auth, endpoints, methods, examples)
