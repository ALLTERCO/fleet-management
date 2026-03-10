import {type AsyncComponentLoader, defineAsyncComponent} from 'vue';

export const DeviceBoard = createDynamicComponent(
    () => import('@/components/boards/DeviceBoard.vue')
);
export const EntityBoard = createDynamicComponent(
    () => import('@/components/boards/EntityBoard.vue')
);
export const ActionBoard = createDynamicComponent(
    () => import('@/components/boards/ActionBoard.vue')
);
export const UserBoard = createDynamicComponent(
    () => import('@/components/boards/UserBoard.vue')
);

export function createDynamicComponent(loader: AsyncComponentLoader) {
    return defineAsyncComponent(loader);
}
