# Events
Fleet Manager sends events in the form of notifications using the [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification). There are two groups of events:
1. Related to Fleet Management
2. Related to the connected Shelly devices

## Fleet Manager Events

### FleetManager.Config
`FleetManager.Config` event is send once a change in the Fleet Management config has been made.

## Shelly Events

### Shelly.Connect
Type definition:
```javascript
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
            groups: Record<string, string>
        }
    }
}

```

### Shelly.Disconnect
Type definition:
```javascript
interface Disonnect extends Basic {
    method: "Shelly.Disconnect"
    params: { 
        shellyID: string
    }
}
```

### Shelly.Info
Type definition:
```javascript
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
```javascript
interface Status extends Basic {
    method: "Shelly.Status"
    params: {
        shellyID: string
        status: any
    }
}
```

### Shelly.Settings
Type definition:
```javascript
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
```javascript
interface Message extends Basic {
    method: "Shelly.Message"
    params: {
        shellyID: string
        message: ShellyMessageIncoming,
        req: ShellyMessageData | undefined
    }
}
```
`req` is the JSON-RPC request that was send to the device. If the `req` object is `undefined` this means the Shelly device is sending a notification. If `req` is present, the Shelly device is responding to a command that was been send over Fleet Manager.
### Shelly.Group
Type definition:
```javascript
interface Group extends Basic {
    method: "Shelly.Group"
    params: {
        shellyID: string,
        groups: Record<string, string>
    }
}
```
