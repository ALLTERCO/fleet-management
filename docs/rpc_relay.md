# RPC Relay
Fleet manager can also be used a RPC relay. If Fleet Manager sees that the `dst` key of the incoming JSON-RPC request is a shelly device, Fleet Manager will forward the message to the shelly device. When the shelly device responds, the response will be forwarded to the sender. Below are some examples of use cases:

## Correct use cases
### Single Request, Single Device

IN: 
```javascript
{"id":1,"dst":"3ce90e30583c","method":"ws.getconfig","src":"kalin"}
```  
OUT: 
```javascript
{"id":1,"src":"shellyplusplugs-3ce90e30583c","dst":"kalin","result":{"enable":true,"server":"ws://192.168.207.6:7011/shelly","ssl_ca":"ca.pem"}}
```

### One Request, Multiple Devices
IN: 
```javascript
{"id":1,"dst":["3ce90e30583c", "a8032abb995c"],"method":"ws.getconfig","src": "kalin"}
```  
OUT: 
```javascript
{"id":1,"src":"shellyplus1pm-a8032abb995c","dst":"kalin","result":{"enable":true,"server":"ws://192.168.207.6:7011/shelly","ssl_ca":"ca.pem"}}
{"id":1,"src":"shellyplusplugs-3ce90e30583c","dst":"kalin","result":{"enable":true,"server":"ws://192.168.207.6:7011/shelly","ssl_ca":"ca.pem"}}
```

### Multiple Requests, Multiple Devices
IN: 
```javascript
[{"id":1,"dst":"3ce90e30583c","method":"ws.getconfig","src":"kalin"},{"id":2,"dst":"a8032abb995c","method":"ws.getconfig","src":"kalin"}]
```  
OUT:
```javascript
{"id":2,"src":"shellyplus1pm-a8032abb995c","dst":"kalin","result":{"enable":true,"server":"ws://192.168.207.6:7011/shelly","ssl_ca":"ca.pem"}}
{"id":1,"src":"shellyplusplugs-3ce90e30583c","dst":"kalin","result":{"enable":true,"server":"ws://192.168.207.6:7011/shelly","ssl_ca":"ca.pem"}}

```

## Incorrect use cases

### Bad format
IN: 
```
"test
```
OUT: 
```javascript
{"jsonrpc":"2.0","id":null,"src":"FLEET_MANAGER","error":{"code":-32700,"message":"Parse error"}}
```

### Missing properties
IN: 
```javascript
{"id":1,"src":"kalin","method":"config.get"}
```
OUT: 
```javascript
{"jsonrpc":"2.0","id":null,"src":"FLEET_MANAGER","error":{"code":-32600,"message":"Invalid request"}}
```


### Invalid device
IN: 
```javascript
{"id":1,"dst":"3ce90e30583c","method":"ws.getconfig","src":"kalin"}
```

OUT: 
```javascript
{"jsonrpc":"2.0","id":1,"src":"FLEET_MANAGER","error":{"code":-32600,"message":"No such device"}}
```

## Connect to RPC Relay using websocat with basic auth
Example for username `admin` and password `admin`:  
```bash
websocat --header="Authorization:Basic YWRtaW46YWRtaW4=" ws://localhost:7011
```