// Cross-panel refresh nudge for BLU Assistant panels. Scan panel calls
// bump() after a successful Connect; Connections panel watches token and
// triggers a fresh Connection.List fetch.

import {type Ref, ref} from 'vue';

const tokens = new Map<string, Ref<number>>();

export function useBluAssistRefresh(shellyID: string): {
    token: Ref<number>;
    bump: () => void;
} {
    let token = tokens.get(shellyID);
    if (!token) {
        token = ref(0);
        tokens.set(shellyID, token);
    }
    const t = token;
    return {token: t, bump: () => t.value++};
}
