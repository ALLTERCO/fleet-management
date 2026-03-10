## Examples:

#### Connect to Fleet Management

```bash
$ websocat --header="Authorization:Basic YWRtaW46YWRtaW4=" ws://localhost:7011
```

### Use the plugin's registered command and the only method is has

```javascript
{"id":1,"dst":"FLEET_MANAGER","method":"FleetManager.ListCommands","src":"demo"}
{"jsonrpc":"2.0","id":1,"src":"FLEET_MANAGER","dst":"demo","result":["fleetmanager","plugin","device","greetings"]}
{"id":2,"dst":"FLEET_MANAGER","method":"Greetings.ListMethods","src":"demo"}
{"jsonrpc":"2.0","id":2,"src":"FLEET_MANAGER","dst":"demo","result":["listmethods","sayhello"]}
{"id":3,"dst":"FLEET_MANAGER","method":"Greetings.SayHello","src":"demo"}
{"jsonrpc":"2.0","id":3,"src":"FLEET_MANAGER","dst":"demo","result":{"msg":"Hello stranger"}}
{"id":4,"dst":"FLEET_MANAGER","method":"Greetings.SayHello","src":"demo", "params": {"name": "Kalin"}}
{"jsonrpc":"2.0","id":4,"src":"FLEET_MANAGER","dst":"demo","result":{"msg":"Hello Kalin"}}
```