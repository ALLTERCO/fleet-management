import {defineStore} from 'pinia';
import {type Ref, ref} from 'vue';
import type {notification_type_t} from '@/types';

export interface toast_t {
    visible: boolean;
    message: string;
    type: notification_type_t;
}

export const useToastStore = defineStore('toast', () => {
    const toasts: Ref<toast_t[]> = ref([]);

    function addToast(message: string, type?: notification_type_t) {
        const toast: toast_t = {
            message,
            visible: true,
            type: type || 'info'
        };
        toasts.value.unshift(toast);
        if (toasts.value.length > 5) {
            toasts.value.pop();
        }
        setTimeout(() => {
            const index = toasts.value.indexOf(toast);
            if (index > -1) {
                toasts.value.splice(index, 1);
            }
        }, 5000);
        return toast;
    }

    function error(message: any) {
        if (typeof message !== 'string') {
            return addToast(String(message), 'error');
        }
        return addToast(message, 'error');
    }

    function success(message: string) {
        return addToast(message, 'success');
    }

    function warning(message: string) {
        return addToast(message, 'warning');
    }

    function info(message: string) {
        return addToast(message, 'info');
    }

    return {toasts, addToast, error, success, warning, info};
});
