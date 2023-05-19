import { defineStore } from 'pinia';
import { toast_color } from '@/interfaces';
import { ref, Ref } from 'vue';

export interface toast_t {
    visible: boolean,
    message: string,
    color: toast_color
}

export const useToastStore = defineStore('toast', () => {
    const toasts: Ref<toast_t[]> = ref([]);

    function addToast(message: string, color?: toast_color) {
        const toast = {
            message,
            visible: true,
            color: color || "dark"
        }
        toasts.value.unshift(toast);
        setTimeout(() => {
            const index = toasts.value.indexOf(toast);
            if (index > -1) {
                toasts.value.splice(index, 1);
            }
        }, 5000);
        return toast;
    }

    return { toasts, addToast }
})