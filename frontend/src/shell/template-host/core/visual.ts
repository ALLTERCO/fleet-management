// How to draw anything that has a picture.
//
// Devices already had this and it worked: the host owns the image rules, core
// hands the template a descriptor, and no template ever builds a URL. Groups,
// tags, virtual devices and entities had nothing, so each one still forced a
// template to guess `/api/assets/<uuid>` — the same fake-image bug, one layer
// out.
//
// So the device rule is generalised rather than copied. One resolver, any
// subject. A host that has not said what its things look like returns nothing,
// which is the honest answer and the reason every field here is optional.

/** What a template renders. Never a URL a template computed itself. */
export type HostVisual =
    | {kind: 'icon'; faClass: string; accent?: string}
    | {kind: 'image'; src: string}
    | {kind: 'cdn'; src: string};

/** What the things carrying a picture look like on the wire. Every field is
 *  optional because every one of them is, on every subject. */
export type VisualSubject = {
    /** Uploaded asset. A UUID: only the host knows how to serve it. */
    imageAssetId?: string | null;
    /** Icon class, applied verbatim, e.g. 'fas fa-thermometer-half'. */
    icon?: string | null;
    /** Accent token KEY, not CSS. Maps to `--accent-<key>`. */
    accent?: string | null;
    /** Bundled product image, resolved by the host's model→image rule. */
    imageModel?: string | null;
    [key: string]: unknown;
};

export type VisualResolver = (subject: VisualSubject) => HostVisual | undefined;

let resolver: VisualResolver | null = null;

/** Installed once by the runtime that owns the image rules. */
export function setVisualResolver(next: VisualResolver | null): void {
    resolver = next;
}

export function resolveHostVisual(subject: unknown): HostVisual | undefined {
    if (!resolver || !subject || typeof subject !== 'object') return undefined;
    return resolver(subject as VisualSubject);
}

/**
 * Adds `logo` only when the host resolved one, so "no picture" and "this host
 * has no picture rule" never read as a value.
 *
 * `logo` because that is what a device already calls it. A group row also has
 * a `visual` field meaning the raw decoration it was resolved FROM, so reusing
 * that word here would give one row two different `visual`s.
 */
export function visualField(subject: unknown): {logo?: HostVisual} {
    const logo = resolveHostVisual(subject);
    return logo ? {logo} : {};
}
