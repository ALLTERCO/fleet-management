import type {TemplateTokenDescriptor} from '@/helpers/templateTokens';

// Tokens accepted by Zitadel's mail template (Go html/template syntax).
// Mirrors the placeholders documented at zitadel.com under "Custom Texts".
export const ZITADEL_EMAIL_TOKENS: readonly TemplateTokenDescriptor[] = [
    {
        token: '.Title',
        label: 'Title',
        description: 'Header line shown at the top of the email.',
        example: 'Verify your email'
    },
    {
        token: '.PreHeader',
        label: 'Pre-header',
        description: 'Snippet shown by mail clients in the inbox preview.',
        example: 'Confirm your address to finish setup.'
    },
    {
        token: '.Subject',
        label: 'Subject',
        description: 'Email subject line.',
        example: 'Please verify your email'
    },
    {
        token: '.Greeting',
        label: 'Greeting',
        description: 'Salutation line.',
        example: 'Hello Alex,'
    },
    {
        token: '.Text',
        label: 'Body text',
        description: 'Main paragraph of the email.',
        example: "We've sent you this link to verify your address."
    },
    {
        token: '.URL',
        label: 'URL',
        description: 'Action link the call-to-action button points to.',
        example: 'https://accounts.example.com/verify?code=abc123'
    },
    {
        token: '.ButtonText',
        label: 'Button text',
        description: 'Label of the call-to-action button.',
        example: 'Verify email'
    },
    {
        token: '.PrimaryColor',
        label: 'Primary color',
        description: 'Hex color from the active branding policy.',
        example: '#4495D1'
    },
    {
        token: '.LogoURL',
        label: 'Logo URL',
        description: 'Public URL of the uploaded brand logo.',
        example: 'https://assets.example.com/logo.png'
    },
    {
        token: '.FooterText',
        label: 'Footer',
        description: 'Footer line shown below the body.',
        example: 'Sent by Example Inc.'
    },
    {
        token: '.ApplicationName',
        label: 'Application name',
        description: 'Name of the calling application (for invite emails).',
        example: 'Fleet Manager'
    }
] as const;
