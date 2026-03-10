import {defineStore} from 'pinia';
import {type DefineComponent, ref, shallowRef} from 'vue';

export const useRightSideMenuStore = defineStore('right-side-menu', () => {
    const component = shallowRef<DefineComponent>();
    const props = ref<any>({});
    const mobileVisible = ref(false);
    const detached = ref(false);

    async function setActiveComponent(
        pass_comp: DefineComponent,
        pass_props: Record<string, any> = {}
    ) {
        component.value = pass_comp;
        props.value = pass_props;
        mobileVisible.value = true;
    }

    function clearActiveComponent() {
        component.value = undefined;
        props.value = undefined;
        mobileVisible.value = false;
        detached.value = false;
    }

    return {
        component,
        props,
        setActiveComponent,
        clearActiveComponent,
        mobileVisible,
        detached
    };
});
