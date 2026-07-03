// Zitadel message_text placeholders + field definitions per message type.
// Pulled out of pages/settings/branding.vue so adding a new message type
// is one row here, not a code edit in the settings page.

const PLACEHOLDERS_COMMON = ['{{.FirstName}}', '{{.LastName}}', '{{.OrgName}}'];

// Allow-listed per type so we never suggest a placeholder that won't
// resolve at delivery time. URL only exists where Zitadel sends a link.
export const PLACEHOLDERS_BY_TYPE: Record<string, string[]> = {
    passwordreset: [...PLACEHOLDERS_COMMON, '{{.URL}}'],
    verifyemail: [...PLACEHOLDERS_COMMON, '{{.URL}}'],
    invite_user: [...PLACEHOLDERS_COMMON, '{{.URL}}', '{{.ApplicationName}}'],
    password_change: [...PLACEHOLDERS_COMMON]
};

export interface MessageTextField {
    key:
        | 'title'
        | 'preHeader'
        | 'subject'
        | 'greeting'
        | 'text'
        | 'buttonText'
        | 'footerText';
    label: string;
    multiline: boolean;
    placeholders: readonly string[];
}

// Answer — fields rendered by the message-text editor for a given type.
// Button-text intentionally has no placeholders; it's a CTA label.
export function messageTextFieldsFor(type: string): MessageTextField[] {
    const placeholders = PLACEHOLDERS_BY_TYPE[type] ?? [];
    return [
        {key: 'title', label: 'Title', multiline: false, placeholders},
        {key: 'preHeader', label: 'Pre-header', multiline: false, placeholders},
        {key: 'subject', label: 'Subject', multiline: false, placeholders},
        {key: 'greeting', label: 'Greeting', multiline: false, placeholders},
        {key: 'text', label: 'Body text', multiline: true, placeholders},
        {
            key: 'buttonText',
            label: 'Button text',
            multiline: false,
            placeholders: []
        },
        {key: 'footerText', label: 'Footer', multiline: false, placeholders}
    ];
}

// Branding.SetPolicy schema is additionalProperties:false. GetPolicy
// returns Zitadel-internal fields (isDefault, policyId, logoUrl, …)
// that the setter rejects. Allowlist what the API accepts.
const BRANDING_SET_KEYS = [
    'primaryColor',
    'warnColor',
    'backgroundColor',
    'fontColor',
    'primaryColorDark',
    'warnColorDark',
    'backgroundColorDark',
    'fontColorDark',
    'hideLoginNameSuffix',
    'disableWatermark',
    'themeMode'
] as const;

// Answer — branding payload with only SetPolicy-allowed fields.
export function brandingSetPayload(
    branding: Record<string, unknown>,
    orgId: string
): Record<string, unknown> {
    const out: Record<string, unknown> = {orgId};
    for (const key of BRANDING_SET_KEYS) {
        if (branding[key] !== undefined) out[key] = branding[key];
    }
    return out;
}

// Tiptap reports an empty editor as `<p></p>`. Treat that as "no
// template" so we don't ship empty HTML to Zitadel. Templates with
// real visible content — text, images, tables, dividers — save normally.
const MEDIA_TAG_RE = /<(img|table|hr|video|iframe|svg)\b/i;

// Answer — true if the editor body has no meaningful content.
export function isMailTemplateEmpty(html: string | null | undefined): boolean {
    const raw = html?.trim();
    if (!raw) return true;
    if (MEDIA_TAG_RE.test(raw)) return false;
    return raw.replace(/<[^>]+>/g, '').trim() === '';
}
