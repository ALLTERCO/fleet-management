import {describe, expect, it} from 'vitest';
import {
    buildEmailChannelConfig,
    createEmailChannelConfigForm,
    fillEmailChannelConfigForm,
    resetEmailChannelConfigForm
} from '@/helpers/notificationEmailConfig';

describe('notification email channel config', () => {
    it('builds the backend channel config from one form object', () => {
        const form = createEmailChannelConfigForm();
        Object.assign(form, {
            mode: 'custom_smtp',
            from: 'fleet@example.com',
            toAddresses: 'ops@example.com, support@example.com',
            host: 'smtp.example.com',
            port: '587',
            secure: true,
            authUser: 'smtp-user',
            authPass: 'secret'
        });

        expect(buildEmailChannelConfig(form)).toEqual({
            mode: 'custom_smtp',
            from: 'fleet@example.com',
            toAddresses: ['ops@example.com', 'support@example.com'],
            host: 'smtp.example.com',
            port: 587,
            secure: true,
            auth: {
                type: 'password',
                user: 'smtp-user',
                pass: 'secret'
            }
        });
    });

    it('builds system SMTP mode without tenant SMTP credentials', () => {
        const form = createEmailChannelConfigForm();
        Object.assign(form, {
            mode: 'use_system_smtp',
            from: 'ignored@example.com',
            toAddresses: 'ops@example.com',
            host: 'ignored.example.com',
            authUser: 'ignored',
            authPass: 'ignored'
        });

        expect(buildEmailChannelConfig(form)).toEqual({
            mode: 'use_system_smtp',
            toAddresses: ['ops@example.com']
        });
    });

    it('fills and resets the form without leaking stale values', () => {
        const form = createEmailChannelConfigForm();

        fillEmailChannelConfigForm(form, {
            mode: 'custom_smtp',
            from: 'fleet@example.com',
            toAddresses: ['ops@example.com'],
            port: 465,
            secure: true,
            auth: {user: 'smtp-user', pass: 'secret'}
        });

        expect(form).toEqual({
            mode: 'custom_smtp',
            from: 'fleet@example.com',
            toAddresses: 'ops@example.com',
            host: '',
            port: 465,
            secure: true,
            authUser: 'smtp-user',
            authPass: 'secret'
        });

        resetEmailChannelConfigForm(form);
        expect(form).toEqual(createEmailChannelConfigForm());
    });
});
