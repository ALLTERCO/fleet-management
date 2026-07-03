// A real deploy and a transient import failure throw the same error; tell them
// apart by whether the server now serves a different entry-module hash.

/** The entry `<script type="module" src=...>` from a served index.html. */
export function extractEntryModuleSrc(html: string): string | null {
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    for (const tag of scripts) {
        if (!/type=["']module["']/i.test(tag)) continue;
        const src = /\bsrc=["']([^"']+)["']/i.exec(tag);
        if (src) return src[1];
    }
    return null;
}

/** True only when the served HTML's entry hash differs from the running one. */
export function isNewBundleServed(
    runningEntrySrc: string | null,
    servedHtml: string | null
): boolean {
    if (!runningEntrySrc || !servedHtml) return false;
    const served = extractEntryModuleSrc(servedHtml);
    return served !== null && served !== runningEntrySrc;
}

function runningEntryModuleSrc(): string | null {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector<HTMLScriptElement>(
        'script[type="module"][src]'
    );
    if (!el) return null;
    try {
        return new URL(el.src, window.location.href).pathname;
    } catch {
        return el.getAttribute('src');
    }
}

/** True only if the server now serves a different build (offline → false). */
export async function newBundleIsServed(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    const running = runningEntryModuleSrc();
    if (!running) return false;
    try {
        // Unique query bypasses the SW precache (keyed on bare "/") to read live.
        const res = await fetch(
            `${window.location.origin}/?_swcheck=${Date.now()}`,
            {cache: 'no-store'}
        );
        if (!res.ok) return false;
        return isNewBundleServed(running, await res.text());
    } catch {
        return false;
    }
}
