# RPC Relay

Fleet manager can also be used a RPC relay. If Fleet Manager sees that the `dst` key of the incoming JSON-RPC request is a shelly device, Fleet Manager will forward the message to the shelly device. When the shelly device responds, the response will be forwarded to the sender. Below are some examples of use cases:

## Correct use cases

### Single Request, Single Device

IN:

```json
{"id":1,"dst":"shelly-device-id","method":"ws.getconfig","src":"client"}
```  

OUT:

```json
{"id":1,"src":"shellyplusplugs-example","dst":"client","result":{"enable":true,"server":"ws://<fleet-host>:7011/shelly","ssl_ca":"ca.pem"}}
```

### One Request, Multiple Devices

IN:

```json
{"id":1,"dst":["shelly-device-a", "shelly-device-b"],"method":"ws.getconfig","src": "client"}
```  

OUT:

```json
{"id":1,"src":"shellyplus1pm-example","dst":"client","result":{"enable":true,"server":"ws://<fleet-host>:7011/shelly","ssl_ca":"ca.pem"}}
{"id":1,"src":"shellyplusplugs-example","dst":"client","result":{"enable":true,"server":"ws://<fleet-host>:7011/shelly","ssl_ca":"ca.pem"}}
```

### Multiple Requests, Multiple Devices

IN:

```json
[{"id":1,"dst":"shelly-device-a","method":"ws.getconfig","src":"client"},{"id":2,"dst":"shelly-device-b","method":"ws.getconfig","src":"client"}]
```  

OUT:

```json
{"id":2,"src":"shellyplus1pm-example","dst":"client","result":{"enable":true,"server":"ws://<fleet-host>:7011/shelly","ssl_ca":"ca.pem"}}
{"id":1,"src":"shellyplusplugs-example","dst":"client","result":{"enable":true,"server":"ws://<fleet-host>:7011/shelly","ssl_ca":"ca.pem"}}

```

## Incorrect use cases

### Bad format

IN:

```text
"test
```

OUT:

```json
{"jsonrpc":"2.0","id":null,"src":"FLEET_MANAGER","error":{"code":-32700,"message":"Parse error"}}
```

### Missing properties

IN:

```json
{"id":1,"src":"client","method":"config.get"}
```

OUT:

```json
{"jsonrpc":"2.0","id":null,"src":"FLEET_MANAGER","error":{"code":-32600,"message":"Invalid request"}}
```

### Invalid device

IN:

```json
{"id":1,"dst":"shelly-device-id","method":"ws.getconfig","src":"client"}
```

OUT:

```json
{"jsonrpc":"2.0","id":1,"src":"FLEET_MANAGER","error":{"code":-32600,"message":"No such device"}}
```

## Connect to RPC Relay using websocat

Example using a JWT Bearer token:

```bash
websocat --header="Authorization:Bearer <YOUR_TOKEN>" ws://localhost:7011
```
