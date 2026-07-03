# Entities

Entities are FM's typed view of a device's controllable parts —
switches, covers, lights, sensors, meters, virtuals, etc. Each entity
has a stable `id`, a `type`, a `source` (the owning device's
shellyID), and `properties` (channel index plus type-specific
metadata).

For the API surface — `Entity.InvokeAction`, `Entity.Get`,
`Entity.List`, `Entity.GetCapabilities`, `Entity.GetActionSchema` —
see the [`entity` namespace in the API reference](generated/api.md#entity-namespace).

## Examples

### Switch

```json
{
    "name": "Plug Output",
    "id": "shellyplusplugs-d4d4da7bfac0_0:out",
    "type": "switch",
    "source": "shellyplusplugs-d4d4da7bfac0",
    "properties": { "id": 0 }
}
```

### Input

```json
{
    "name": "Plug Input",
    "id": "shellyplusplugs-d4d4da7bfac0_0:in",
    "type": "input",
    "source": "shellyplusplugs-d4d4da7bfac0",
    "properties": { "id": 0 }
}
```

### Cover

```json
{
    "name": "Living Room Blind",
    "id": "shelly2pmg3-abc_0:cover",
    "type": "cover",
    "source": "shelly2pmg3-abc",
    "properties": { "id": 0 }
}
```

### Light family (light / rgb / rgbw / cct / rgbcct)

```json
{
    "name": "Bulb",
    "id": "shellybulbg3-abc_0:rgbcct",
    "type": "rgbcct",
    "source": "shellybulbg3-abc",
    "properties": { "id": 0 }
}
```

### Sensor (read-only)

```json
{
    "name": "Living Room Temperature",
    "id": "shellyht-abc_0:temperature",
    "type": "temperature",
    "source": "shellyht-abc",
    "properties": { "id": 0 }
}
```

### Virtual Device (composite)

```json
{
    "name": "Plug Virtual Device",
    "id": "shellyplusplugs-d4d4da7bfac0_0:virtual",
    "type": "virtual_device",
    "properties": {
        "input": "shellyplusplugs-d4d4da7bfac0_0:in",
        "output": "shellyplusplugs-d4d4da7bfac0_0:out"
    }
}
```

## Acting on an entity

Use `Entity.InvokeAction` for typed product actions:

```json
{
  "jsonrpc": "2.0",
  "method": "Entity.InvokeAction",
  "params": {
    "id": "shellyplusplugs-d4d4da7bfac0_0:out",
    "action": "toggle"
  },
  "id": 1
}
```

For firmware-side config edits, call the canonical namespace directly:

```json
{
  "jsonrpc": "2.0",
  "method": "Switch.SetConfig",
  "params": {
    "shellyID": "shellyplusplugs-d4d4da7bfac0",
    "id": 0,
    "config": { "auto_off": true, "auto_off_delay": 60 }
  },
  "id": 1
}
```

## Location `geo` shape

Locations carry a `geo` JSONB with provenance: `source` is `manual`,
`autocomplete`, or `imported`. `autocomplete` picks include `geonameid`,
`matchedName`, and `verifiedAt`; `manual` rejects those upstream refs.
See [docs/geocoding.md](geocoding.md).
