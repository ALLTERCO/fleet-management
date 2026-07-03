import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

const ORG_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 64};
const HEX_COLOR: JsonSchema = {type: 'string', pattern: '^#[0-9a-fA-F]{6}$'};
const THEME: JsonSchema = {type: 'string', enum: ['light', 'dark']};
const THEME_MODE: JsonSchema = {
    type: 'string',
    enum: ['THEME_MODE_AUTO', 'THEME_MODE_LIGHT', 'THEME_MODE_DARK']
};
const FONT_CONTENT_TYPES: JsonSchema = {
    type: 'string',
    enum: ['font/ttf', 'application/font-ttf', 'application/x-font-ttf']
};

const RESP_OK: JsonSchema = {
    type: 'object',
    required: ['ok'],
    properties: {ok: {type: 'boolean'}}
};
const RESP_POLICY: JsonSchema = {
    type: 'object',
    description: 'Active or draft label policy as Zitadel returns it.'
};

export interface BrandingScopeParams {
    orgId: string;
}
export const BRANDING_GET_POLICY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {orgId: ORG_ID}
};

export type BrandingGetDefaultParams = Record<string, never>;
export const BRANDING_GET_DEFAULT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export interface BrandingSetPolicyParams {
    orgId: string;
    primaryColor?: string;
    warnColor?: string;
    backgroundColor?: string;
    fontColor?: string;
    primaryColorDark?: string;
    warnColorDark?: string;
    backgroundColorDark?: string;
    fontColorDark?: string;
    hideLoginNameSuffix?: boolean;
    disableWatermark?: boolean;
    themeMode?: 'THEME_MODE_AUTO' | 'THEME_MODE_LIGHT' | 'THEME_MODE_DARK';
}
export const BRANDING_SET_POLICY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        primaryColor: HEX_COLOR,
        warnColor: HEX_COLOR,
        backgroundColor: HEX_COLOR,
        fontColor: HEX_COLOR,
        primaryColorDark: HEX_COLOR,
        warnColorDark: HEX_COLOR,
        backgroundColorDark: HEX_COLOR,
        fontColorDark: HEX_COLOR,
        hideLoginNameSuffix: {type: 'boolean'},
        disableWatermark: {type: 'boolean'},
        themeMode: THEME_MODE
    }
};

export interface BrandingSetLogoParams {
    orgId: string;
    fileBase64: string;
    contentType: string;
    theme: 'light' | 'dark';
}
export const BRANDING_SET_LOGO_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'fileBase64', 'contentType', 'theme'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        fileBase64: {type: 'string', minLength: 1, maxLength: 1_500_000},
        contentType: {
            type: 'string',
            enum: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']
        },
        theme: THEME
    }
};

export interface BrandingDeleteLogoParams {
    orgId: string;
    theme: 'light' | 'dark';
}
export const BRANDING_DELETE_LOGO_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'theme'],
    additionalProperties: false,
    properties: {orgId: ORG_ID, theme: THEME}
};

export interface BrandingSetIconParams {
    orgId: string;
    fileBase64: string;
    contentType: string;
    theme: 'light' | 'dark';
}
export const BRANDING_SET_ICON_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'fileBase64', 'contentType', 'theme'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        fileBase64: {type: 'string', minLength: 1, maxLength: 1_500_000},
        contentType: {
            type: 'string',
            enum: ['image/png', 'image/svg+xml', 'image/x-icon', 'image/webp']
        },
        theme: THEME
    }
};

export interface BrandingSetFontParams {
    orgId: string;
    fileBase64: string;
    contentType: string;
}
export const BRANDING_SET_FONT_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'fileBase64', 'contentType'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        fileBase64: {type: 'string', minLength: 1, maxLength: 5_000_000},
        contentType: FONT_CONTENT_TYPES
    }
};

export interface BrandingScopeOnly {
    orgId: string;
}

export interface BrandingSetMailTemplateParams {
    orgId: string;
    html: string;
}
export const BRANDING_SET_MAIL_TEMPLATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['orgId', 'html'],
    additionalProperties: false,
    properties: {
        orgId: ORG_ID,
        // 1 MB ceiling — Zitadel base64s server-side; ample for any
        // hand-written transactional template.
        html: {type: 'string', minLength: 1, maxLength: 1_000_000}
    }
};

const b = new DescribeBuilder('branding', {
    kind: 'fleet-manager',
    description:
        'Manage per-organization login branding policy, theme colors, logo, and icon.'
});

const PERM = {note: 'admin-only — proxies Zitadel label policy'};

b.registerMethod('GetPolicy', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: RESP_POLICY,
    permission: PERM,
    description: 'Branding.GetPolicy — current (live) label policy.'
});
b.registerMethod('GetPreview', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: RESP_POLICY,
    permission: PERM,
    description: 'Branding.GetPreview — unsaved draft policy (before activate).'
});
b.registerMethod('GetDefault', {
    params: BRANDING_GET_DEFAULT_PARAMS_SCHEMA,
    response: RESP_POLICY,
    permission: PERM,
    description: 'Branding.GetDefault — Zitadel factory-default policy.'
});
b.registerMethod('SetPolicy', {
    params: BRANDING_SET_POLICY_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Branding.SetPolicy — write the draft label policy. Activate to publish.'
});
b.registerMethod('Activate', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Branding.Activate — promote the draft policy to live on the login page.'
});
b.registerMethod('Reset', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Branding.Reset — drop the org override; instance default applies.'
});
b.registerMethod('SetLogo', {
    params: BRANDING_SET_LOGO_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Branding.SetLogo — base64 PNG/SVG/JPEG/WebP, light or dark.'
});
b.registerMethod('DeleteLogo', {
    params: BRANDING_DELETE_LOGO_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Branding.DeleteLogo — drop the uploaded logo.'
});
b.registerMethod('SetIcon', {
    params: BRANDING_SET_ICON_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Branding.SetIcon — favicon-class image, light or dark.'
});
b.registerMethod('DeleteIcon', {
    params: BRANDING_DELETE_LOGO_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Branding.DeleteIcon — drop the uploaded icon.'
});
b.registerMethod('SetFont', {
    params: BRANDING_SET_FONT_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Branding.SetFont — base64 TTF font for login screens.'
});
b.registerMethod('DeleteFont', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description: 'Branding.DeleteFont — drop the uploaded custom font.'
});
b.registerMethod('GetMailTemplate', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: {type: 'object', additionalProperties: true},
    permission: PERM,
    description:
        'Branding.GetMailTemplate — custom HTML scaffold Zitadel renders ' +
        'every transactional email into. Returns {template, isDefault}.'
});
b.registerMethod('SetMailTemplate', {
    params: BRANDING_SET_MAIL_TEMPLATE_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Branding.SetMailTemplate — replace the org email HTML scaffold. ' +
        'Use Go-template placeholders (e.g. {{.Title}}, {{.URL}}).'
});
b.registerMethod('ResetMailTemplate', {
    params: BRANDING_GET_POLICY_PARAMS_SCHEMA,
    response: RESP_OK,
    permission: PERM,
    description:
        'Branding.ResetMailTemplate — drop the org override; Zitadel ' +
        'default template applies again.'
});

export const BRANDING_DESCRIBE: DescribeOutput = b.build();
