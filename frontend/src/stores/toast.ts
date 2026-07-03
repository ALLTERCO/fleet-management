import {defineStore} from 'pinia';
import {type Ref, ref} from 'vue';
import {UI_CONFIG} from '@/config/ui';
import type {notification_type_t} from '@/types';

export interface toast_t {
    id: number;
    visible: boolean;
    message: string;
    type: notification_type_t;
    action?: () => void;
    actionLabel?: string;
    persistent?: boolean;
    onDismiss?: () => void;
}

export interface ToastOptions {
    type?: notification_type_t;
    message: string;
    action?: () => void;
    actionLabel?: string;
    timeout?: number;
    // Skips auto-dismiss — user must click the action or X to close.
    persistent?: boolean;
    // Fires once when the toast leaves the stack (X, action, eviction, timeout).
    onDismiss?: () => void;
}

let nextToastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = defineStore('toast', () => {
    const toasts: Ref<toast_t[]> = ref([]);

    function removeToast(toast: toast_t) {
        const timer = toastTimers.get(toast.id);
        if (timer) clearTimeout(timer);
        toastTimers.delete(toast.id);
        const index = toasts.value.indexOf(toast);
        if (index < 0) return;
        toasts.value.splice(index, 1);
        toast.onDismiss?.();
    }

    function scheduleDismiss(toast: toast_t, ms: number) {
        const prev = toastTimers.get(toast.id);
        if (prev) clearTimeout(prev);
        toastTimers.set(
            toast.id,
            setTimeout(() => removeToast(toast), ms)
        );
    }

    function evictOverflow() {
        // Persistent toasts (e.g. deploy prompt) survive eviction.
        while (toasts.value.length > UI_CONFIG.toast.maxStack) {
            const victim = lastNonPersistent();
            if (!victim) return;
            removeToast(victim);
        }
    }

    function lastNonPersistent(): toast_t | null {
        for (let i = toasts.value.length - 1; i >= 0; i--) {
            if (!toasts.value[i].persistent) return toasts.value[i];
        }
        return null;
    }

    // Single entry point — every toast goes through here.
    function addToast(opts: ToastOptions): toast_t {
        const hasAction = typeof opts.action === 'function';
        const toast: toast_t = {
            id: nextToastId++,
            message: opts.message,
            visible: true,
            type: opts.type ?? 'info',
            action: opts.action,
            actionLabel: hasAction ? (opts.actionLabel ?? 'Undo') : undefined,
            persistent: opts.persistent,
            onDismiss: opts.onDismiss
        };
        toasts.value.unshift(toast);
        evictOverflow();
        if (!opts.persistent) {
            const ms =
                opts.timeout ??
                (hasAction
                    ? UI_CONFIG.toast.actionMs
                    : UI_CONFIG.toast.defaultMs);
            scheduleDismiss(toast, ms);
        }
        return toast;
    }

    const error = (message: unknown) =>
        addToast({type: 'error', message: String(message)});
    const success = (message: string) => addToast({type: 'success', message});
    const warning = (message: string) => addToast({type: 'warning', message});
    const info = (message: string) => addToast({type: 'info', message});

    // Runs action now; Undo button in the toast reverts it.
    function undoable(
        message: string,
        action: () => void,
        undoAction: () => void,
        timeout?: number
    ) {
        action();
        return addToast({
            type: 'success',
            message,
            action: undoAction,
            actionLabel: 'Undo',
            timeout
        });
    }

    return {
        toasts,
        addToast,
        removeToast,
        error,
        success,
        warning,
        info,
        undoable
    };
});
