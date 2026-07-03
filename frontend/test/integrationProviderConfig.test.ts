// One purpose per test — describes the rule, not the function symbol.

import {describe, expect, it} from 'vitest';
import {
    contentMetaFor,
    DEFAULT_CONTENT_META,
    PRIMARY_PROVIDERS,
    PROVIDER_CONTENT_META,
    TEMPLATE_FIELDS_BY_PROVIDER,
    telegramEditorMode,
    telegramHintFor,
    TILE_META
} from '@/helpers/integrationProviderConfig';

describe('contentMetaFor — provider-specific section header', () => {
    it('returns the default copy when provider is null so empty state has labels', () => {
        expect(contentMetaFor(null)).toBe(DEFAULT_CONTENT_META);
    });

    it('returns the Slack copy for slack_webhook because the section heading must match the body type', () => {
        expect(contentMetaFor('slack_webhook')).toEqual(
            PROVIDER_CONTENT_META.slack_webhook
        );
    });

    it('returns the Teams copy for teams_workflow_webhook', () => {
        const meta = contentMetaFor('teams_workflow_webhook');
        expect(meta.title).toBe('Adaptive card');
    });

    it('returns the Telegram copy for telegram_bot', () => {
        const meta = contentMetaFor('telegram_bot');
        expect(meta.title).toBe('Message');
    });

    it('falls back to the default copy when the provider has no specific override', () => {
        expect(contentMetaFor('generic_webhook')).toBe(DEFAULT_CONTENT_META);
    });
});

describe('telegramEditorMode — parse mode picks the editor language', () => {
    it('returns html for HTML parseMode so the editor highlights tags', () => {
        expect(telegramEditorMode('HTML')).toBe('html');
    });

    it('returns markdown for MarkdownV2 parseMode so escape rules are visible', () => {
        expect(telegramEditorMode('MarkdownV2')).toBe('markdown');
    });

    it('falls back to plain for unknown parseMode so the editor never crashes', () => {
        expect(telegramEditorMode('weird')).toBe('plain');
    });

    it('falls back to plain when parseMode is not a string at all', () => {
        expect(telegramEditorMode(undefined)).toBe('plain');
        expect(telegramEditorMode(null)).toBe('plain');
    });
});

describe('telegramHintFor — parse mode picks the hint copy', () => {
    it('mentions the MarkdownV2 escape characters so users see the gotcha', () => {
        expect(telegramHintFor('MarkdownV2')).toContain('MarkdownV2');
    });

    it('mentions the HTML subset for HTML parseMode', () => {
        expect(telegramHintFor('HTML')).toContain('HTML subset');
    });

    it('returns the plain-text hint when parseMode is unset so users know they can opt in', () => {
        expect(telegramHintFor(undefined)).toContain('Plain text');
    });
});

describe('Static tables', () => {
    it('lists every primary provider tile so the picker order is deterministic', () => {
        expect(PRIMARY_PROVIDERS).toEqual([
            'email_smtp',
            'slack_webhook',
            'teams_workflow_webhook',
            'telegram_bot'
        ]);
    });

    it('exposes a tagline for each primary tile because the picker reads it', () => {
        for (const p of PRIMARY_PROVIDERS) {
            expect(TILE_META[p]?.tagline).toBeDefined();
        }
    });

    it('exposes template fields for email_smtp covering subject/html/text', () => {
        const fields = TEMPLATE_FIELDS_BY_PROVIDER.email_smtp ?? [];
        expect(fields.map((f) => f.key)).toEqual([
            'subjectTemplate',
            'htmlTemplate',
            'textTemplate'
        ]);
    });
});
