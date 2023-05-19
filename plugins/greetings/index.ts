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

    call("fleetmanager.getconfig").then((res) => {
        console.log("fleetmanager config is", res)
    })
}

export function unload() {
    console.log("[Greetings] Plugin unloaded")
}

defineComponent({
    name: 'greetings',
    methods: new Map([
        ['sayhello', (params, sender) => Promise.resolve({ greeting: "Hello " + (params?.name || 'stranger') })]
    ])
})

