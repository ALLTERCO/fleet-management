export type NodeRedView = 'flows' | 'editor';

const STORAGE_KEY = 'fm.nodeRed.view';

function asView(value: unknown): NodeRedView | null {
    return value === 'flows' || value === 'editor' ? value : null;
}

// Private browsing can throw on storage access; the tab must still open.
function readStored(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

/** A view named in the URL wins; otherwise the last one used; else the list. */
export function startingNodeRedView(fromUrl: unknown): NodeRedView {
    return asView(fromUrl) ?? asView(readStored()) ?? 'flows';
}

export function rememberNodeRedView(view: NodeRedView): void {
    try {
        localStorage.setItem(STORAGE_KEY, view);
    } catch {
        // Not remembering is fine; the list is the default.
    }
}

/**
 * Node-RED opens the tab named in its own #flow/<id> hash. Each flow gets its
 * own address, so keying the frame on it reloads the editor on a new flow.
 */
export function nodeRedEditorUrl(input: {
    base: string;
    flowId: string | null;
}): string {
    return input.flowId
        ? `${input.base}#flow/${encodeURIComponent(input.flowId)}`
        : input.base;
}
