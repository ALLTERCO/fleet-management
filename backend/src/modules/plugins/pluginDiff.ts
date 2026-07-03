// Pure set-diff helpers; kept import-light for testability.

export function pluginsToAdd(
    diskPlugins: readonly string[],
    loadedPlugins: readonly string[]
): string[] {
    return diskPlugins.filter((p) => !loadedPlugins.includes(p));
}

export function pluginsToRemove(
    diskPlugins: readonly string[],
    loadedPlugins: readonly string[]
): string[] {
    return loadedPlugins.filter((p) => !diskPlugins.includes(p));
}
