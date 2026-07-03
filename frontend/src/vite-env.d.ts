/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Third-party lib without bundled types (used by DeviceTopology).
declare module 'cytoscape-cose-bilkent';

declare module '*.vue' {
    import type {DefineComponent} from 'vue';

    const component: DefineComponent<
        Record<string, never>,
        Record<string, never>,
        any
    >;
    export default component;
}
