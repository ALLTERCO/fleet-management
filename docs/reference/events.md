# Events

Fleet Manager sends events in the form of notifications using the [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification). There are two types of events:

1. Related to Fleet Management
2. Related to the connected Shelly devices

## Fleet Manager Events

### System.Config

`System.Config` (formerly `FleetManager.Config`) is reserved for Fleet Manager config-bucket updates.

> **Note:** No emitter currently exists in `backend/src/` — this event is reserved for future use. The shape below documents the intended payload once emission is wired up.

```typescript
interface Config extends Basic {
    method: "System.Config";
    params: {
        name: "main";
        config: any;
    };
}
```

## Shelly Events

> **Note on `params.metadata`:** all device-scoped events
> (`Shelly.*`) are dispatched through `EventDistributor` and gain a
> `metadata` field of shape
> `{ groups: Array<{id: number; name: string}> }` listing the groups
> that own the device. The type definitions below show the
> emitter's payload; `metadata` is added at distribution time. Verified
> live for `Shelly.Status` and `Shelly.Message`.

### Shelly.Connect

Type definition:

```typescript
interface Connect extends Basic {
    method: "Shelly.Connect"
    params: {
        shellyID: string
        device: {
            shellyID: string,
            source: string,
            info: any,
            status: any,
            settings: any,
            kvs: Record<string, string>
        }
    }
}

```

### Shelly.Disconnect

Type definition:

```typescript
interface Disconnect extends Basic {
    method: "Shelly.Disconnect"
    params: {
        shellyID: string
    }
}
```

### Shelly.Delete

Type definition:

```typescript
interface Delete extends Basic {
    method: "Shelly.Delete"
    params: {
        shellyID: string
    }
}
```

### Shelly.Info

Type definition:

```typescript
interface Info extends Basic {
    method: "Shelly.Info",
    params: {
        shellyID: string,
        info: any
    }
}
```

### Shelly.Status

Type definition:

```typescript
interface Status extends Basic {
    method: "Shelly.Status"
    params: {
        shellyID: string
        status: any
        metadata: { groups: Array<{id: number; name: string}> }
    }
}
```

### Shelly.Settings

Type definition:

```typescript
interface Settings extends Basic {
    method: "Shelly.Settings"
    params: {
        shellyID: string
        settings: any
    }
}
```

### Shelly.Message

Type definition:

```typescript
interface Message extends Basic {
    method: "Shelly.Message"
    params: {
        shellyID: string
        message: ShellyMessageIncoming
        req?: ShellyMessageData
        metadata: { groups: Array<{id: number; name: string}> }
    }
}
```

`req` is the JSON-RPC request that was send to the device. If the `req` object is `undefined` this means the Shelly device is sending a notification. If `req` is present, the Shelly device is responding to a command that was been send over Fleet Manager.

### Shelly.KVS

Type definition:

```typescript
interface KVS extends Basic {
    method: "Shelly.KVS"
    params: {
        shellyID: string,
        kvs: Record<string, string>
    }
}
```

### Shelly.Presence

Type definition:

```typescript
interface Presence extends Basic {
    method: "Shelly.Presence"
    params: {
        shellyID: string
        presence: "online" | "offline" | "pending"
    }
}
```

### Shelly.PresenceTrack

Type definition:

```typescript
interface PresenceTrack extends Basic {
    method: "Shelly.PresenceTrack"
    params: {
        shellyID: string
        objects: Array<{
            id: number
            x: number
            y: number
            z: number
            minz: number
            maxz: number
        }>
        ts: number
    }
}
```

### Shelly.OtaProgress

Type definition:

```typescript
interface OtaProgress extends Basic {
    method: "Shelly.OtaProgress"
    params: {
        shellyID: string
        event: "ota_begin" | "ota_progress" | "ota_success" | "ota_error"
        progress_percent?: number
        msg?: string
    }
}
```

## Entity Events

### Entity.Added

Type definition:

```typescript
interface Added extends Basic {
    method: "Entity.Added"
    params: {
        entityId: string
    }
}
```

### Entity.Removed

Type definition:

```typescript
interface Removed extends Basic {
    method: "Entity.Removed"
    params: {
        entityId: string
    }
}
```

### Entity.Event

Type definition:

```typescript
interface Event extends Basic {
    method: "Entity.Event"
    params: {
        entityId: string
        event: "single_push" | "double_push" | "triple_push" | "long_push"
    }
}
```

### Entity.StatusChange

Type definition:

```typescript
interface StatusChange extends Basic {
    method: "Entity.StatusChange"
    params: {
        entityId: string
        status: any
    }
}
```

## BT Home Events

### BTHome.DiscoveryResult

Type definition:

```typescript
interface DiscoveryResult extends Basic {
    method: "BTHome.DiscoveryResult"
    params: {
        type: string
        mac: string
        shellyID: string
    }
}
```

### BTHome.DiscoveryDone

Type definition:

```typescript
interface DiscoveryDone extends Basic {
    method: "BTHome.DiscoveryDone"
    params: {
        shellyID: string
        discoveredDevicesCount: number
    }
}
```

## Console Events

### Console.Log

Single-entry type definition:

```typescript
interface Log extends Basic {
    method: "Console.Log"
    params: {
        coloredPart: string
        log: string
        color: string
    }
}
```

The same event name is also emitted in batch form with:

```typescript
{
    method: "Console.Log",
    params: {
        batch: Array<{ coloredPart: string; log: string; color: string }>
    }
}
```

## Waiting Room Events

### WaitingRoomEvent.Accepted

Type definition:

```typescript
interface Accepted extends Basic {
    method: "WaitingRoomEvent.Accepted"
    params: {
        id: number
    }
}
```

Current backend code also emits a batched variant with the same method name and `params: { ids: number[] }` for accept-all flows.

### WaitingRoomEvent.Denied

Type definition:

```typescript
interface Denied extends Basic {
    method: "WaitingRoomEvent.Denied"
    params: {
        id: number
    }
}
```

## Application domain events

These events fire on application-level state changes (not device
status). Subscribe via `System.Subscribe({events: [...]})`.

### Alert events

| Name | When | Payload |
| --- | --- | --- |
| `Alert.Created` | An alert instance is created (rule fired). | `{id, ruleId, severity, subjectType, subjectId, ...}` |
| `Alert.Updated` | An instance state changes (acked, silenced, unsilenced). | `{id, state, ...}` |
| `Alert.Resolved` | An instance resolves (auto or manual). | `{id, resolution}` |

### Notification events

| Name | When | Payload |
| --- | --- | --- |
| `Notification.Created` | A notification item lands in a user's inbox. | `{id, userId, sourceAlertId?, ...}` |
| `Notification.ReadStateChanged` | Inbox item's read state flipped. | `{id, read}` |
| `Notification.DeliveryUpdated` | A delivery job advanced (queued → in-flight → succeeded/failed/dead). | `{jobId, status, attempts}` |

### Channel events

| Name | When | Payload |
| --- | --- | --- |
| `Channel.AutoDisabled` | A channel hit consecutive-failure threshold and was auto-disabled. | `{channelId, reason, lastError}` |
| `Channel.HealthReset` | An admin called `Channel.ResetHealth`. | `{channelId, by}` |

### Scope events (Group / Location / Tag / Organization / Dashboard)

| Name | When | Payload |
| --- | --- | --- |
| `Group.Created` / `Group.Updated` / `Group.Deleted` | CRUD on a group. | `{id, name?}` |
| `Group.MembersAdded` / `Group.MembersRemoved` | Group membership change. | `{id, members: [...]}` |
| `Location.Created` / `Location.Updated` / `Location.Deleted` | CRUD on a location. | `{id, name?}` |
| `Location.AssignmentSet` | A device or entity was assigned to a location. | `{subjectType, subjectId, locationId}` |
| `Location.AssignmentRemoved` | A device or entity was removed from a location. | `{subjectType, subjectId, locationId}` |
| `Tag.Created` / `Tag.Updated` / `Tag.Deleted` | CRUD on a tag. | `{id, key?}` |
| `Tag.Assigned` / `Tag.Unassigned` | Tag assignment changed. | `{id, subjects: [...]}` |
| `Dashboard.Created` / `Dashboard.Updated` / `Dashboard.Deleted` | CRUD on a dashboard. | `{id, name?}` |
| `Dashboard.ItemsChanged` / `Dashboard.SettingsChanged` | Layout / settings edit. | `{id}` |
| `Organization.ProfileUpdated` | Org profile patched. | `{id}` |

### BTHome auxiliary events

| Name | When | Payload |
| --- | --- | --- |
| `BTHome.ControlLearning` | A `BTHome.Control.StartLearning` flow received a broadcast. | `{shellyID, state}` |
| `BTHome.ControlsUpdated` | Learned-control list changed (add / delete). | `{shellyID}` |

### WaitingRoom events

`WaitingRoomEvent.Accepted` and `WaitingRoomEvent.Denied` fire when a
pending device passes through the waiting-room queue (see §2).
