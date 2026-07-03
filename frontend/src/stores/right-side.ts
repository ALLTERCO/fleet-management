import {defineStore} from 'pinia';
import {type Component, computed, ref, shallowRef} from 'vue';

export const useRightSideMenuStore = defineStore('right-side-menu', () => {
    const inspectorComponent = shallowRef<Component>();
    const inspectorProps = ref<Record<string, unknown>>({});
    const inspectorDrawerVisible = ref(false);
    const hasSelection = computed(() => !!inspectorComponent.value);
    const isInspectorDrawerOpen = computed(
        () => inspectorDrawerVisible.value && hasSelection.value
    );

    async function showInspector(
        nextComponent: Component,
        nextProps: Record<string, unknown> = {}
    ) {
        inspectorComponent.value = nextComponent;
        inspectorProps.value = nextProps;
        inspectorDrawerVisible.value = true;
    }

    function closeInspectorDrawer() {
        inspectorDrawerVisible.value = false;
    }

    function clearInspector() {
        inspectorComponent.value = undefined;
        inspectorProps.value = {};
        inspectorDrawerVisible.value = false;
    }

    return {
        inspectorComponent,
        inspectorProps,
        showInspector,
        closeInspectorDrawer,
        clearInspector,
        inspectorDrawerVisible,
        hasSelection,
        isInspectorDrawerOpen
    };
});
