import {describe, expect, it} from 'vitest';
import {
    brandingSetPayload,
    isMailTemplateEmpty,
    messageTextFieldsFor,
    PLACEHOLDERS_BY_TYPE
} from '@/helpers/zitadelMessageText';

describe('messageTextFieldsFor — fields per message type', () => {
    it('returns 7 fields including the no-placeholder button-text', () => {
        const fields = messageTextFieldsFor('passwordreset');
        expect(fields.map((f) => f.key)).toEqual([
            'title',
            'preHeader',
            'subject',
            'greeting',
            'text',
            'buttonText',
            'footerText'
        ]);
    });

    it('button-text has no placeholders because it is a CTA label', () => {
        const fields = messageTextFieldsFor('passwordreset');
        const button = fields.find((f) => f.key === 'buttonText');
        expect(button?.placeholders).toEqual([]);
    });

    it('body text is marked multiline so the editor renders a textarea', () => {
        const fields = messageTextFieldsFor('passwordreset');
        const body = fields.find((f) => f.key === 'text');
        expect(body?.multiline).toBe(true);
    });

    it('uses the per-type placeholder list so invite_user gets ApplicationName', () => {
        const fields = messageTextFieldsFor('invite_user');
        expect(fields[0].placeholders).toContain('{{.ApplicationName}}');
    });

    it('falls back to an empty placeholder set for an unknown type so nothing breaks', () => {
        const fields = messageTextFieldsFor('totally_made_up');
        expect(fields[0].placeholders).toEqual([]);
    });
});

describe('PLACEHOLDERS_BY_TYPE — discoverable common shape', () => {
    it('every value includes the common name placeholders so editors agree', () => {
        for (const placeholders of Object.values(PLACEHOLDERS_BY_TYPE)) {
            expect(placeholders).toContain('{{.FirstName}}');
            expect(placeholders).toContain('{{.LastName}}');
            expect(placeholders).toContain('{{.OrgName}}');
        }
    });
});

describe('brandingSetPayload — Zitadel additionalProperties:false guard', () => {
    it('keeps every allow-listed branding key so the setter accepts them', () => {
        const payload = brandingSetPayload(
            {
                primaryColor: '#1f73d6',
                fontColorDark: '#fff',
                disableWatermark: true,
                themeMode: 'THEME_MODE_AUTO'
            },
            'org-1'
        );
        expect(payload.primaryColor).toBe('#1f73d6');
        expect(payload.fontColorDark).toBe('#fff');
        expect(payload.disableWatermark).toBe(true);
        expect(payload.themeMode).toBe('THEME_MODE_AUTO');
    });

    it('drops unknown keys because Zitadel SetPolicy rejects them', () => {
        const payload = brandingSetPayload(
            {primaryColor: '#1f73d6', isDefault: true, policyId: 'abc'},
            'org-1'
        );
        expect(payload.isDefault).toBeUndefined();
        expect(payload.policyId).toBeUndefined();
    });

    it('always injects orgId so the multi-tenant call routes correctly', () => {
        expect(brandingSetPayload({}, 'org-1').orgId).toBe('org-1');
    });
});

describe('isMailTemplateEmpty — Tiptap empty-editor detection', () => {
    it('reports a null template as empty so we never ship null to Zitadel', () => {
        expect(isMailTemplateEmpty(null)).toBe(true);
    });

    it('reports a bare <p></p> as empty so the Tiptap default does not save', () => {
        expect(isMailTemplateEmpty('<p></p>')).toBe(true);
    });

    it('reports a template with real text as non-empty so it saves', () => {
        expect(isMailTemplateEmpty('<p>Hello</p>')).toBe(false);
    });

    it('reports a template with only a divider as non-empty because hr is meaningful', () => {
        expect(isMailTemplateEmpty('<hr/>')).toBe(false);
    });

    it('reports an image-only template as non-empty so logo-only mailers save', () => {
        expect(isMailTemplateEmpty('<img src="x"/>')).toBe(false);
    });
});
