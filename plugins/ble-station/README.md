
#### Connect to Fleet Management

```bash
$ websocat --header="Authorization:Basic YWRtaW46YWRtaW4=" ws://localhost:7011
```

### Use the plugin to send commands to ble station

IN: `{"id": 1, "src": "demo", "dst":"FLEET_MANAGER", "method": "ble.scan"}`

OUT:
```javascript
{
    "jsonrpc": "2.0",
    "id": 1,
    "src": "FLEET_MANAGER",
    "dst": "demo",
    "result": {
        "Shelly B": "0C:43:14:F4:5A:74",
        "ShellyPlusHT-30839809DDC0": "30:83:98:09:DD:C2",
        "ShellyPlusPlugS-3CE90E2FFE98": "3C:E9:0E:2F:FE:9A",
        "ShellyPlusPlugS-3CE90E300244": "3C:E9:0E:30:02:46",
        "ShellyPlus2PM-441793ACDE74": "44:17:93:AC:DE:76",
        "ShellyDev1-441793B50E50": "44:17:93:B5:0E:52",
        "ShellyPlusHT-7C87CE6CB64C": "7C:87:CE:6C:B6:4E",
        "ShellyPlus1PM-A8032ABB9960": "A8:03:2A:BB:99:62",
        "ShellyPlusPlugS-B48A0A1BC66C": "B4:8A:0A:1B:C6:6E",
        "ShellyPlusHT-C049EF872A0C": "C0:49:EF:87:2A:0E"
    }
}

```
IN: `{"id": 2, "src": "demo", "dst":"FLEET_MANAGER", "method": "ble.forward", "params": {"shellyID": "ShellyPlusPlugS-B48A0A1BC66C", "method": "ws.getconfig" }}`



OUT:
```javascript
{
    "jsonrpc": "2.0",
    "id": 2,
    "src": "FLEET_MANAGER",
    "dst": "demo",
    "result": {
        "id": 0,
        "src": "shellyplusplugs-b48a0a1bc66c",
        "dst": "fleet-manager-ble",
        "result": {
            "enable": true,
            "server": "ws://192.168.51.101:7011/shelly",
            "ssl_ca": "ca.pem"
        }
    }
}

```