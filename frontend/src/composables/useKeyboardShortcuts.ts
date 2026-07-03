/** Central reusable keyboard-shortcut composable.
 *
 *  Components declare bindings; this composable handles attach/detach and
 *  the editable-target guard so individual handlers stay focused on the
 *  business action. Pure matching lives in helpers/keyboardShortcuts.ts. */

import {onBeforeUnmount, onMounted, type Ref, watch} from 'vue';
import {
    isTypingInEditableElement,
    matchesBinding,
    type ShortcutBinding
} from '@/helpers/keyboardShortcuts';

export type ShortcutTarget = 'window' | Ref<HTMLElement | null>;

export interface UseKeyboardShortcutsInput {
    readonly target?: ShortcutTarget;
    readonly bindings: readonly ShortcutBinding[];
}

/** Wire a set of keyboard bindings to a target (window by default).
 *  The listener auto-detaches on component unmount. Components stay
 *  thin event-routers; the state transitions live in the bindings'
 *  handlers and the pure helpers they call. */
export function useKeyboardShortcuts(input: UseKeyboardShortcutsInput): void {
    const target: ShortcutTarget = input.target ?? 'window';
    const dispatch = createDispatcher(input.bindings);
    let detach: (() => void) | null = null;

    onMounted(() => {
        detach = attachListener(target, dispatch);
    });

    onBeforeUnmount(() => {
        detach?.();
        detach = null;
    });

    // If the target is a reactive ref (e.g. tree root mounted later), rebind.
    if (typeof target !== 'string') {
        watch(target, (next, prev) => {
            if (next === prev) return;
            detach?.();
            detach = attachListener(target, dispatch);
        });
    }
}

function createDispatcher(
    bindings: readonly ShortcutBinding[]
): (event: KeyboardEvent) => void {
    return (event) => {
        const binding = firstMatch(event, bindings);
        if (!binding) return;
        if (
            isTypingInEditableElement(event.target) &&
            !binding.allowInEditable
        ) {
            return;
        }
        if (binding.preventDefault !== false) event.preventDefault();
        binding.handler(event);
    };
}

function firstMatch(
    event: KeyboardEvent,
    bindings: readonly ShortcutBinding[]
): ShortcutBinding | null {
    for (const binding of bindings) {
        if (matchesBinding(event, binding)) return binding;
    }
    return null;
}

function attachListener(
    target: ShortcutTarget,
    dispatch: (event: KeyboardEvent) => void
): () => void {
    const element = resolveElement(target);
    if (!element) return () => undefined;
    element.addEventListener('keydown', dispatch as EventListener);
    return () =>
        element.removeEventListener('keydown', dispatch as EventListener);
}

function resolveElement(target: ShortcutTarget): EventTarget | null {
    if (target === 'window') return window;
    return target.value;
}
