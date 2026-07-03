// Disk roots for the asset library.

import path from 'node:path';

const VISUAL_ASSET_ROOT = path.resolve(
    __dirname,
    '../../uploads/visual-assets'
);

const LIBRARY_DEFAULTS_ROOT = path.resolve(
    __dirname,
    '../../uploads/library-defaults'
);

export function visualAssetUploadRoot(): string {
    return VISUAL_ASSET_ROOT;
}

// Install-bundled assets. Read-only; never deleted by user actions.
export function libraryDefaultsRoot(): string {
    return LIBRARY_DEFAULTS_ROOT;
}
