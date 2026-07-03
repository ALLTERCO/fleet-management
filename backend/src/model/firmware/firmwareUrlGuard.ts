import RpcError from '../../rpc/RpcError';

const FM_FIRMWARE_FILE_PATH_PREFIX = '/media/firmware-file/';

/** Token from an FM firmware-file URL, or null when the URL is external. */
export function firmwareFileTokenFromUrl(url: URL): string | null {
    if (!url.pathname.startsWith(FM_FIRMWARE_FILE_PATH_PREFIX)) return null;
    const token = url.pathname.slice(FM_FIRMWARE_FILE_PATH_PREFIX.length);
    return token.length > 0 && !token.includes('/') ? token : null;
}

/**
 * Parse a firmware URL, rejecting only an invalid string. The device (not FM)
 * performs the fetch and the caller holds devices:execute, so this is not an
 * FM SSRF surface. Returns the URL so the caller can resolve a library item.
 */
export function parseFirmwareUrl(rawUrl: string): URL {
    try {
        return new URL(rawUrl);
    } catch {
        throw RpcError.InvalidParams('Firmware URL is not a valid URL');
    }
}
