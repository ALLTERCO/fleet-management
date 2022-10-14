import { defineStore } from 'pinia';
import { toast_color } from '@/interfaces';

export interface toast_t {
    visible: boolean,
    message: string,
    color: toast_color
}

export const useToast = defineStore('toast', {
    state: () => {
        return {
            toasts: [] as toast_t[]
        }
    },
    actions: {
        addToast(message: string, color?: toast_color){
            const toast = {
                message,
                visible: true,
                color: color || "dark"
            }
            this.toasts.unshift(toast);
            setTimeout(() => {
                const index = this.toasts.indexOf(toast);
                if(index > -1){
                    this.toasts.splice(index, 1);
                }
            }, 7500);
            return toast;
        },
    }
})