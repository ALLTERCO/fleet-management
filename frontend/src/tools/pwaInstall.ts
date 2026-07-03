// Capture the beforeinstallprompt event so the app can offer "Install app"
// from any UI surface. Without capture, the event fires once and is lost.
//
// Usage:
//   import {canInstallPwa, triggerPwaInstall} from '@/tools/pwaInstall';
//   if (canInstallPwa.value) await triggerPwaInstall();

import {ref} from 'vue';

interface BeforeInstallPromptEvent extends Event {
    readonly platforms: string[];
    readonly userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
    prompt(): Promise<void>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export const canInstallPwa = ref(false);
export const isInstalled = ref(false);

export function initPwaInstall(): void {
    if (typeof window === 'undefined') return;

    if (
        window.matchMedia('(display-mode: standalone)').matches ||
        // Safari iOS exposes navigator.standalone
        (navigator as Navigator & {standalone?: boolean}).standalone === true
    ) {
        isInstalled.value = true;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e as BeforeInstallPromptEvent;
        canInstallPwa.value = true;
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        canInstallPwa.value = false;
        isInstalled.value = true;
    });
}

export async function triggerPwaInstall(): Promise<
    'accepted' | 'dismissed' | null
> {
    if (!deferredPrompt) return null;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    deferredPrompt = null;
    canInstallPwa.value = false;
    return result.outcome;
}
