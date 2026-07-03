import * as path from 'node:path';

// Shared upload paths — single source of truth for static-serving + route handlers.
// Anchored on this file's location so tests + scripts resolve identically to the
// running server.
const ROOT = path.join(__dirname, '../../../../');

export const backgroundsPath = path.join(ROOT, 'uploads/backgrounds');
export const profilePicturesPath = path.join(ROOT, 'uploads/profilePics');
export const reportImagesPath = path.join(ROOT, 'uploads/reportImages');
export const emReportsPath = path.join(ROOT, 'uploads/reports');
export const auditLogsPath = path.join(ROOT, 'uploads/audit-logs');
