import {defineStore} from 'pinia';
import {ref} from 'vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {
    initialDisplayBackground,
    isProtectedBackgroundPath
} from '@/helpers/backgroundAssets';
import {getRegistry, sendRPC} from '@/tools/websocket';
import {isRecoverableReconnectError} from '@/tools/wsReconnectErrors';

const BACKGROUND_STORAGE_KEY = 'fm_ui_background';

export const useGeneralStore = defineStore('general', () => {
    const background = ref(
        initialDisplayBackground(localStorage.getItem(BACKGROUND_STORAGE_KEY))
    );
    // Sidebar glass is always on — the user-facing toggle was removed.
    const sidebarGlass = ref(true);
    let setupRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let setupInFlight = false;

    const solidColors = [
        '#FF0000',
        '#FFA500',
        '#FFFF00',
        '#008000',
        '#0000FF',
        '#4B0082',
        '#EE82EE',
        '#000000',
        '#808080',
        '#FFFFFF'
    ];

    const persistBackground = (value: string | null | undefined) => {
        if (!value || value === 'undefined') {
            localStorage.removeItem(BACKGROUND_STORAGE_KEY);
            return;
        }
        localStorage.setItem(BACKGROUND_STORAGE_KEY, value);
    };

    // UI registry is global; keep background choice browser-local.
    function assetPath(value: string): string {
        try {
            const url = new URL(value, FLEET_MANAGER_HTTP);
            return url.pathname;
        } catch {
            return value.split('?')[0];
        }
    }

    async function resolveBackgroundUrl(stored: string): Promise<string> {
        if (!isProtectedBackgroundPath(stored)) return stored;
        const res = await sendRPC<{
            originals: string[];
            thumbnails: string[];
        }>('FLEET_MANAGER', 'Media.Background.List', {});
        const base = `${FLEET_MANAGER_HTTP}/uploads/backgrounds/`;
        const match = res.originals.find(
            (file) => assetPath(`${base}${file}`) === assetPath(stored)
        );
        return match ? `${base}${match}` : '';
    }

    const setBackgroundImg = (newImg: string, displayImg?: string) => {
        background.value = displayImg ?? newImg;
        persistBackground(newImg);
    };

    const setBackgroundColor = (newColor: string) => {
        background.value = newColor;
        persistBackground(newColor);
    };

    async function setup(retryCount = 0) {
        if (setupInFlight) return;
        setupInFlight = true;
        try {
            const res = await getRegistry('ui').getAll<any>();
            let bg = res.backgroundColor || res.backgroundImg;
            // Normalize legacy absolute URLs.
            if (bg && typeof bg === 'string' && isProtectedBackgroundPath(bg)) {
                try {
                    bg = new URL(bg).pathname;
                } catch {
                    /* already relative — keep as-is */
                }
            }
            background.value =
                typeof bg === 'string' ? await resolveBackgroundUrl(bg) : bg;
            persistBackground(bg);
            if (setupRetryTimer) {
                clearTimeout(setupRetryTimer);
                setupRetryTimer = null;
            }
        } catch (e) {
            logSetupFailure(e);
            if (retryCount < 3 && !setupRetryTimer) {
                // Registry can be ready just after auth.
                setupRetryTimer = setTimeout(
                    () => {
                        setupRetryTimer = null;
                        void setup(retryCount + 1);
                    },
                    1000 * (retryCount + 1)
                );
            }
        } finally {
            setupInFlight = false;
        }
    }
    // App.vue calls setup after auth; earlier calls can 401.

    function logSetupFailure(error: unknown): void {
        if (isRecoverableReconnectError(error)) {
            console.warn('setup delayed by reconnect', error);
            return;
        }
        console.error('error in setup', error);
    }

    function $dispose() {
        if (setupRetryTimer) {
            clearTimeout(setupRetryTimer);
            setupRetryTimer = null;
        }
    }

    return {
        setup,
        background,
        sidebarGlass,
        setBackgroundImg,
        setBackgroundColor,
        solidColors,
        $dispose
    };
});
