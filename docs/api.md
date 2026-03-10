# Shelly Fleet Management - API

The method field of all the requests is not case-sensitive.

## Authentication

Fleet Manager uses **Zitadel** for authentication. To access the API programmatically, you need a **Personal Access Token (PAT)**.

### Creating a Personal Access Token

1. Log into the Zitadel Console (e.g., `https://<YOUR_ZITADEL_HOST>/ui/console/`)
2. Go to **Users**
3. Click **Service Users** tab
4. Click **New** to create a new service user:
   - Enter a username (e.g., `api-service`)
   - Enter a name/description
   - Click **Create**
5. After creation, go to the service user's detail page
6. Navigate to **Authorizations** tab and grant access to the Fleet Manager project with appropriate roles (e.g., `admin`, `viewer`, `installer`)
7. Navigate to **Personal Access Tokens** tab
8. Click **New** to create a token
9. Set an optional expiration date
10. Click **Create** and **copy the token immediately** (it won't be shown again)

### Using the Token

Include the token as a Bearer token in the `Authorization` header for all API requests:

```bash
Authorization: Bearer <YOUR_PAT>
```

#### Example

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Device.List","params":{},"id":1}'
```

## API Endpoint

All RPC calls are made to a single endpoint:

```bash
POST https://<YOUR_HOST>/rpc
```

The request body must be a JSON-RPC 2.0 object with the following structure:

```json
{
  "jsonrpc": "2.0",
  "method": "<Component.Method>",
  "params": { ... },
  "id": 1
}
```

## 1) Device module

### 1.1 `Device.List`

#### Description

Returns all devices the caller can access. Optional top-level filters (e.g., app, model, presence) are applied BEFORE permission checks; only devices the caller is allowed to see are returned.

#### Params

```json
{
  "filters": { "app": "ProEM" } // optional; values must be string | number | boolean
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.List",
    "params": { "filters": { "app": "ProEM" } },
    "id": 1
  }'
```

#### Response (example)

```json
[
  {
    "shellyID": "shellyproem50-AAAA",
    "id": 101,
    "source": "ws",
    "info": {
      /* device info */
    },
    "status": {
      /* device status */
    },
    "presence": "online",
    "settings": {
      /* device config */
    },
    "entities": ["switch:0", "em:0"],
    "meta": { "lastReportTs": 1696239000000 }
  },
  {
    "shellyID": "shellyem-BBBB",
    "id": 102,
    "source": "offline",
    "info": {
      /* ... */
    },
    "status": {
      /* ... */
    },
    "presence": "pending",
    "settings": {
      /* ... */
    },
    "entities": [],
    "meta": { "lastReportTs": 1696231000000 }
  }
]
```

#### Notes

- Filters match only simple top-level keys; unknown keys are ignored.
- After filtering, per-device access is enforced (devices you cannot access are omitted).

### 1.2 `Device.GetInfo`

#### Description

Returns the info object for a specific device. If the device is not found or no id is provided, an empty object is returned.

#### Params

```json
{ "id": "shellyproem50-abc123" }
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.GetInfo",
    "params": { "id": "shellyproem50-abc123" },
    "id": 1
  }'
```

#### Response (example)

```json
{
  "id": "shellyproem50-abc123",
  "mac": "A1:B2:C3:D4:E5:F6",
  "model": "SHEM-XYZ",
  "gen": 3,
  "fw_id": "20230910-123456/1.0.0@abcdef",
  "ver": "1.0.0",
  "app": "ProEM"
}
```

### 1.3 `Device.GetSetup`

#### Description

Returns provisioning setup profiles from the internal "configs" registry. Two modes:

- `"json"` (default): raw config profiles.
- `"rpc"`: arrays of prebuilt, stringified JSON-RPC requests (e.g., Switch.SetConfig) you can send to a device.

#### Params

```json
{
  "shellyID": "shellyproem50-abc123",
  "mode": "json" // "json" (default) or "rpc"
}
```

#### Request (json mode)

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.GetSetup",
    "params": { "shellyID": "shellyproem50-abc123", "mode": "json" },
    "id": 1
  }'
```

#### Response (json mode example)

```json
{
  "default": {
    "wifi": { "ssid": "MySSID", "pass": "******" },
    "switch": { "id": 0, "initial_state": "on" }
  }
}
```

#### Request (rpc mode)

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.GetSetup",
    "params": { "shellyID": "shellyproem50-abc123", "mode": "rpc" },
    "id": 1
  }'
```

#### Response (rpc mode example)

```json
{
  "default": {
    "wifi": [
      "{\"jsonrpc\":\"2.0\",\"id\":1000,\"method\":\"WiFi.SetConfig\",\"params\":{\"config\":{\"ssid\":\"MySSID\",\"pass\":\"******\"}}}"
    ],
    "switch": [
      "{\"jsonrpc\":\"2.0\",\"id\":1001,\"method\":\"Switch.SetConfig\",\"params\":{\"config\":{\"id\":0,\"initial_state\":\"on\"}}}"
    ]
  }
}
```

#### Notes

- RPC mode increments request ids starting from 1000.
- Returned RPC entries are strings; send them as-is to the device RPC endpoint if your client expects raw JSON strings.

### 1.4 `Device.Call`

#### Description

Send a single JSON-RPC call directly to a specific device. Propagates the device's RPC response (or error).

#### Params

```json
{
  "shellyID": "shellyproem50-abc123",
  "method": "Switch.GetStatus",
  "params": { "id": 0 }
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.Call",
    "params": {
      "shellyID": "shellyproem50-abc123",
      "method": "Switch.GetStatus",
      "params": { "id": 0 }
    },
    "id": 1
  }'
```

#### Response (example)

```json
{ "ison": true, "id": 0 }
```

#### Errors

- `DeviceNotFound` - the device is not connected/known.
- Any structured JSON-RPC error returned by the device will be passed through.

### 1.5 `Device.Get`

#### Description

Return the full serialized device object (metadata + status + config snapshot) for the given ShellyID (or id). Throws if not found.

#### Params (either form)

```json
{ "shellyID": "shellyproem50-abc123" }
```

or

```json
{ "id": "shellyproem50-abc123" }
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.Get",
    "params": { "shellyID": "shellyproem50-abc123" },
    "id": 1
  }'
```

#### Response (example)

```json
{
  "shellyID": "shellyproem50-abc123",
  "id": 101,
  "source": "ws",
  "info": {
    /* device info */
  },
  "status": {
    /* device status */
  },
  "presence": "online",
  "settings": {
    /* device config */
  },
  "entities": ["switch:0", "em:0"],
  "meta": { "lastReportTs": 1696239000000 }
}
```

#### Errors

- `InvalidParams` - when neither a valid "shellyID" nor "id" string is provided.
- `DeviceNotFound` - when the device does not exist/online in the collector.

### 1.6 `Device.Delete`

#### Description

Delete a device from the system. This removes it from the device collector and denies it in the waiting room.

#### Params

```json
{
  "shellyID": "shellyproem50-abc123",
  "id": 101 // optional; if not provided, will be resolved from shellyID
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Device.Delete",
    "params": { "shellyID": "shellyproem50-abc123" },
    "id": 1
  }'
```

#### Response

```json
{ "deleted": "shellyproem50-abc123" }
```

### 1.7 `FleetManager.SendRPC`

#### Description

Send a JSON-RPC command to one or more devices. Returns a per-device result map. If a device is offline/unknown, a JSON-RPC-style error object is returned for that device.

#### Params

```json
{
  "dst": "shellyproem50-abc123", // string or string[] of Shelly IDs
  "method": "Switch.GetStatus", // required
  "params": { "id": 0 }, // optional; defaults to {}
  "silent": false // optional; forwarded to device RPC
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "FleetManager.SendRPC",
    "params": {
      "dst": ["shellyproem50-abc123", "shellyproem50-def456"],
      "method": "Switch.GetStatus",
      "params": { "id": 0 }
    },
    "id": 1
  }'
```

#### Response (example)

```json
{
  "shellyproem50-abc123": {
    /* device response */
  },
  "shellyproem50-def456": {
    "code": -32002,
    "message": "Device offline or not found"
  }
}
```

#### Errors

- `InvalidParams` - when "method" is missing or not a string.
- Per-device errors:
  - `{ "code": -32001, "message": "Permission denied: execute not allowed" }` - user lacks execute permission for device.
  - `{ "code": -32002, "message": "Device offline or not found" }` - target device not connected/unknown.
  - `{ "code": -32603, "message": "<text>" }` - unexpected internal error.
  - Any structured error returned by the device RPC is passed through as-is.

## 2) WaitingRoom module

### 2.1 `WaitingRoom.GetPending`

#### Description

Return devices that are currently waiting for approval. The response is a map keyed by **id** (string) with the stored device JSON (jdoc) as the value.

#### Params

```json
{} // no params required
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "WaitingRoom.GetPending",
    "params": {},
    "id": 1
  }'
```

#### Notes

- Keys are Shelly IDs (e.g., shellyproem50-XXXX).
- Values are the stored jdoc snapshot for each device.

### 2.2 `WaitingRoom.GetDenied`

#### Description

Return devices that were explicitly denied in the past. The response is a map keyed by **id** with stored JSON (jdoc) as the value.

#### Params

```json
{} // no params required
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "WaitingRoom.GetDenied",
    "params": {},
    "id": 1
  }'
```

### 2.3 `WaitingRoom.AcceptPendingById`

#### Description

Approve pending devices by **internal numeric IDs**.

#### Params

```json
{ "ids": [1234, 1235] }
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "WaitingRoom.AcceptPendingById",
    "params": { "ids": [1234, 1235] },
    "id": 1
  }'
```

#### Response

```json
{ "success": [1234, 1235], "error": [] }
```

#### Errors

- If a given ID has not been approved, it will appear in the error array.

### 2.4 `WaitingRoom.AcceptPendingByExternalId`

#### Description

Approve pending devices by **external Shelly IDs** (string IDs).

#### Params

```json
{ "externalIds": ["shellyem-BBBB", "shellyproem50-CCCC"] }
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "WaitingRoom.AcceptPendingByExternalId",
    "params": { "externalIds": ["shellyem-BBBB", "shellyproem50-CCCC"] },
    "id": 1
  }'
```

#### Response

```json
{ "success": ["shellyem-BBBB", "shellyproem50-CCCC"], "error": [] }
```

#### Errors

- If an externalId cannot be resolved or approved, it will appear in the error array.

### 2.5 `WaitingRoom.RejectPending`

#### Description

Reject pending devices by **external IDs** and remove them from the pending queue.

#### Params

```json
{ "shellyIDs": ["shellyem-BBBB"] }
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "WaitingRoom.RejectPending",
    "params": { "shellyIDs": ["shellyem-BBBB"] },
    "id": 1
  }'
```

#### Notes

- Returns success and error arrays with processed ShellyIDs.
- Rejected devices are also removed from the active device collector.

## 3) Group module

### 3.1 `Group.Create`

#### Description

Create a new device group. A group is identified by a unique numeric ID and can optionally include a list of devices at creation time.

#### Params

```json
{
  "name": "Kitchen", // required, group name
  "devices": ["shellyproem50-abc123", "shellyproem50-def456"], // optional
  "parentId": null, // optional, for hierarchical groups
  "metadata": {} // optional, arbitrary metadata
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Create",
    "params": {
      "name": "Kitchen",
      "devices": ["shellyproem50-abc123", "shellyproem50-def456"]
    },
    "id": 1
  }'
```

#### Response

```json
{
  "id": 1,
  "name": "Kitchen",
  "devices": ["shellyproem50-abc123", "shellyproem50-def456"],
  "metadata": {},
  "parentId": null
}
```

### 3.2 `Group.Add`

#### Description

Add a device to an existing group by its ShellyID.

#### Params

```json
{
  "id": 1, // required, ID of the group
  "shellyID": "shellyproem50-ghi789" // required, ShellyID of the device
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Add",
    "params": { "id": 1, "shellyID": "shellyproem50-ghi789" },
    "id": 1
  }'
```

#### Response

```json
{ "added": true }
```

#### Notes

- Returns `{ "added": false }` if the device is already in the group or if the group does not exist.

### 3.3 `Group.Remove`

#### Description

Remove a device from an existing group by its ShellyID.

#### Params

```json
{
  "id": 1, // required, ID of the group
  "shellyID": "shellyproem50-ghi789" // required, ShellyID of the device
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Remove",
    "params": { "id": 1, "shellyID": "shellyproem50-ghi789" },
    "id": 1
  }'
```

#### Response

```json
{ "removed": true }
```

#### Notes

- Returns `{ "removed": false }` if the group does not exist.

### 3.4 `Group.Delete`

#### Description

Delete a group by its numeric ID. This also deletes all child groups (cascade delete).

#### Params

```json
{ "id": 1 } // required, ID of the group
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Delete",
    "params": { "id": 1 },
    "id": 1
  }'
```

#### Response

```json
{ "deleted": true }
```

#### Notes

- Returns `{ "deleted": false }` if the group does not exist.

### 3.5 `Group.List`

#### Description

List all existing groups. Admins will see all groups. Non-admins will only see groups they have explicit permissions for.

#### Params

```json
{
  "parentId": null // optional, filter by parent group (null for root groups)
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.List",
    "params": {},
    "id": 1
  }'
```

#### Response

```json
{
  "1": {
    "id": 1,
    "name": "Kitchen",
    "devices": ["shellyproem50-abc123"],
    "metadata": {},
    "parentId": null
  },
  "2": {
    "id": 2,
    "name": "Office",
    "devices": ["shellyproem50-xyz999"],
    "metadata": {},
    "parentId": null
  }
}
```

#### Notes

- Response is keyed by group IDs.
- Each group includes its ID, name, list of device ShellyIDs, metadata, and parentId.

### 3.6 `Group.Rename`

#### Description

Rename an existing group by its numeric ID.

#### Params

```json
{
  "id": 1, // required, ID of the group
  "newName": "Kitchen Upstairs" // required, new group name
}
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Rename",
    "params": { "id": 1, "newName": "Kitchen Upstairs" },
    "id": 1
  }'
```

#### Response

```json
{ "renamed": true }
```

#### Notes

- Returns `{ "renamed": false }` if the group does not exist.

### 3.7 `Group.Get`

#### Description

Get a single group by its ID.

#### Params

```json
{ "id": 1 } // required, ID of the group
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Get",
    "params": { "id": 1 },
    "id": 1
  }'
```

#### Response

```json
{
  "id": 1,
  "name": "Kitchen",
  "devices": ["shellyproem50-abc123"],
  "metadata": {},
  "parentId": null
}
```

### 3.8 `Group.Find`

#### Description

Find all groups that contain a specific device.

#### Params

```json
{ "shellyID": "shellyproem50-abc123" }
```

#### Request

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "Group.Find",
    "params": { "shellyID": "shellyproem50-abc123" },
    "id": 1
  }'
```

#### Response

```json
[1, 3] // array of group IDs
```

## 4) Subscriptions (WebSocket)

Event subscriptions require a **WebSocket connection**. These methods allow subscribing to real-time events from devices and the Fleet Manager system.

### 4.1 `FleetManager.Subscribe` (minimal)

#### Description

Subscribe to a core set of events. You must subscribe before you can receive any events.

#### Params

```json
{
  "events": ["Shelly.Connect", "Shelly.Disconnect", "Shelly.Status"] // required
}
```

#### Request (via WebSocket)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.Subscribe",
  "params": {
    "events": [
      "Shelly.Connect",
      "Shelly.Disconnect",
      "Shelly.Status",
      "Entity.StatusChange",
      "NotifyStatus",
      "NotifyEvent"
    ]
  }
}
```

#### Response (example)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "ids": [101] }
}
```

#### Notes

- Use the returned subscription IDs with `FleetManager.Unsubscribe` to stop receiving events.

### 4.2 `FleetManager.Subscribe` (filtered with per-event deny list)

#### Description

Subscribe to events but filter them to specific devices and exclude noisy keys per event.

#### Params

```json
{
  "events": ["Shelly.Connect", "Shelly.Status"], // required
  "options": {
    "shellyIDs": ["shellyproem50-AAA111BBB222"], // only these devices
    "events": {
      "Shelly.Status": {
        "deny": [":aenergy", ":consumption", "em:", "wifi:*"] // keys to exclude
      }
    }
  }
}
```

#### Request (via WebSocket)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "FleetManager.Subscribe",
  "params": {
    "events": [
      "Shelly.Connect",
      "Shelly.Message",
      "Shelly.Disconnect",
      "Shelly.Status",
      "Shelly.Settings",
      "Shelly.KVS",
      "Shelly.Info",
      "Shelly.Presence",
      "Entity.Added",
      "Entity.Removed",
      "Entity.Event",
      "NotifyStatus",
      "NotifyEvent"
    ],
    "options": {
      "shellyIDs": ["shellyproem50-AAA111BBB222", "shellypro3em-CCC333DDD444"],
      "events": {
        "Shelly.Status": {
          "deny": [
            ":aenergy",
            ":consumption",
            "em:",
            "em1:",
            "emdata:",
            "emdata1:",
            "wifi:*"
          ]
        }
      }
    }
  }
}
```

#### Response (example)

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": { "ids": [101, 102, 103, 104, 105, 106] }
}
```

#### Notes

- Subscriptions are tied to the current WebSocket session; if the socket closes, the subscription is gone.
- Narrowing event scope reduces traffic.

### 4.3 `FleetManager.Unsubscribe`

#### Description

Cancel one or more active event subscriptions.

#### Params

```json
{
  "ids": [101, 102, 103] // required, subscription IDs returned by FleetManager.Subscribe
}
```

#### Request (via WebSocket)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "FleetManager.Unsubscribe",
  "params": {
    "ids": [101, 102, 103]
  }
}
```

## 5) Events

There are two categories:

- Fleet Manager events
- Shelly device events

### Base type

```typescript
interface Basic {
  jsonrpc: "2.0";
  method: string;
  params: any;
}
```

### FleetManager.Config

Emitted when Fleet Manager configuration changes.

```typescript
interface FleetManagerConfig extends Basic {
  method: "FleetManager.Config";
  params: {
    [k: string]: any;
  };
}
```

### Shelly.Connect

A device connected. Includes a snapshot of device data on connect.

```typescript
interface Connect extends Basic {
  method: "Shelly.Connect";
  params: {
    shellyID: string;
    device: {
      shellyID: string;
      source: string;
      info: any;
      status: any;
      settings: any;
      kvs: Record<string, string>;
    };
  };
}
```

### Shelly.Disconnect

A device disconnected.

```typescript
interface Disconnect extends Basic {
  method: "Shelly.Disconnect";
  params: {
    shellyID: string;
  };
}
```

### Shelly.Info

Device info payload changed (e.g., firmware, model metadata).

```typescript
interface Info extends Basic {
  method: "Shelly.Info";
  params: {
    shellyID: string;
    info: any;
  };
}
```

### Shelly.Status

Device status changed (telemetry, entity states, etc.).

```typescript
interface Status extends Basic {
  method: "Shelly.Status";
  params: {
    shellyID: string;
    status: any;
  };
}
```

### Shelly.Settings

Device settings changed.

```typescript
interface Settings extends Basic {
  method: "Shelly.Settings";
  params: {
    shellyID: string;
    settings: any;
  };
}
```

### Shelly.Message

A raw message from a device. If "req" is undefined, it's a device-originated notification; if present, it's a response to a command sent by Fleet Manager.

```typescript
interface Message extends Basic {
  method: "Shelly.Message";
  params: {
    shellyID: string;
    message: ShellyMessageIncoming;
    req: ShellyMessageData | undefined;
  };
}
```

### Shelly.Presence

Device presence change (e.g., to/from online).

```typescript
interface Presence extends Basic {
  method: "Shelly.Presence";
  params: {
    shellyID: string;
    presence: "online" | "offline" | "pending";
  };
}
```

### Entity.Added

A new entity (component/channel) was added to a device.

```typescript
interface EntityAdded extends Basic {
  method: "Entity.Added";
  params: {
    shellyID: string;
    entity: {
      id: string;
      [k: string]: any;
    };
  };
}
```

### Entity.Removed

An entity was removed from a device.

```typescript
interface EntityRemoved extends Basic {
  method: "Entity.Removed";
  params: {
    shellyID: string;
    entity: {
      id: string;
      [k: string]: any;
    };
  };
}
```

### Entity.StatusChange

An entity's status changed.

```typescript
interface EntityStatusChange extends Basic {
  method: "Entity.StatusChange";
  params: {
    shellyID: string;
    entityId: string;
    status: any;
  };
}
```

### NotifyStatus

Generic status notification (system- or app-level).

```typescript
interface NotifyStatus extends Basic {
  method: "NotifyStatus";
  params: any;
}
```

### NotifyEvent

Generic event notification (system- or app-level).

```typescript
interface NotifyEvent extends Basic {
  method: "NotifyEvent";
  params: any;
}
```

## Practical notes

- Subscriptions are bound to the underlying **WebSocket session**; if the socket closes, the subscription is gone. Re-subscribe after reconnects.
- Narrow your event scope up-front with `options.shellyIDs` and per-event rules (e.g., `deny` keys for `Shelly.Status`) to reduce traffic.
- All HTTP RPC calls use the single endpoint `POST /rpc` with JSON-RPC 2.0 format.
- Method names are case-insensitive.

---

# EM Reports

Reports allow you to generate, download, and manage CSV reports for energy consumption, returned energy, voltage, and current data collected from Shelly devices.

All generated CSV files are available for download at `GET /uploads/reports/<filename>.csv`.

## Data Model: How Shelly Devices Store Metrics

Different Shelly device types store metrics differently. Understanding this is important for interpreting report output.

### Energy Metrics (consumption, returned energy)

All device types that support energy monitoring store energy as cumulative counters:

- `total_act_energy` — total active energy consumed (Wh). Reported by EM devices, plugs, switches with power monitoring.
- `total_act_ret_energy` — total active energy returned to the grid (Wh). Reported by EM devices.

Reports use **SUM** aggregation for energy tags — values within each time bucket are summed to give total energy for that period. The raw Wh values are divided by 1000 and reported as **kWh**.

### Voltage and Current Metrics

Device types report voltage and current differently:

**Plugs and switches** (e.g. Shelly Plug S G3, Shelly 1PM G4, Shelly PM Mini G3) report a single instantaneous reading at each polling interval:

- `voltage` — instantaneous voltage (V)
- `current` — instantaneous current (A)

**EM devices** (e.g. Shelly Pro EM-50) report min/max ranges per measurement interval instead of a single value:

- `min_voltage` / `max_voltage` — lowest and highest voltage readings within the measurement interval
- `min_current` / `max_current` — lowest and highest current readings within the measurement interval

Reports use **AVG** aggregation for all voltage/current tags — values within each time bucket are averaged.

### What This Means for Reports

When a report includes **both** plugs and EM devices:

**Voltage report** produces three columns per row:

| Column | Source | Meaning |
|--------|--------|---------|
| `avg_voltage_v` | `voltage` tag (plugs/switches) | Average of instantaneous voltage readings within the time bucket. **Empty for EM devices.** |
| `min_voltage_v` | `min_voltage` tag (EM devices) | Average of per-interval minimum voltage readings within the time bucket. **Empty for plugs/switches.** |
| `max_voltage_v` | `max_voltage` tag (EM devices) | Average of per-interval maximum voltage readings within the time bucket. **Empty for plugs/switches.** |

**Current report** produces three columns per row:

| Column | Source | Meaning |
|--------|--------|---------|
| `avg_current_a` | `current` tag (plugs/switches) | Average of instantaneous current readings within the time bucket. **Empty for EM devices.** |
| `min_current_a` | `min_current` tag (EM devices) | Average of per-interval minimum current readings within the time bucket. **Empty for plugs/switches.** |
| `max_current_a` | `max_current` tag (EM devices) | Average of per-interval maximum current readings within the time bucket. **Empty for plugs/switches.** |

If a group contains **only plugs**, the `min_*` and `max_*` columns will all be empty. If a group contains **only EM devices**, the `avg_*` column will be empty.

**Consumption and returned energy reports** are not affected by this — all device types store energy the same way, so each row has a single value column.

---

## Report Configs

Report configs define a set of devices to include in a report. They are stored in the database and referenced by ID when generating reports.

### FleetManager.ListReportConfigs

List all saved report configurations.

**Params:** none

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.ListReportConfigs",
  "params": {}
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    {
      "id": 1,
      "report_type": "custom",
      "params": {
        "devices": ["shellyem3-AABBCC", "shellypluspmmini-DDEEFF"]
      }
    }
  ]
}
```

### FleetManager.AddReportConfig

Create a new report configuration.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `report_type` | string | yes | Label for the config (e.g. `"monthly"`, `"custom"`, `"dump"`) |
| `config` | object | yes | Configuration object. Must contain a `devices` array of Shelly IDs. |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.AddReportConfig",
  "params": {
    "report_type": "custom",
    "config": {
      "devices": ["shellyem3-AABBCC", "shellypluspmmini-DDEEFF"]
    }
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "id": 3 }
}
```

### FleetManager.DeleteReportConfig

Delete a report configuration by ID.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | number | yes | The report config ID to delete |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.DeleteReportConfig",
  "params": { "id": 3 }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "deleted": 3 }
}
```

---

## Generating Reports

### FleetManager.GenerateReport

Generate a CSV report for any supported metric type, at any granularity, with optional per-device breakdown. This is the **recommended** method for new integrations — it supersedes `FetchCustomRangeReport` and `FetchMonthlyReport` which only support consumption data at day/month granularity.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `report_config_id` | number | one of `report_config_id` or `group_id` required | ID of the report config (from `AddReportConfig`). Determines which devices to include. |
| `group_id` | number | one of `report_config_id` or `group_id` required | ID of a device group. Alternative to `report_config_id` — uses all devices in the group. |
| `report_type` | string | yes | One of: `consumption`, `returned_energy`, `voltage`, `current` |
| `from` | string | yes | Start date (ISO 8601, e.g. `"2025-01-01"`) |
| `to` | string | yes | End date (ISO 8601, e.g. `"2025-02-01"`) |
| `granularity` | string | yes | One of: `minute`, `hour`, `day`, `month` |
| `per_device` | boolean | yes | `true` = one row per device per time bucket, `false` = aggregate all devices into a single row per bucket |
| `tariff` | number | no | Price per kWh. Only applies to `consumption` and `returned_energy` types. Adds a `cost` column to the CSV. |

**Report types and CSV output:**

#### `consumption`

| CSV column | Description |
|------------|-------------|
| `bucket` | Start of the time bucket |
| `device` | Device name (or "All Devices" if `per_device: false`) |
| `energy_kwh` | Total energy consumed in kWh (SUM of `total_act_energy` / 1000) |
| `cost` | Energy cost (only if `tariff` is provided): `energy_kwh * tariff` |

Energy reports include a **Totals** row at the bottom summing all values.

#### `returned_energy`

| CSV column | Description |
|------------|-------------|
| `bucket` | Start of the time bucket |
| `device` | Device name |
| `returned_energy_kwh` | Total energy returned to grid in kWh (SUM of `total_act_ret_energy` / 1000) |
| `cost` | Value of returned energy (only if `tariff` is provided) |

Energy reports include a **Totals** row at the bottom summing all values. Only EM devices report returned energy — this column will be empty for plugs/switches.

#### `voltage`

| CSV column | Populated by | Description |
|------------|-------------|-------------|
| `bucket` | all | Start of the time bucket |
| `device` | all | Device name |
| `avg_voltage_v` | plugs, switches | Average of instantaneous voltage readings (V) within the time bucket |
| `min_voltage_v` | EM devices | Average of per-interval minimum voltage readings (V) within the time bucket |
| `max_voltage_v` | EM devices | Average of per-interval maximum voltage readings (V) within the time bucket |

Each row represents one device in one time bucket. For a plug, only `avg_voltage_v` is populated. For an EM device, only `min_voltage_v` and `max_voltage_v` are populated. See [Data Model](#data-model-how-shelly-devices-store-metrics) for details.

#### `current`

| CSV column | Populated by | Description |
|------------|-------------|-------------|
| `bucket` | all | Start of the time bucket |
| `device` | all | Device name |
| `avg_current_a` | plugs, switches | Average of instantaneous current readings (A) within the time bucket |
| `min_current_a` | EM devices | Average of per-interval minimum current readings (A) within the time bucket |
| `max_current_a` | EM devices | Average of per-interval maximum current readings (A) within the time bucket |

Same structure as voltage — which columns are populated depends on the device type.

**Example — hourly voltage per device:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GenerateReport",
  "params": {
    "report_config_id": 1,
    "report_type": "voltage",
    "from": "2025-07-01",
    "to": "2025-07-31",
    "granularity": "hour",
    "per_device": true
  }
}
```

**Example — daily consumption with tariff using a device group:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GenerateReport",
  "params": {
    "group_id": 13,
    "report_type": "consumption",
    "from": "2025-01-01",
    "to": "2025-12-31",
    "granularity": "day",
    "per_device": false,
    "tariff": 0.25
  }
}
```

**Example — minute-level current data per device:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GenerateReport",
  "params": {
    "group_id": 13,
    "report_type": "current",
    "from": "2025-07-01",
    "to": "2025-07-02",
    "granularity": "minute",
    "per_device": true
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": "voltage_hour_per_device_1737200000000",
    "file": "uploads/reports/voltage_hour_per_device_1737200000000.csv",
    "name": "voltage_hour_per_device_1737200000000",
    "generated": "2025-07-15T10:30:00.000Z",
    "size": 24680,
    "devices": ["shellyem3-AABBCC"],
    "report_type": "voltage",
    "granularity": "hour",
    "per_device": true,
    "from": "2025-07-01",
    "to": "2025-07-31",
    "rows": 720
  }
}
```

The CSV file can then be downloaded at: `GET /uploads/reports/voltage_hour_per_device_1737200000000.csv`

**Limits:** For very large queries (e.g. minute granularity across many devices for a long period), the server will reject requests that produce more than 2,000,000 rows. Use a coarser granularity or a shorter date range in that case.

---

### FleetManager.FetchCustomRangeReport (Legacy)

> **Migration note:** For new integrations, use `GenerateReport` with `report_type: "consumption"` and `granularity: "day"` instead. This method is kept for backward compatibility.

Generate a daily consumption report for a custom date range. Uses pre-aggregated materialized views (`fn_report_diff`) for fast results.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `report_config_id` | number | yes | Report config ID |
| `from` | string | yes | Start date (ISO 8601) |
| `to` | string | yes | End date (ISO 8601) |
| `tariff` | number | yes | Price per kWh |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.FetchCustomRangeReport",
  "params": {
    "report_config_id": 1,
    "from": "2025-01-01",
    "to": "2025-01-31",
    "tariff": 0.25
  }
}
```

**CSV columns:** `recordDate`, `device`, `totalEnergyKw`, `price`

### FleetManager.FetchMonthlyReport (Legacy)

> **Migration note:** For new integrations, use `GenerateReport` with `report_type: "consumption"` and `granularity: "month"` instead.

Generate a monthly consumption report based on a billing cycle date.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `report_config_id` | number | yes | Report config ID |
| `date` | number | yes | Billing cycle day of month (1-28) |
| `tariff` | number | yes | Price per kWh |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.FetchMonthlyReport",
  "params": {
    "report_config_id": 1,
    "date": 15,
    "tariff": 0.25
  }
}
```

### FleetManager.FetchDBDump

Export raw stats data from the database for a date range. Returns **all** tags and **all** data points without aggregation — useful for custom analysis or debugging.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `report_config_id` | number | yes | Report config ID |
| `from` | string | yes | Start date (ISO 8601) |
| `to` | string | yes | End date (ISO 8601) |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.FetchDBDump",
  "params": {
    "report_config_id": 1,
    "from": "2025-07-01",
    "to": "2025-07-02"
  }
}
```

**CSV columns:** `ts`, `channel`, `val`, `phase`, `device`, `tag` — one row per raw data point.

---

## Report Instances

### FleetManager.ListReports

List all previously generated report instances (metadata only — file paths, timestamps, etc.).

**Params:** none

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.ListReports",
  "params": {}
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    {
      "id": 1,
      "file_path": "uploads/reports/voltage_hour_per_device_1737200000000.csv",
      "report_config_id": 1,
      "created_at": "2025-07-15T10:30:00.000Z"
    }
  ]
}
```

### FleetManager.PurgeReports

Delete **all** generated report CSV files from disk and remove all report instance records from the database.

**Params:** none

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.PurgeReports",
  "params": {}
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "success": true,
    "deletedFiles": 12,
    "deletedDb": true
  }
}
```

---

# Analytics Dashboards

Analytics dashboards provide real-time and historical metrics for a group of devices. You can create dashboards, configure their settings, and query metric data — all via the API.

## Creating and Configuring Dashboards

### FleetManager.CreateAnalyticsDashboard

Create a new analytics dashboard linked to a device group.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name for the dashboard |
| `groupId` | number | yes | ID of the device group to monitor |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.CreateAnalyticsDashboard",
  "params": {
    "name": "Office Energy Monitor",
    "groupId": 13
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "id": 5,
    "name": "Office Energy Monitor",
    "groupId": 13,
    "dashboardType": "analytics"
  }
}
```

### FleetManager.GetDashboardSettings

Get the current settings for an analytics dashboard. Returns defaults if no custom settings have been saved.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dashboardId` | number | yes | Dashboard ID |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GetDashboardSettings",
  "params": { "dashboardId": 5 }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "dashboardId": 5,
    "tariff": 0.25,
    "currency": "EUR",
    "defaultRange": "last_7_days",
    "refreshInterval": 60000,
    "enabledMetrics": ["voltage", "current", "power", "consumption", "temperature", "humidity", "luminance"],
    "chartSettings": {}
  }
}
```

| Field | Description |
|-------|-------------|
| `tariff` | Price per kWh, used for cost calculations in consumption/returned energy reports and charts |
| `currency` | Currency code for display (e.g. `"EUR"`, `"USD"`) |
| `defaultRange` | Default date range for charts (e.g. `"last_7_days"`, `"last_30_days"`) |
| `refreshInterval` | Auto-refresh interval in milliseconds (e.g. `60000` = 1 minute). `0` = no auto-refresh. |
| `enabledMetrics` | Array of metric types to show on the dashboard. Valid values: `uptime`, `voltage`, `current`, `power`, `consumption`, `returned_energy`, `temperature`, `humidity`, `luminance` |
| `chartSettings` | Free-form object for UI chart preferences |

### FleetManager.SetDashboardSettings

Update settings for an analytics dashboard. Only provided fields are updated — omitted fields remain unchanged.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `dashboardId` | number | yes | Dashboard ID |
| `tariff` | number | no | Price per kWh |
| `currency` | string | no | Currency code |
| `defaultRange` | string | no | Default date range |
| `refreshInterval` | number | no | Auto-refresh interval in ms |
| `enabledMetrics` | string[] | no | Which metrics to show |
| `chartSettings` | object | no | Chart UI preferences |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.SetDashboardSettings",
  "params": {
    "dashboardId": 5,
    "tariff": 0.30,
    "enabledMetrics": ["voltage", "consumption", "power"]
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "success": true, "dashboardId": 5 }
}
```

---

## Querying Dashboard Data

These endpoints return data for rendering charts and metric widgets. They accept a group ID and date range, and some accept a granularity parameter.

### FleetManager.GetGroupCapabilities

Discover what metrics are available for a device group, based on the device types it contains.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | number | yes | Device group ID |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GetGroupCapabilities",
  "params": { "groupId": 13 }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "groupId": 13,
    "capabilities": ["uptime", "voltage", "current", "power", "consumption", "returned_energy"],
    "deviceCount": 4
  }
}
```

Use this to determine which charts and metrics to display. For example, if `"temperature"` is not in the capabilities, the group has no temperature sensors.

### FleetManager.GetGroupMetrics

Get current (live) metric values for all devices in a group. Returns the latest readings from each device's status — not historical data.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | number | yes | Device group ID |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GetGroupMetrics",
  "params": { "groupId": 13 }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "groupId": 13,
    "devices": [
      { "id": 9, "shellyID": "shellyproem50-ece334ea0e5c", "name": "Main Panel" },
      { "id": 12, "shellyID": "shellyplugsg3-e4b3233afef4", "name": "plug" }
    ],
    "metrics": {
      "uptime": { "avg": 0, "min": 0, "max": 0, "values": [{ "deviceId": 9, "deviceName": "Main Panel", "value": 158982 }] },
      "voltage": { "avg": 0, "min": 0, "max": 0, "values": [{ "deviceId": 9, "value": 235.2 }] },
      "current": { "avg": 0, "min": 0, "max": 0, "values": [{ "deviceId": 12, "value": 0.094 }] },
      "power": { "total": 0, "values": [{ "deviceId": 9, "value": 9.3 }] },
      "consumption": { "total": 0, "values": [] },
      "returned_energy": { "total": 0, "values": [] },
      "temperature": { "avg": 0, "min": 0, "max": 0, "values": [] },
      "humidity": { "avg": 0, "min": 0, "max": 0, "values": [] },
      "luminance": { "avg": 0, "values": [] }
    }
  }
}
```

### FleetManager.GetConsumptionHistory

Get historical energy consumption data for a group, bucketed by time period.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | number | yes | Device group ID |
| `from` | string | yes | Start date (ISO 8601) |
| `to` | string | yes | End date (ISO 8601) |
| `granularity` | string | no | `"hour"`, `"day"` (default), or `"month"` |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GetConsumptionHistory",
  "params": {
    "groupId": 13,
    "from": "2026-01-01",
    "to": "2026-02-01",
    "granularity": "day"
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "groupId": 13,
    "data": [
      { "bucket": "2026-01-01", "deviceId": 9, "value": 5.234, "shellyId": "shellyproem50-ece334ea0e5c" },
      { "bucket": "2026-01-01", "deviceId": 12, "value": 1.102, "shellyId": "shellyplugsg3-e4b3233afef4" }
    ],
    "total": 6.336,
    "from": "2026-01-01",
    "to": "2026-02-01",
    "granularity": "day"
  }
}
```

### FleetManager.GetMetricHistory

Get historical data for voltage, current, or returned energy. Uses `fn_report_stats` with `time_bucket()` for flexible aggregation. For voltage and current, returns merged min/max/avg values per time bucket (see [Data Model](#data-model-how-shelly-devices-store-metrics)).

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | number | yes | Device group ID |
| `from` | string | yes | Start date (ISO 8601) |
| `to` | string | yes | End date (ISO 8601) |
| `metric` | string | yes | One of: `"voltage"`, `"current"`, `"returned_energy"`, `"consumption"` |
| `granularity` | string | no | `"hour"`, `"day"` (default), or `"month"` |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GetMetricHistory",
  "params": {
    "groupId": 13,
    "from": "2026-02-01",
    "to": "2026-02-18",
    "metric": "voltage",
    "granularity": "day"
  }
}
```

**Response:**

For voltage and current, each data point includes `value` (average), `min`, and `max` where available:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "groupId": 13,
    "data": [
      { "bucket": "2026-02-01T00:00:00.000Z", "deviceId": 9, "shellyId": "shellyproem50-ece334ea0e5c", "value": 234.1, "min": 233.5, "max": 234.7 },
      { "bucket": "2026-02-01T00:00:00.000Z", "deviceId": 12, "shellyId": "shellyplugsg3-e4b3233afef4", "value": 234.8, "min": null, "max": null }
    ],
    "total": 0
  }
}
```

For EM devices, `min` and `max` come from the `min_voltage`/`max_voltage` (or `min_current`/`max_current`) tags, and `value` is computed as `(min + max) / 2`. For plugs/switches, `value` is the average of instantaneous readings and `min`/`max` are `null`.

### FleetManager.GetEnvironmentalHistory

Get historical temperature, humidity, or luminance data.

**Params:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | number | yes | Device group ID |
| `from` | string | yes | Start date (ISO 8601) |
| `to` | string | yes | End date (ISO 8601) |
| `metric` | string | yes | One of: `"temperature"`, `"humidity"`, `"luminance"` |

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "FleetManager.GetEnvironmentalHistory",
  "params": {
    "groupId": 13,
    "from": "2026-02-01",
    "to": "2026-02-18",
    "metric": "temperature"
  }
}
```

Date range is capped at 30 days. Results are capped at 10,000 rows.

---

## 7) Backup module

Device configuration backups — create, store, restore, rename, delete, and download.

**Requirements:**

- Devices must be online and running firmware **≥ 1.8.0** to be eligible for backup creation or restore.
- Restore requires the target device to have the **same model** as the backup source.
- Creating a backup triggers a device reboot. The device must come back online before the backup file can be downloaded.
- Restoring a backup uploads data in small chunks and triggers a device reboot on the final chunk.

### 7.1 `Backup.List`

**Permission:** read-only

Returns all stored backups, sorted by the caller's client.

**Params:** none

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.List","params":{},"id":1}'
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [
    {
      "id": "1708617600000-a1b2c3d4",
      "name": "Living Room Plug-2026-02-22",
      "shellyID": "shellyplugsg3-e4b3233afef4",
      "model": "S3PL-00112EU",
      "app": "PlugS",
      "fwVersion": "1.8.3",
      "createdAt": 1708617600000,
      "fileSize": 4096,
      "contents": {
        "wifi": true,
        "schedules": true,
        "webhooks": true
      },
      "metadata": {}
    }
  ]
}
```

### 7.2 `Backup.Get`

**Permission:** read-only

Get a single backup by ID.

**Params**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Backup ID |

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.Get","params":{"id":"1708617600000-a1b2c3d4"},"id":1}'
```

**Response:** Same structure as a single item from `Backup.List`. Returns `null` if not found.

### 7.3 `Backup.DownloadFromDevice`

**Permission:** execute on the target device

Downloads the backup from a Shelly device and stores it on the Fleet Manager server.

If the device does not already have a backup created (i.e., `Sys.CreateBackup` has not been called), this method will trigger it automatically, wait for the device to reboot (up to 2 minutes), then proceed with the download.

The frontend typically handles `Sys.CreateBackup` + reboot wait itself before calling this method.

**Params**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `shellyID` | string | yes | Target device Shelly ID |
| `name` | string | no | Custom backup name. If omitted, defaults to `{deviceName}-{YYYY-MM-DD}`. If a backup with the same name already exists, it is overwritten. |

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.DownloadFromDevice","params":{"shellyID":"shellyplugsg3-e4b3233afef4"},"id":1}'
```

**Response:** Returns the `BackupMetadata` object for the newly stored backup.

### 7.4 `Backup.RestoreToDevice`

**Permission:** execute on the target device

Restores a stored backup to a target device. The device must be the same model as the original backup source.

The backup file is uploaded in small base64-encoded chunks (1368 base64 chars = 1026 bytes each). Each chunk has a 30-second timeout and up to 3 retries. On the final chunk, the device applies the backup and reboots.

**Progress events:** During the upload, the backend emits `NotifyStatus` websocket events with per-chunk progress:

```json
{
  "method": "NotifyStatus",
  "params": {
    "backup": {
      "restoreProgress": {
        "shellyID": "shellyplugsg3-e4b3233afef4",
        "backupId": "1708617600000-a1b2c3d4",
        "chunk": 5,
        "totalChunks": 27,
        "percent": 19
      }
    }
  }
}
```

**Params**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Backup ID to restore |
| `shellyID` | string | yes | Target device Shelly ID |
| `restore` | object | no | Content filter — keys from `contents` mapped to booleans. If omitted, all contents are restored. Example: `{"wifi": true, "schedules": false}` |

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.RestoreToDevice","params":{"id":"1708617600000-a1b2c3d4","shellyID":"shellyplugsg3-e4b3233afef4","restore":{"wifi":true,"schedules":true}},"id":1}'
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "success": true }
}
```

**Error cases:**

- Backup not found
- Device offline
- Model mismatch between backup and target device
- Device goes offline during upload (retries exhausted)
- Chunk send timeout (30s per chunk, 3 retries)

### 7.5 `Backup.Rename`

**Permission:** write

Rename an existing backup. If another backup already has the new name, the old one is overwritten (deleted).

**Params**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Backup ID |
| `name` | string | yes | New name |

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.Rename","params":{"id":"1708617600000-a1b2c3d4","name":"Office Plug Backup"},"id":1}'
```

**Response:** Returns the updated `BackupMetadata` object.

### 7.6 `Backup.Delete`

**Permission:** write

Delete a backup (both the file and metadata).

**Params**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Backup ID |

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.Delete","params":{"id":"1708617600000-a1b2c3d4"},"id":1}'
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "success": true }
}
```

### 7.7 `Backup.GetFile`

**Permission:** read-only

Returns the raw backup file as base64-encoded data for client-side download.

**Params**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Backup ID |

**Request**

```bash
curl -X POST "https://<YOUR_HOST>/rpc" \
  -H "Authorization: Bearer <YOUR_PAT>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"Backup.GetFile","params":{"id":"1708617600000-a1b2c3d4"},"id":1}'
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "data": "<base64-encoded zip file>",
    "name": "Living Room Plug-2026-02-22.zip",
    "size": 4096
  }
}
```

### BackupMetadata schema

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique backup identifier (timestamp + random suffix) |
| `name` | string | Human-readable name (default: `{deviceName}-{YYYY-MM-DD}`) |
| `shellyID` | string | Source device Shelly ID |
| `model` | string | Device model (e.g., `"S3PL-00112EU"`) |
| `app` | string | Device app name (e.g., `"PlugS"`) |
| `fwVersion` | string | Firmware version at the time of backup |
| `createdAt` | number | Unix timestamp (ms) when backup was created |
| `fileSize` | number | Backup file size in bytes |
| `contents` | object | Map of content categories included in the backup (e.g., `{"wifi": true, "schedules": true}`) |
| `metadata` | object | Additional metadata (reserved for future use) |
