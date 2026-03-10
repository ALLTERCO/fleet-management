import {
    breakpointsTailwind,
    useBreakpoints,
    useLocalStorage
} from '@vueuse/core';
import {reactive} from 'vue';
import {FLEET_MANAGER_WEBSOCKET} from '@/constants';

export const breakpoints = useBreakpoints(breakpointsTailwind);

export const small = breakpoints.smaller('md');

export const defaultWs = useLocalStorage(
    'propose-ws',
    FLEET_MANAGER_WEBSOCKET + '/shelly'
);

export const modals = reactive({
    addWidget: false
});
