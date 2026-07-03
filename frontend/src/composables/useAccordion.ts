// Accordion section state + keyboard handler shared across
// EntityTemplate_* files. Headers must bind:
//   role="button" tabindex="0"
//   :aria-expanded="!collapsed.has(id)"
//   @click="toggle(id)" @keydown="onKey($event, id)"

import {reactive} from 'vue';

export function useAccordion(initiallyCollapsed: readonly string[] = []) {
    const collapsed = reactive(new Set<string>(initiallyCollapsed));

    function toggle(id: string): void {
        if (collapsed.has(id)) collapsed.delete(id);
        else collapsed.add(id);
    }

    function onKey(event: KeyboardEvent, id: string): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle(id);
        }
    }

    return {collapsed, toggle, onKey};
}
