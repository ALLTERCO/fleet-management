// Env-backed caps published on Channel.ListProviders so the
// UI pre-validates attachment count / MIME type / size before a submit
// that would fail at the backend anyway. Live value — operators can
// change the env without a code change and the UI adapts next reload.

import {envBool, envCsv, envInt} from '../../config/envReader';
import type {EmailCaps} from '../../types/api/channel';

const DEFAULT_CONTENT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'image/webp'
] as const;

export function getEmailCaps(): EmailCaps {
    return {
        maxAttachments: envInt('FM_EMAIL_MAX_ATTACHMENTS', 10, 0),
        maxAttachmentBytes: envInt(
            'FM_EMAIL_ATTACHMENT_MAX_BYTES',
            5 * 1024 * 1024,
            1024
        ),
        allowHttpAttachments: envBool('FM_EMAIL_ATTACHMENT_ALLOW_HTTP', false),
        assetOrgQuotaBytes: envInt(
            'FM_EMAIL_ASSETS_ORG_QUOTA_BYTES',
            50 * 1024 * 1024,
            1024
        ),
        assetAllowedContentTypes: envCsv(
            'FM_EMAIL_ASSETS_CONTENT_TYPES',
            DEFAULT_CONTENT_TYPES
        )
    };
}
