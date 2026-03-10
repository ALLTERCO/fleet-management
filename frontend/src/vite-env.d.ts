/// <reference types="vite/client" />

declare module '*.vue' {
    import type {DefineComponent} from 'vue';
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

declare module 'vue3-json-editor/dist/vue3-json-editor.esm' {
    import type {DefineComponent} from 'vue';
    export const Vue3JsonEditor: DefineComponent<{
        modelValue?: object;
        mode?: string;
        modes?: string[];
        onChange?: (value: object) => void;
    }>;
}
