import {onUnmounted, type Ref, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';

/**
 * Syncs named state values to URL query params + localStorage.
 * Priority on load: URL query > localStorage > defaults.
 * Changes debounced 300ms to avoid excessive history entries.
 */
export function useUrlState(
    storageKey: string,
    defaults: Record<string, string>
): Record<string, Ref<string>> {
    const route = useRoute();
    const router = useRouter();

    let saved: Record<string, string> = {};
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (
                typeof parsed === 'object' &&
                parsed !== null &&
                !Array.isArray(parsed)
            ) {
                saved = Object.fromEntries(
                    Object.entries(parsed).filter(
                        ([, value]) => typeof value === 'string'
                    )
                ) as Record<string, string>;
            }
        }
    } catch {
        /* ignore corrupt data */
    }

    const refs: Record<string, Ref<string>> = {};
    for (const [key, defaultVal] of Object.entries(defaults)) {
        const urlVal = route.query[key];
        const savedVal = saved[key];
        refs[key] = ref(
            typeof urlVal === 'string'
                ? urlVal
                : savedVal != null
                  ? savedVal
                  : defaultVal
        );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const allRefs = Object.values(refs);
    const keys = Object.keys(defaults);

    watch(allRefs, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const query: Record<string, string | undefined> = {
                ...(route.query as Record<string, string>)
            };
            const toSave: Record<string, string> = {};
            for (const [key, r] of Object.entries(refs)) {
                toSave[key] = r.value;
                if (r.value && r.value !== defaults[key]) {
                    query[key] = r.value;
                } else {
                    delete query[key];
                }
            }
            const queryChanged = keys.some((key) => {
                const current = route.query[key];
                const next = query[key];
                return next === undefined
                    ? current != null
                    : current !== next;
            });
            if (queryChanged) router.replace({query}).catch(() => {});
            try {
                localStorage.setItem(storageKey, JSON.stringify(toSave));
            } catch {
                /* quota */
            }
        }, 300);
    });

    // Browser back/forward changes the URL without remounting the page. The
    // URL is authoritative for that history entry; cancel any pending write
    // from the previous entry before reflecting it into local state.
    watch(
        () => keys.map((key) => route.query[key]),
        (values) => {
            clearTimeout(timer);
            keys.forEach((key, index) => {
                const value = values[index];
                const next = typeof value === 'string' ? value : defaults[key];
                if (refs[key].value !== next) refs[key].value = next;
            });
        }
    );

    onUnmounted(() => clearTimeout(timer));

    return refs;
}
