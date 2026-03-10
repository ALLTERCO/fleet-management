import {defineStore} from 'pinia';
import {computed, ref} from 'vue';
import default_rpc from '@/data/default_rpc.json';

const ALLOWED_COMPONENT_NAMES = Object.keys(default_rpc);

export const useRpcBuilderStore = defineStore('rpc-builder', () => {
    const component = ref('Shelly');
    const method = ref('GetStatus');
    const showModal = ref(false);

    const componentMethods = computed(
        () => default_rpc[component.value as keyof typeof default_rpc]
    );
    const componentMethodNames = computed(() =>
        Object.keys(default_rpc[component.value as keyof typeof default_rpc])
    );
    const template = computed(
        () =>
            componentMethods.value?.[
                method.value as keyof typeof componentMethods.value
            ]
    );

    function setComponent(comp: string) {
        if (!ALLOWED_COMPONENT_NAMES.includes(comp)) {
            console.warn('trying to set bad component', comp);
            return;
        }
        component.value = comp;
        method.value = componentMethodNames.value[0];
    }

    function setMethod(pass_method: string) {
        if (
            componentMethods.value[
                pass_method as keyof typeof componentMethods.value
            ] == undefined
        ) {
            console.warn('bad method selected', pass_method);
            return;
        }
        method.value = pass_method;
    }

    setComponent('Shelly');

    return {
        template,
        setComponent,
        setMethod,
        componentMethods,
        ALLOWED_COMPONENT_NAMES,
        componentMethodNames,
        showModal
    };
});
