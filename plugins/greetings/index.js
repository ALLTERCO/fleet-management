"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unload = exports.load = void 0;
// END: TYPES
function load() {
    console.log("[Greetings] Plugin loaded");
    call("fleetmanager.getconfig").then((res) => {
        console.log("fleetmanager config is", res);
    });
}
exports.load = load;
function unload() {
    console.log("[Greetings] Plugin unloaded");
}
exports.unload = unload;
defineComponent({
    name: 'greetings',
    methods: new Map([
        ['sayhello', (params, sender) => Promise.resolve({ msg: "Hello " + (params?.name || 'stranger') })]
    ])
});
