# Plugins
Fleet Manager has support for plugins written in javascript. Plugins are executed in a worker thread attached to the main process. Plugins can register components that are accessible from everywhere in Fleet Management and can also make calls to other registered components.

## Plugin structure
Each plugin should be placed in separate folder in `backend/plugins` and have a valid `package.json` file that has `name`, `version`, `description`, and `main`. If any of these properties are missing, the plugin will not be loaded. The plugin should also have a `.js` file as an entrypoint, as described in the `main` property of `package.json`. An example plugins folder structure looks like:
```
plugins/
├─ greetings/
│  ├─ package.json
│  ├─ index.js
│  ├─ index.ts
├─ another-plugin/
│  ├─ package.json
│  ├─ index.js
├─ .gitkeep
```
an example `package.json` looks like this:
```javascript
{
  "name": "@fleet-management/greetings",
  "version": "1.0.0",
  "description": "demo plugin, says hello",
  "main": "index.js",
  "keywords": [],
  "author": "Allterco Robotics",
  "license": "ISC"
}
```

## Plugin entrypoint

The plugin entrypoint is a javascript file. If the javascript file exports functions named `load`, `unload` and `on` they will be called by fleet management. `load` and `unload` are lifecycle functions. They will be called once the plugin is loaded or unloaded. `on` function will be called once an event has fired. An example event is `Shelly.Connect`. This event is fired once a shelly connects. An example `on` function that prints the name of the shelly that has connected is:
``` javascript
function on(rpcEvent, eventData) {
    const { method, params } = rpcEvent;
    const { shellyID } = params;

    const { shelly } = eventData;
    const { name } = shelly.info;

    if (method === 'Shelly.Connect') {
        console.log(`A new shelly has connected shellyID=[%s] name=[%s]`, shellyID, name)
    }
}
``` 
Example load and unload functions look like this:
```javascript
function load(properties) {
    console.log("Plugin loaded");
}
```
``` javascript
function unload() {
    console.log("Plugin unloaded")
}
```
All of the three functions must be exported in order to be visible to fleet management. This can be done using:
``` javascript
module.exports = { load, unload, on }
```

A plugin also can register components and make calls to other registered components. This can done in two ways. The first way is to use the globally defined functions `call` and `defineComponent`. The `call` functions takes 2 parameters - the first one is the method and the second one is the params. The type definition of the `call` function is:
```javascript
declare function call(method: string, params?: any): Promise<any>
```
and a sample use case is:
```javascript
call("fleetmanager.getconfig").then((res) => {
    console.log("fleetmanager config is", res)
});
```
The `defineComponent` function also takes two arguments. The first is the name of the component and the second is a map of the methods. The type definition is:
```javascript
declare function defineComponent(component: define_component_t): void;
```
and a sample use case is:
```javascript
defineComponent({
    name: 'greetings',
    methods: new Map([
        ['sayhello', (params, sender) => 
            Promise.resolve({ msg: "Hello " + (params?.name || 'stranger') })]
    ])
});
```
The seconds way to use `call` and `defineComponent` is from the arguments of the load function.
```javascript
function load(properties) {
    call = properties.call;
    defineComponent = properties.defineComponent;
}
```
## Typescript support

### Type definitions for plugins
```javascript
interface define_component_t {
    name: string,
    methods: Map<string, (params: any, sender: any) => Promise<any>>
}

declare function call(method: string, params?: any): Promise<any>
declare function defineComponent(component: define_component_t): void;
```

### Compile and watch plugins
There are two shell scripts for compiling and watching typescript plugins
```bash
cd backend
./compile_plugin.sh greetings
./watch_plugin.sh greetings
```

## Greetings plugin
This is a sample plugin that registers a component which responds to the rpc call `greetings.sayhello` and greets the sender appropriately. The entrypoint is:
```javascript
// BEGIN: TYPES
interface define_component_t {
    name: string,
    methods: Map<string, (params: any, sender: any) => Promise<any>>
}

declare function call(method: string, params?: any): Promise<any>
declare function defineComponent(component: define_component_t): void;
// END: TYPES

export function load() {
    console.log("[Greetings] Plugin loaded");

    defineComponent({
        name: 'greetings',
        methods: new Map([
            ['sayhello', (params, sender) => Promise.resolve({ msg: "Hello " + (params?.name || 'stranger') })]
        ])
    });
}

export function unload() {
    console.log("[Greetings] Plugin unloaded")
}
```
and the folder structure is:
```
├─ greetings/
│  ├─ package.json
│  ├─ index.js
│  ├─ index.ts
```

## Managing plugins
Plugins can be managed by making rpc calls to the Plugin component. This component supports `Plugin.Enable`, `Plugin.Disable`, `Plugin.Autostart`.