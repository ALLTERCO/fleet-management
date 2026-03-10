# Codebase

## Backend

The backend module is the core of the Fleet Management. It is what powers everything else including the frontend, plugins and rpc relay. It is written in Node.js using Typescript. Running the backend requires Node.js 20 and above.  
The backend keeps open websocket connection to all connected Shelly devices. using websockets all the devices can be accessed faster and all devices can also send live notifications to Fleet Manager. The backend stores all the information for all connected devices (incl. statuses, settings and info) and also generates and sends events once the state of any of the devices changes. All events regarding the state change of Shelly devices are described in [Events](./events.md). When a connected Shelly device sends data to the server, the server passes it through its processing line. This includes updating the internal state of the server and notifying all listeners by sending events.

### Consuming backend

Application is based on pub/sub pattern. It uses WebSocket for transfer protocol.

#### Client connects to backend (WebSocket)

Connection should be made with jwt token, details can be seen in browser dev tools

#### Clients subscribes to specific events happened on backend side

Details can be seen in browser dev tools, network tab, ws filter. Here is an example message sent to the backend.
It tells the backend that this client that sent this msg wants to subscribe for the following events:

 `Shelly.Connect, Shelly.Disconnect, Shelly.Status, Shelly.Settings, Shelly.KVS, Shelly.Info, Shelly.Presence, Entity.Added, Entity.Removed, Entity.Event`

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "FleetManager.Subscribe",
    "src": "FLEET_MANAGER_UI",
    "dst": "FLEET_MANAGER",
    "params": {
        "events": [
            "Shelly.Connect",
            "Shelly.Disconnect",
            "Shelly.Status",
            "Shelly.Settings",
            "Shelly.KVS",
            "Shelly.Info",
            "Shelly.Presence",
            "Entity.Added",
            "Entity.Removed",
            "Entity.Event"
        ],
        "options": {
            "events": {
                "Shelly.Status": {
                    "deny": [
                        "*:aenergy",
                        "*:consumption",
                        "em:*",
                        "em1:*",
                        "emdata:*",
                        "emdata1:*",
                        "wifi:*"
                    ]
                }
            }
        }
    }
}
```

#### Example WebSocket messages after connection

After connecting, the client sends several JSON-RPC 2.0 requests to initialise its state:

```text
→ {"jsonrpc":"2.0","id":1,"method":"FleetManager.Subscribe","src":"FLEET_MANAGER_UI","dst":"FLEET_MANAGER","params":{...}}
→ {"jsonrpc":"2.0","id":2,"method":"fleetmanager.getconfig","src":"FLEET_MANAGER_UI","dst":"FLEET_MANAGER"}
→ {"jsonrpc":"2.0","id":3,"method":"Storage.GetItem","src":"FLEET_MANAGER_UI","dst":"FLEET_MANAGER","params":{"registry":...}}
→ {"jsonrpc":"2.0","id":4,"method":"device.list","src":"FLEET_MANAGER_UI","dst":"FLEET_MANAGER"}
→ {"jsonrpc":"2.0","id":5,"method":"entity.list","src":"FLEET_MANAGER_UI","dst":"FLEET_MANAGER"}
```

The backend responds with matching `id` fields:

```text
← {"jsonrpc":"2.0","id":1,"src":"FLEET_MANAGER","dst":"FLEET_MANAGER_UI","result":{"ids":[72,73,74,75,76,77,78,79,80,81]}}
← {"jsonrpc":"2.0","id":2,"src":"FLEET_MANAGER","dst":"FLEET_MANAGER_UI","result":{"storage":{"enable":true},"user":{"allowD...}}}
← {"jsonrpc":"2.0","id":4,"src":"FLEET_MANAGER","dst":"FLEET_MANAGER_UI","result":{"shellyID":"shellypro4pm-94b97ec07094",...}}
```

### Project structure

```bash
backend/
├─ bin/          # Development scripts
├─ cfg/          # General Configuration
├─ dist/         # Executable javascript
├─ logs/         # Log files
├─ model/        # Data models
├─ modules/      # Feature modules
├─ node_modules/ # Project dependencies
├─ plugins/      # Work dir for plugins
├─ rpc/          # RPC method handlers
├─ src/          # Source code
├─ test/         # Tests
├─ types/        # TypeScript type definitions
```

### Plugins

Plugins stored in the `plugins` directory will be loaded on startup.

## Frontend

- found in `frontend` folder
- written in typescript
- Vue 3 with Composition API
- Tailwind CSS for styling
- `pinia` as state manager

The frontend application gives a visual representation of the backend API. Once opened, the frontend application establishes a connection with the backend server using rpc calls over websocket. The frontend queries for all connected devices(using `Device.List`) and subscribed to receive notifications(using `FleetManager.Subscribe`). Once subscribed, it receives live data notifications for state changes for all connected devices.

The application UI is split into the following sections:

- **Devices** -- with sub-tabs: Discovered, Firmware, Backups, Waiting Room
- **Mass RPC (Commands)** -- send RPC commands to one or more devices
- **Settings** -- App, User, Plugins, Configurations, Action Variables, Log, Audit Log
- **Node-RED** -- embedded Node-RED editor
- **Data** -- incoming data from the outbound websockets of the Shelly devices
