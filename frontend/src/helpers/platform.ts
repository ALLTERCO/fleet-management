// Modern Apple-platform detection — userAgentData first, UA fallback.
// Only used for cosmetic key-hint labels (⌘ vs Ctrl); never gates logic.

interface NavigatorWithUAData extends Navigator {
    userAgentData?: {platform?: string};
}

const APPLE_UA_RE = /mac|iphone|ipad|ipod/i;

export function isApplePlatform(nav: Navigator = navigator): boolean {
    const uaData = (nav as NavigatorWithUAData).userAgentData;
    if (uaData?.platform)
        return uaData.platform.toLowerCase().startsWith('mac');
    return APPLE_UA_RE.test(nav.userAgent);
}

export function modKeyLabel(nav: Navigator = navigator): '⌘' | 'Ctrl' {
    return isApplePlatform(nav) ? '⌘' : 'Ctrl';
}
