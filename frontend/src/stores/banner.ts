// System banners: one line at the top of the app for something the product
// itself must tell the admin. Any subsystem can show one; the system health
// alert bridge is the first producer. A banner stays until the person or
// the producer dismisses it, so a problem is never silently gone.
import {defineStore} from 'pinia';
import {type Ref, ref} from 'vue';

export type BannerSeverity = 'info' | 'warning' | 'critical';

export interface SystemBanner {
    /** Stable key, so a producer can update or remove its own banner. */
    id: string;
    severity: BannerSeverity;
    title: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
    /** Fires once when the banner leaves, by hand or by the producer. */
    onDismiss?: () => void;
    /** When the thing happened, epoch ms; the banner shows a live age. */
    since?: number;
}

const MAX_STACK = 3;
const DISMISSED_KEY = 'fm.banner.dismissed';

function readDismissed(): Set<string> {
    try {
        const raw = sessionStorage.getItem(DISMISSED_KEY);
        return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
        return new Set();
    }
}

function writeDismissed(ids: Set<string>): void {
    try {
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
    } catch {
        // Session storage is a convenience; a banner shown twice is harmless.
    }
}

export const useBannerStore = defineStore('banner', () => {
    const banners: Ref<SystemBanner[]> = ref([]);
    const dismissed = readDismissed();

    // A banner the person already closed this session stays closed.
    function show(banner: SystemBanner): void {
        if (dismissed.has(banner.id)) return;
        const index = banners.value.findIndex((b) => b.id === banner.id);
        if (index >= 0) {
            banners.value.splice(index, 1, banner);
            return;
        }
        banners.value.unshift(banner);
        while (banners.value.length > MAX_STACK) banners.value.pop();
    }

    function remove(id: string): void {
        const index = banners.value.findIndex((b) => b.id === id);
        if (index < 0) return;
        const [banner] = banners.value.splice(index, 1);
        banner.onDismiss?.();
    }

    // Closed by the person: remembered for the session.
    function dismiss(id: string): void {
        dismissed.add(id);
        writeDismissed(dismissed);
        remove(id);
    }

    // Closed by the producer: the problem is gone, so it may show again later.
    function resolve(id: string): void {
        dismissed.delete(id);
        writeDismissed(dismissed);
        remove(id);
    }

    return {banners, show, dismiss, resolve};
});
