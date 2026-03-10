import {defineStore} from 'pinia';
import {ref} from 'vue';
import {getRegistry} from '@/tools/websocket';

export const useGeneralStore = defineStore('general', () => {
    const background = ref('');

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

    const setBackgroundImg = async (newImg: string) => {
        await getRegistry('ui').setItem('backgroundImg', newImg);
        await getRegistry('ui').setItem('backgroundColor', null);
        background.value = newImg;
    };

    const setBackgroundColor = async (newColor: string) => {
        await getRegistry('ui').setItem('backgroundColor', newColor);
        await getRegistry('ui').setItem('backgroundImg', null);
        background.value = newColor;
    };

    async function setup() {
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
        } catch (e) {
            console.error('error in setup', e);
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
