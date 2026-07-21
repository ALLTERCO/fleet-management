// Returns false instead of throwing; callers decide how to surface it.
export async function copyText(text: string): Promise<boolean> {
    if (!navigator.clipboard) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
