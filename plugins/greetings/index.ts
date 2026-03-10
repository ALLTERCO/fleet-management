// BEGIN: TYPES
interface component_t {
    name: string,
    methods: Map<string, (params: any, sender: any) => Promise<any>>
}

type define_component_t = (component: component_t) => void;
type call_t = (method: string, params?: any) => Promise<any>;

// END: TYPES

export function load({call, defineComponent}: {call: call_t, defineComponent: define_component_t}) {
    console.log("[Greetings] Plugin loaded");

    call("fleetmanager.getconfig").then((res) => {
        console.log("fleetmanager config is", res)
    });
    defineComponent({
        name: 'greetings',
        methods: new Map([
            ['sayhello', (params, sender) => Promise.resolve({ greeting: "Hello " + (params?.name || 'stranger') })]
        ])
    });
}

export function unload() {
    console.log("[Greetings] Plugin unloaded")
}


