import path from 'node:path';

export const CFG_FOLDER =
    process.env?.CONFIG_FOLDER || path.join(__dirname, '../../cfg');
export const STATIC_FOLDER =
    process.env?.STATIC_FOLDER || path.join(__dirname, '../../static');
export const PLUGINS_FOLDER =
    process.env?.PLUGINS_FOLDER || path.join(__dirname, '../../plugins');
