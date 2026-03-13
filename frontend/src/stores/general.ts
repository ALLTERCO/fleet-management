import {defineStore} from 'pinia';
import {ref} from 'vue';
import {getRegistry} from '@/tools/websocket';

const BACKGROUND_STORAGE_KEY = 'fm_ui_background';

export const useGeneralStore = defineStore('general', () => {
    const background = ref(localStorage.getItem(BACKGROUND_STORAGE_KEY) || '');
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

    const setBackgroundImg = async (newImg: string) => {
        await getRegistry('ui').setItem('backgroundImg', newImg);
        await getRegistry('ui').setItem('backgroundColor', null);
        background.value = newImg;
        persistBackground(newImg);
    };

    const setBackgroundColor = async (newColor: string) => {
        await getRegistry('ui').setItem('backgroundColor', newColor);
        await getRegistry('ui').setItem('backgroundImg', null);
        background.value = newColor;
        persistBackground(newColor);
    };

    async function setup(retryCount = 0) {
        if (setupInFlight) return;
        setupInFlight = true;
        try {
            const res = await getRegistry('ui').getAll<any>();
            let bg = res.backgroundColor || res.backgroundImg;
            // Normalize legacy absolute URLs to relative paths
            if (bg && typeof bg === 'string' && bg.includes('/uploads/backgrounds/')) {
                try {
                    bg = new URL(bg).pathname;
                } catch { /* already relative — keep as-is */ }
            }
            background.value = bg;
            persistBackground(bg);
            if (setupRetryTimer) {
                clearTimeout(setupRetryTimer);
                setupRetryTimer = null;
            }
        } catch (e) {
            console.error('error in setup', e);
            if (retryCount < 3 && !setupRetryTimer) {
                // Startup can race the websocket/registry readiness once.
                // Retry a few times so the background is applied without
                // waiting for the settings page to touch the UI registry.
                setupRetryTimer = setTimeout(() => {
                    setupRetryTimer = null;
                    void setup(retryCount + 1);
                }, 1000 * (retryCount + 1));
            }
        } finally {
            setupInFlight = false;
        }
    }
    // setup() is called by App.vue after authentication is confirmed.
    // It must NOT be called in onMounted — the store initializes before
    // the OIDC callback completes, causing 401 "Not authenticated" errors.

    return {
        setup,
        background,
        setBackgroundImg,
        setBackgroundColor,
        solidColors
    };
});
