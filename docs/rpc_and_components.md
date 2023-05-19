# RPCs and Components

## RPCs
Fleet management uses Remote Procedure Calls to send and receive commands as well as to send notifications. The RPCs follow a very similar structure to what the Shelly devices use. The documentation on RPCs can be found in [the shelly website](https://shelly-api-docs.shelly.cloud/gen2/General/RPCProtocol)

## Components
A component is an encapsulated functional unit which exposes methods for communication with the outside world. Each component can have multiple methods assigned to them. An example component is `FleetManager`. It has 5 registered methods. One of them is `listcommands`. This combination between component and method can be called using:
```javascript
{
   "jsonrpc":"2.0",
   "id": 1,
   "src":"demo",
   "method":"FleetManager.ListCommands",
   "params": {}
}
```
and the response looks as follows:
```javascript
{
    "jsonrpc": "2.0",
    "id": 1,
    "src": "FLEET_MANAGER",
    "dst": "demo",
    "result": [
        "fleetmanager",
        "device",
        "mdns",
        "groups",
        "user",
        "plugin:connect-ble-station",
        "plugin:greetings",
        "plugin:monitoring",
        "monitoring"
    ]
}
```
Most components have predefined methods. This methods are universal between all the components and have a similar functionality. However, different components have the option of disabling this predefined methods. A list of the predefined methods are:

#### GetStatus
Return the current status of the component
#### GetConfig
Return the configuration of the component
#### SetConfig
Updates the configuration of the component
#### ListMethods
Returns an array of all the supported methods by the component.


NOTE: Please check the Official Documentation for more info on GetStatus, GetConfig and SetStatus which can be found [here](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Introduction).

Here is a list of all the components and their methods:

### FleetManager

#### FleetManager.Subscribe
Subscribes the client's scoket to Fleet Manager events.

#### FleetManager.GetStatus
Return the momentary status of all registered components into one object.

#### FleetManager.GetConfig
Return the configuration of all registered components into one object.

#### FleetManager.ListRPC
Returns a predefined json object that contains a list of rpc methods and their parameters. Mainly used by the frontend of Fleet Manager.

#### FleetManager.ListPlugins
Returns an object containing all the plugin names and their configurations.

#### FleetManager.ListCommands
Retuns all registered RPC components and their commands.

### Plugins

Each plugin has its own component. The name of the component is the name of the plugin prefixed with `plugin:`. A plugin named `greetings` will be accessible through the component `plugin:greetings`. To enable the greetings plugin simply one can use the `SetConfig` method: 
```javascript
{ "id": 1, "dst": "FLEET_MANAGER", "method": "plugin:monitoring.setconfig", "src": "demo", "params": { "config": { "enable": true } } }
```

Component configuration will persist on reboot. Once enabled the plugin will autostart on the next boot.

### Device

#### Device.List
Return an object of all the connected devices with their info,status, and settings. 

### mDNS

#### Get Discovered Devices
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"mdns.getstatus","src":"demo"}
```

#### Enable mDNS from setConfig
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"mdns.setconfig","src":"demo", "params": {"config": { "enable": true }}}
```

#### Disable mDNS from setConfig
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"mdns.setconfig","src":"demo", "params": {"config": { "enable": false }}}
```

### Groups

#### List Groups
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"groups.list","src":"demo"}
```

#### Create Group
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"groups.create","src":"demo", "params": {"name": "Location", "values": ["Sofia", "Plovdiv", "Burgas"]}}
```

#### Update Group
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"groups.update","src":"demo", "params": {"name": "Location", "values": ["London", "Coventry", "Southampton"]}}
```

#### Delete Group
```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"groups.delete","src":"demo", "params": {"name": "Location"}}
```