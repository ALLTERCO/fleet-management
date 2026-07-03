// SMTP provider preset catalog — single source of truth for host/port/
// TLS defaults. Operators override any field per endpoint.

export type SmtpPresetCategory =
    | 'personal'
    | 'workspace'
    | 'transactional'
    | 'regional'
    | 'custom';

export interface SmtpPreset {
    /** Stable key stored on endpoint config. */
    key: string;
    /** UI label. */
    label: string;
    category: SmtpPresetCategory;
    host: string;
    port: number;
    /** true = implicit TLS (port 465); false = STARTTLS upgrade (587/25). */
    secure: boolean;
    /** Require app-password (not account password). */
    appPasswordOnly?: boolean;
    /** Tenant SMTP AUTH disabled by default — needs OAuth2 or admin opt-in. */
    oauthRequired?: boolean;
    /** Short operator-facing note. */
    notes?: string;
    /** Provider docs for the auth flow. */
    docsUrl?: string;
}

export const SMTP_PRESETS: readonly SmtpPreset[] = Object.freeze([
    {
        key: 'custom',
        label: 'Custom SMTP server',
        category: 'custom',
        host: '',
        port: 587,
        secure: false
    },

    // ── Personal / consumer ───────────────────────────────────────────
    {
        key: 'gmail',
        label: 'Gmail',
        category: 'personal',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        appPasswordOnly: true,
        notes:
            '2FA must be enabled on the account. Generate an app password at ' +
            'https://myaccount.google.com/apppasswords and paste it as the password.',
        docsUrl: 'https://support.google.com/accounts/answer/185833'
    },
    {
        key: 'google_workspace',
        label: 'Google Workspace',
        category: 'workspace',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        appPasswordOnly: true,
        notes:
            'Requires app password (2FA). For OAuth2, set an allowlisted ' +
            'service account in the Workspace Admin console.',
        docsUrl: 'https://support.google.com/a/answer/176600'
    },
    {
        key: 'outlook_personal',
        label: 'Outlook.com / Hotmail',
        category: 'personal',
        host: 'smtp-mail.outlook.com',
        port: 587,
        secure: false,
        appPasswordOnly: true,
        notes: '2FA required. Generate an app password at https://account.live.com/proofs/AppPassword.',
        docsUrl:
            'https://support.microsoft.com/en-us/account-billing/using-app-passwords-with-apps-that-dont-support-two-step-verification-5896ed9b-4263-e681-128a-a6f2979a7944'
    },
    {
        key: 'microsoft365',
        label: 'Microsoft 365 (business)',
        category: 'workspace',
        host: 'smtp.office365.com',
        port: 587,
        secure: false,
        oauthRequired: true,
        notes:
            'SMTP AUTH is disabled by default for M365 tenants (Oct 2022). ' +
            'Options: (1) tenant admin re-enables SMTP AUTH for the mailbox; ' +
            '(2) use OAuth2 (phase C); (3) relay through SendGrid / SES.',
        docsUrl:
            'https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission'
    },
    {
        key: 'yahoo',
        label: 'Yahoo Mail',
        category: 'personal',
        host: 'smtp.mail.yahoo.com',
        port: 465,
        secure: true,
        appPasswordOnly: true,
        notes: '2FA + app password required.',
        docsUrl:
            'https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html'
    },
    {
        key: 'icloud',
        label: 'Apple iCloud Mail',
        category: 'personal',
        host: 'smtp.mail.me.com',
        port: 587,
        secure: false,
        appPasswordOnly: true,
        notes: 'Generate an app-specific password at appleid.apple.com.',
        docsUrl: 'https://support.apple.com/en-us/102654'
    },
    {
        key: 'aol',
        label: 'AOL Mail',
        category: 'personal',
        host: 'smtp.aol.com',
        port: 465,
        secure: true,
        appPasswordOnly: true
    },
    {
        key: 'proton_bridge',
        label: 'Proton Mail (Bridge)',
        category: 'personal',
        host: '127.0.0.1',
        port: 1025,
        secure: false,
        notes:
            'Requires Proton Mail Bridge running on the same host. Use the ' +
            'bridge-provided username + password; Bridge issues a STARTTLS ' +
            'certificate you may need to trust.',
        docsUrl: 'https://proton.me/mail/bridge'
    },
    {
        key: 'gmx',
        label: 'GMX Mail',
        category: 'personal',
        host: 'mail.gmx.com',
        port: 587,
        secure: false
    },
    {
        key: 'web_de',
        label: 'Web.de',
        category: 'personal',
        host: 'smtp.web.de',
        port: 587,
        secure: false
    },
    {
        key: 'yandex',
        label: 'Yandex Mail',
        category: 'personal',
        host: 'smtp.yandex.com',
        port: 465,
        secure: true,
        notes: 'Enable "Allow IMAP/SMTP" in Yandex settings first.'
    },
    {
        key: 'mail_ru',
        label: 'Mail.ru',
        category: 'personal',
        host: 'smtp.mail.ru',
        port: 465,
        secure: true,
        appPasswordOnly: true
    },
    {
        key: 'fastmail',
        label: 'Fastmail',
        category: 'personal',
        host: 'smtp.fastmail.com',
        port: 465,
        secure: true,
        appPasswordOnly: true,
        docsUrl: 'https://www.fastmail.help/hc/en-us/articles/360058752394'
    },
    {
        key: 'zoho_com',
        label: 'Zoho Mail (.com)',
        category: 'workspace',
        host: 'smtp.zoho.com',
        port: 465,
        secure: true,
        notes: 'Use the app-specific password generated in Zoho Mail settings.'
    },
    {
        key: 'zoho_eu',
        label: 'Zoho Mail (EU)',
        category: 'workspace',
        host: 'smtp.zoho.eu',
        port: 465,
        secure: true
    },
    {
        key: 'gandi',
        label: 'Gandi Mail',
        category: 'workspace',
        host: 'mail.gandi.net',
        port: 465,
        secure: true
    },

    // ── Transactional relays ──────────────────────────────────────────
    {
        key: 'sendgrid',
        label: 'SendGrid',
        category: 'transactional',
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        notes: 'Username is literally "apikey"; password is your SendGrid API key.',
        docsUrl:
            'https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api'
    },
    {
        key: 'mailgun_us',
        label: 'Mailgun (US)',
        category: 'transactional',
        host: 'smtp.mailgun.org',
        port: 587,
        secure: false,
        docsUrl:
            'https://documentation.mailgun.com/en/latest/user_manual.html#sending-via-smtp'
    },
    {
        key: 'mailgun_eu',
        label: 'Mailgun (EU)',
        category: 'transactional',
        host: 'smtp.eu.mailgun.org',
        port: 587,
        secure: false
    },
    {
        key: 'postmark',
        label: 'Postmark',
        category: 'transactional',
        host: 'smtp.postmarkapp.com',
        port: 587,
        secure: false,
        notes:
            'Username and password are both the Server API Token from the ' +
            'Postmark dashboard.',
        docsUrl:
            'https://postmarkapp.com/developer/user-guide/send-email-with-smtp'
    },
    {
        key: 'amazon_ses_us_east_1',
        label: 'Amazon SES (us-east-1)',
        category: 'transactional',
        host: 'email-smtp.us-east-1.amazonaws.com',
        port: 587,
        secure: false,
        notes: 'Create SMTP credentials in the SES console (IAM-backed).',
        docsUrl:
            'https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html'
    },
    {
        key: 'amazon_ses_us_west_2',
        label: 'Amazon SES (us-west-2)',
        category: 'transactional',
        host: 'email-smtp.us-west-2.amazonaws.com',
        port: 587,
        secure: false
    },
    {
        key: 'amazon_ses_eu_west_1',
        label: 'Amazon SES (eu-west-1)',
        category: 'transactional',
        host: 'email-smtp.eu-west-1.amazonaws.com',
        port: 587,
        secure: false
    },
    {
        key: 'amazon_ses_eu_central_1',
        label: 'Amazon SES (eu-central-1)',
        category: 'transactional',
        host: 'email-smtp.eu-central-1.amazonaws.com',
        port: 587,
        secure: false
    },
    {
        key: 'amazon_ses_ap_southeast_1',
        label: 'Amazon SES (ap-southeast-1)',
        category: 'transactional',
        host: 'email-smtp.ap-southeast-1.amazonaws.com',
        port: 587,
        secure: false
    },
    {
        key: 'amazon_ses_ap_northeast_1',
        label: 'Amazon SES (ap-northeast-1)',
        category: 'transactional',
        host: 'email-smtp.ap-northeast-1.amazonaws.com',
        port: 587,
        secure: false
    },
    {
        key: 'mailjet',
        label: 'Mailjet',
        category: 'transactional',
        host: 'in-v3.mailjet.com',
        port: 587,
        secure: false,
        notes: 'Username = API key, password = secret key.',
        docsUrl: 'https://dev.mailjet.com/smtp-relay/configuration/'
    },
    {
        key: 'brevo',
        label: 'Brevo (Sendinblue)',
        category: 'transactional',
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        notes: 'Username = account email, password = SMTP key (not password).',
        docsUrl: 'https://help.brevo.com/hc/en-us/articles/7924908994450'
    },
    {
        key: 'sparkpost',
        label: 'SparkPost',
        category: 'transactional',
        host: 'smtp.sparkpostmail.com',
        port: 587,
        secure: false,
        notes: 'Username = "SMTP_Injection"; password = API key.'
    },
    {
        key: 'elastic_email',
        label: 'Elastic Email',
        category: 'transactional',
        host: 'smtp.elasticemail.com',
        port: 2525,
        secure: false
    },
    {
        key: 'smtp2go',
        label: 'SMTP2GO',
        category: 'transactional',
        host: 'mail.smtp2go.com',
        port: 2525,
        secure: false
    },
    {
        key: 'mandrill',
        label: 'Mandrill (Mailchimp Transactional)',
        category: 'transactional',
        host: 'smtp.mandrillapp.com',
        port: 587,
        secure: false,
        notes: 'Username = account username, password = API key.'
    }
]);

const PRESETS_BY_KEY: Readonly<Record<string, SmtpPreset>> = Object.freeze(
    Object.fromEntries(SMTP_PRESETS.map((p) => [p.key, p]))
);

export function getSmtpPreset(key: string | undefined): SmtpPreset | undefined {
    if (!key) return undefined;
    return PRESETS_BY_KEY[key];
}

export const SMTP_PRESET_KEYS: readonly string[] = Object.freeze(
    SMTP_PRESETS.map((p) => p.key)
);
