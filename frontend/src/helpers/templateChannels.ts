// The channel variants a message template carries, and the fields each one
// edits. One home so the editor and the preview always offer the same set.

export type TemplateChannel = 'email' | 'slack' | 'teams' | 'fallback';

export interface TemplateChannelOption {
    value: TemplateChannel;
    label: string;
}

export const TEMPLATE_CHANNEL_OPTIONS: TemplateChannelOption[] = [
    {value: 'email', label: 'Email'},
    {value: 'slack', label: 'Slack'},
    {value: 'teams', label: 'Teams'},
    {value: 'fallback', label: 'Text'}
];

/** Body field carrying the message for each channel. Email's subject is edited
 *  separately, so it is not listed here. */
export const TEMPLATE_CHANNEL_BODY_KEY: Record<TemplateChannel, string> = {
    email: 'html',
    slack: 'blocks',
    teams: 'card',
    fallback: 'text'
};

/** How a rendered body should be presented — JSON payloads are shown as code,
 *  email as markup, plain text as-is. */
export type TemplatePreviewMode = 'html' | 'json' | 'plain';

export const TEMPLATE_CHANNEL_PREVIEW_MODE: Record<
    TemplateChannel,
    TemplatePreviewMode
> = {
    email: 'html',
    slack: 'json',
    teams: 'json',
    fallback: 'plain'
};
