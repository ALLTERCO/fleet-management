# Fleet Management

Fleet Manager is a standalone software service for controlling and monitoring a fleet of second generation Shelly devices. Fleet Manager exposes a websocket server endpoint on which Shelly Plus and Pro series devices can connect to using their outbound websockets. Once connected they can be fully managed by Fleet Manager. Fleet Manager also exposes a websocket endpoint for clients to connect to. Messages send to Fleet Manager must follow the [JSON-RPC 2.0 protocol](https://www.jsonrpc.org/specification). Communication protocols for Fleet Management are described in [RPC and Components](./docs/rpc_and_components.md)

# Useful resources
1. [RPC and Components](./docs/rpc_and_components.md)
2. [Events](./docs/events.md)
3. [RPC Relay](./docs/rpc_relay.md)
4. [Plugins](./docs/plugins.md)
5. [Codebase](./docs/codebase.md)
6. [Developing](./docs/developing.md)
## Connecting a Shelly device

To connect a second generation Shelly device do the following:
1. Open the Shelly device's local webpage
2. Navigate to Networks -> Outbound websocket
3. Click the toggle button that enables the outbound websocket and enter the address of the fleet management server followed by `/shelly` (hint: `ws://<your ip>:7011/shelly`). 

After that the device should show up in the home page of the application.


## Codebase
The codebase is split into modules - backend and frontend. They are described in the [Codebase](./docs/codebase.md) section.
## Start the program

### Using docker:
```bash
docker compose up --build -d 
```

### Other ways
Other ways of starting the program are described in [Developing](./docs/developing.md).

## Contributing

Contributing can be done with pull requests in Github.
