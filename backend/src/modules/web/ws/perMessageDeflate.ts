// RFC 7692 per-message-deflate config (IOTN production tuning).

export interface DeflateConfigInput {
    compressionEnabled: boolean;
    compressionLevel: number;
    compressionMemLevel: number;
    compressionThreshold: number;
    compressionConcurrencyLimit: number;
}

export interface PerMessageDeflateConfig {
    zlibDeflateOptions: {level: number; memLevel: number};
    zlibInflateOptions: {chunkSize: number};
    clientNoContextTakeover: true;
    serverNoContextTakeover: true;
    threshold: number;
    concurrencyLimit: number;
}

const INFLATE_CHUNK_BYTES = 10 * 1024;

export function buildPerMessageDeflate(
    cfg: DeflateConfigInput
): PerMessageDeflateConfig | false {
    if (!cfg.compressionEnabled) return false;
    return {
        zlibDeflateOptions: {
            level: cfg.compressionLevel,
            memLevel: cfg.compressionMemLevel
        },
        zlibInflateOptions: {chunkSize: INFLATE_CHUNK_BYTES},
        clientNoContextTakeover: true,
        serverNoContextTakeover: true,
        threshold: cfg.compressionThreshold,
        concurrencyLimit: cfg.compressionConcurrencyLimit
    };
}
