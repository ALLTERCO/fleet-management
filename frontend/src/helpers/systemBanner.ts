// One call for any subsystem that must tell the admin something now:
// showSystemBanner({id, severity, title, onAction}). The banner store keeps
// the stack; SystemBanner.vue draws it. Producers remove their own banner
// with clearSystemBanner when the problem is gone.
import {type SystemBanner, useBannerStore} from '@/stores/banner';

export function showSystemBanner(banner: SystemBanner): void {
    useBannerStore().show(banner);
}

export function clearSystemBanner(id: string): void {
    useBannerStore().resolve(id);
}
