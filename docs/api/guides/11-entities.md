## Entities

An **entity** is Fleet Manager's normalized, typed view of one controllable or
observable part of a device — a switch, a cover, a light, a sensor, a meter. It
lets you drive a mixed fleet through one shape instead of learning each device's
component RPCs.

Every entity has a stable `id`, a `type`, a `source` (the owning device's
shellyID), an `online` flag, and type-specific `properties`. The `id` is
globally unique, formatted `<shellyID>_<channel>:<type>` (for example
`shellyplusplugs-d4d4da7bfac0_0:out`). `online` is derived from the parent
device's presence, so a Bluetooth sensor whose gateway dropped reports
`online: false`. There are 52 entity types.

### Capabilities and actions

An entity advertises what it can do, so you never hardcode per-device calls:

- `Entity.GetCapabilities` returns `{ type, actions }` — the verbs this entity
  supports (`toggle`, `setBrightness`, `open`, `setTarget`, …). The runtime set
  is the declared set intersected with the device's actual methods, so an action
  a given device can't do is simply absent.
- `Entity.GetActionSchema` returns the JSON Schema for one action's params — use
  it to build forms and validate input without knowing the shape ahead of time.
- `Entity.InvokeAction` (`{ id, action, params }`) runs the action; the backend
  translates it to the correct device RPC (e.g. `toggle` → `Switch.Toggle`).

### Key methods

- `Entity.List` — entities you can read (paginated; `limit` 0 = unlimited,
  default 500).
- `Entity.Get` — one entity's normalized summary.
- `Entity.GetCapabilities`, `Entity.GetActionSchema`, `Entity.InvokeAction`.

### Reading state vs changing config

Entities cover control and live state. To change a device's **configuration**,
call the canonical component namespace directly (for example
`Switch.SetConfig`) rather than going through the entity. See
[The device model](#the-device-model) for how components and namespaces fit
together, and [Virtual devices](#virtual-devices) for logical entities not
backed by a single physical device.
