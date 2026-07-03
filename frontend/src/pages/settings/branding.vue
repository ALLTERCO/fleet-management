<template>
    <PageTemplate title="Branding & Policies" :tabs="tabs" fill>
        <div class="br-layout">
            <h2 class="sr-only">Branding & Policies</h2>

            <p class="br-hint">
                Per-organization Zitadel policy editor. Changes take effect
                after Activate (for branding) or immediately (for other
                policies).
            </p>

            <BrandingPolicySection
                v-model:org-id="orgId"
                :branding="branding"
                :busy="busy"
                @load="loadAll"
                @save="saveBranding"
                @activate="activateBranding"
                @reset="resetBranding"
            />

            <BrandingAssetsSection
                v-model:raw="previewRaw"
                v-model:theme="previewTheme"
                v-model:logo-broken="logoBroken"
                v-model:icon-broken="iconBroken"
                :org-id="orgId"
                :busy="busy"
                :preview="preview"
                :preview-json="previewJson"
                :preview-style="previewStyle"
                :preview-logo-url="previewLogoUrl"
                :preview-icon-url="previewIconUrl"
                :login-name-sample="previewLoginNameSample"
                :watermark-hidden="previewWatermarkHidden"
                :live-login-url="liveLoginUrl"
                @upload-asset="onAssetUpload"
                @delete-asset="onAssetDelete"
                @upload-font="uploadFont"
                @delete-font="deleteFont"
                @load-preview="loadPreview"
            />


            <BrandingPrivacySection
                :privacy="privacy"
                :busy="busy"
                @save="savePrivacy"
                @reset="resetPrivacy"
            />

            <BrandingRestrictionsSection
                v-if="canAccessPlatformAdmin"
                v-model:languages="restrictionsLanguages"
                :restrictions="restrictions"
                :busy="busy"
                @save="saveRestrictions"
            />

            <BrandingDomainSection
                :policy="domainPolicy"
                :busy="busy"
                @save="saveDomainPolicy"
                @reset="resetDomainPolicy"
            />

            <BrandingNotificationSection
                :policy="notificationPolicy"
                :busy="busy"
                @save="saveNotificationPolicy"
                @reset="resetNotificationPolicy"
            />

            <BrandingLoginTextSection
                v-model:language="loginTextLanguage"
                v-model:raw="loginTextRaw"
                :loaded="loginText !== null"
                :busy="busy"
                @load="loadLoginText"
                @save="saveLoginText"
                @reset="resetLoginText"
            />

            <BrandingMessageTextSection
                v-model:type="messageTextType"
                v-model:language="messageTextLanguage"
                v-model:draft="messageTextDraft"
                :fields="messageTextFields"
                :loaded="messageText !== null"
                :busy="busy"
                @load="loadMessageText"
                @save="saveMessageText"
                @reset="resetMessageText"
            />

            <BrandingMailTemplateSection
                v-model:template="mailTemplate"
                :is-default="mailTemplateIsDefault"
                :empty="mailTemplateEmpty"
                :busy="busy"
                @load="loadMailTemplate"
                @save="saveMailTemplate"
                @reset="resetMailTemplate"
            />

            <p v-if="error" class="br-error">
                <i class="fas fa-exclamation-triangle" /> {{ error }}
            </p>
            <p v-if="status" class="br-ok">
                <i class="fas fa-check-circle" /> {{ status }}
            </p>
        </div>
    </PageTemplate>
</template>

<script setup lang="ts">
import {storeToRefs} from 'pinia';
import {
    type ComputedRef,
    computed,
    inject,
    onBeforeUnmount,
    onMounted,
    ref,
    watch
} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import RichTextEditor from '@/components/core/RichTextEditor.vue';
import {relativeLuminance} from '@/helpers/colorContrast';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {ZITADEL_EMAIL_TOKENS} from '@/helpers/zitadelEmailTokens';
import {
    brandingSetPayload as buildBrandingSetPayload,
    isMailTemplateEmpty,
    messageTextFieldsFor
} from '@/helpers/zitadelMessageText';
import {useAuthStore} from '@/stores/auth';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';
import BrandingAssetsSection from './BrandingAssetsSection.vue';
import BrandingDomainSection from './BrandingDomainSection.vue';
import BrandingLoginTextSection from './BrandingLoginTextSection.vue';
import BrandingMailTemplateSection from './BrandingMailTemplateSection.vue';
import BrandingMessageTextSection from './BrandingMessageTextSection.vue';
import BrandingNotificationSection from './BrandingNotificationSection.vue';
import BrandingPolicySection from './BrandingPolicySection.vue';
import BrandingPrivacySection from './BrandingPrivacySection.vue';
import BrandingRestrictionsSection from './BrandingRestrictionsSection.vue';

interface BrandingPolicy {
    primaryColor?: string;
    warnColor?: string;
    backgroundColor?: string;
    fontColor?: string;
    hideLoginNameSuffix?: boolean;
    disableWatermark?: boolean;
}

interface PrivacyPolicy {
    tosLink?: string;
    privacyLink?: string;
    helpLink?: string;
    supportEmail?: string;
}

interface RestrictionsPolicy {
    disallowPublicOrgRegistration?: boolean;
    allowedLanguages?: string[];
}

interface DomainPolicy {
    userLoginMustBeDomain?: boolean;
    validateOrgDomains?: boolean;
    smtpSenderAddressMatchesInstanceDomain?: boolean;
}

interface NotificationPolicy {
    passwordChange?: boolean;
}

const tabs = inject<ComputedRef<RouteTab[]>>(
    'settingsTabs',
    computed(() => [])
);

const orgId = ref('');
const branding = ref<BrandingPolicy | null>(null);
const privacy = ref<PrivacyPolicy | null>(null);
const restrictions = ref<RestrictionsPolicy | null>(null);
const restrictionsLanguages = ref('');
const domainPolicy = ref<DomainPolicy | null>(null);
const notificationPolicy = ref<NotificationPolicy | null>(null);

const loginTextLanguage = ref('en');
const loginText = ref<Record<string, unknown> | null>(null);
const loginTextRaw = ref('');

const messageTextType = ref('passwordreset');
const messageTextLanguage = ref('en');
const messageText = ref<Record<string, unknown> | null>(null);
const messageTextDraft = ref<Record<string, string>>({});

// Zitadel message_text fields per type. Source of truth in helper.
const messageTextFields = computed(() =>
    messageTextFieldsFor(messageTextType.value)
);

// Custom HTML email template — wholesale Zitadel scaffold override.
const mailTemplate = ref<string | null>(null);
const mailTemplateIsDefault = ref(true);

const mailTemplateEmpty = computed(() => isMailTemplateEmpty(mailTemplate.value));

const busy = ref(false);
const error = ref<string | null>(null);
const status = ref<string | null>(null);

let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flash(msg: string): void {
    status.value = msg;
    error.value = null;
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
        flashTimer = undefined;
        if (status.value === msg) status.value = null;
    }, 3000);
}

onBeforeUnmount(() => {
    if (flashTimer !== undefined) clearTimeout(flashTimer);
});

function fail(err: unknown): void {
    error.value = err instanceof Error ? err.message : String(err);
    status.value = null;
}

const authStore = useAuthStore();
const {canAccessPlatformAdmin} = storeToRefs(authStore);
const rpc = useRpcPermissions();
const canManageBranding = computed(() => rpc.canCall('Branding.SetPolicy'));

async function loadAll(): Promise<void> {
    if (!canManageBranding.value) {
        fail('Branding requires admin role.');
        return;
    }
    if (!orgId.value) {
        fail('Org ID is required');
        return;
    }
    busy.value = true;
    error.value = null;
    try {
        const [b, p, dp, np] = await Promise.all([
            sendRPC<BrandingPolicy>('FLEET_MANAGER', 'Branding.GetPolicy', {
                orgId: orgId.value
            }),
            sendRPC<PrivacyPolicy>('FLEET_MANAGER', 'Privacy.GetPolicy', {
                orgId: orgId.value
            }),
            sendRPC<DomainPolicy>('FLEET_MANAGER', 'domain_policy.GetPolicy', {
                orgId: orgId.value
            }),
            sendRPC<NotificationPolicy>(
                'FLEET_MANAGER',
                'notification_policy.GetPolicy',
                {orgId: orgId.value}
            )
        ]);
        branding.value = b ?? {};
        privacy.value = p ?? {};
        if (canAccessPlatformAdmin.value) {
            const r = await sendRPC<RestrictionsPolicy>(
                'FLEET_MANAGER',
                'Restrictions.Get',
                {}
            );
            restrictions.value = r ?? {};
            restrictionsLanguages.value = (r?.allowedLanguages ?? []).join(
                ', '
            );
        }
        domainPolicy.value = dp ?? {};
        notificationPolicy.value = np ?? {};
        flash('Loaded.');
    } catch (err) {
        fail(err);
    } finally {
        busy.value = false;
    }
}

async function withBusy(
    action: () => Promise<unknown>,
    ok: string
): Promise<void> {
    // Every wrapped action calls an admin-only RPC; refuse early so a
    // stale ref / devtools click can't toast a 403 from the backend.
    if (!canManageBranding.value) {
        fail('Admin role required.');
        return;
    }
    busy.value = true;
    error.value = null;
    try {
        await action();
        flash(ok);
    } catch (err) {
        fail(err);
    } finally {
        busy.value = false;
    }
}

const saveBranding = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC(
                'FLEET_MANAGER',
                'Branding.SetPolicy',
                buildBrandingSetPayload(
                    (branding.value ?? {}) as Record<string, unknown>,
                    orgId.value
                )
            ),
        'Branding policy saved.'
    );

// ── Asset uploads (logo / icon / font) ──
// Reads the picked file as base64 (strip the data: prefix Zitadel rejects),
// posts the matching SetLogo/SetIcon/SetFont RPC, clears the input.
const previewJson = ref('');
const preview = ref<Record<string, string | boolean | undefined> | null>(null);
const previewRaw = ref(false);
const previewTheme = ref<'light' | 'dark'>('light');
// Per-asset broken-image flags so a 404'd policy URL falls back to the
// placeholder instead of rendering the browser's broken-image glyph.
const logoBroken = ref(false);
const iconBroken = ref(false);

function pickStr(key: string): string {
    const v = preview.value?.[key];
    return typeof v === 'string' ? v : '';
}

function pickBool(key: string): boolean {
    return preview.value?.[key] === true;
}

// Light/dark variants — Zitadel returns parallel sets (primaryColor +
// primaryColorDark, logoUrl + logoUrlDark, etc.). Variant fields fall
// back to the non-suffixed version when the dark theme leaves them unset.
function variant(base: string): string {
    if (previewTheme.value === 'dark') {
        return pickStr(`${base}Dark`) || pickStr(base);
    }
    return pickStr(base);
}

const previewLogoUrl = computed(() => variant('logoUrl'));
const previewIconUrl = computed(() => variant('iconUrl'));

// When the policy reloads or theme flips, clear any prior 404 flag so
// the new asset gets a fresh chance to render.
watch([previewTheme, previewLogoUrl], () => {
    logoBroken.value = false;
});
watch([previewTheme, previewIconUrl], () => {
    iconBroken.value = false;
});


// Derive a CSS font-family name from the fontUrl. The named font won't
// load without @font-face anyway, so the value is mostly cosmetic — but
// we still must reject anything that could escape the quoted string and
// break the surrounding CSS (data: URIs, paths with `;` / `,` / `"`).
const FONT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
function fontFamilyFromUrl(url: string): string {
    if (!url) return 'system-ui, sans-serif';
    const path = url.split(/[?#]/)[0];
    const file = path.split('/').pop() ?? '';
    const raw = file.split('.')[0] ?? '';
    return FONT_NAME_RE.test(raw)
        ? `"${raw}", system-ui, sans-serif`
        : 'system-ui, sans-serif';
}

// Zitadel-branding preview fallbacks. Hex literals are JS defaults that
// drive runtime --brand-* CSS vars; not chrome subject to token discipline.
const previewStyle = computed(() => {
    if (!preview.value) return {};
    const isDark = previewTheme.value === 'dark';
    const primary = variant('primaryColor') || '#5b8def';
    return {
        '--brand-primary': primary,
        '--brand-on-primary':
            relativeLuminance(primary) > 0.5 ? '#0f172a' : '#ffffff',
        '--brand-background':
            variant('backgroundColor') || (isDark ? '#0f172a' : '#ffffff'),
        '--brand-warn': variant('warnColor') || '#ef4444',
        '--brand-font':
            variant('fontColor') || (isDark ? '#eaf4ff' : '#0f172a'),
        '--brand-font-family': fontFamilyFromUrl(pickStr('fontUrl'))
    } as Record<string, string>;
});

// hideLoginNameSuffix true → no @org-domain shown after the username.
// Mock the username with or without the suffix so admins see the result.
const previewLoginNameSample = computed(() =>
    pickBool('hideLoginNameSuffix')
        ? 'alice'
        : `alice@${orgId.value || 'example'}.shelly`
);

// disableWatermark true → suppress the "Powered by Zitadel" footer.
const previewWatermarkHidden = computed(() => pickBool('disableWatermark'));

// Out-of-band live verification: open Zitadel's actual login URL so
// admin can confirm the policy after they hit Activate. Path is the
// Login V2 entry (the default for Zitadel v4+); pre-v4 instances would
// need /ui/login/loginname instead — flag if the deploy line ever
// drifts back. The org param scopes to the previewed tenant.
const liveLoginUrl = computed(() => {
    const issuer = window.__FM_RUNTIME_CONFIG__?.oidc?.authority;
    if (!issuer || !orgId.value) return '';
    const base = issuer.replace(/\/$/, '');
    return `${base}/ui/v2/login/loginname?organization=${encodeURIComponent(orgId.value)}`;
});

function fileToBase64(file: File): Promise<{base64: string; type: string}> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const out = String(r.result ?? '');
            const idx = out.indexOf(',');
            resolve({
                base64: idx >= 0 ? out.slice(idx + 1) : out,
                type: file.type
            });
        };
        r.onerror = () => reject(r.error ?? new Error('read failed'));
        r.readAsDataURL(file);
    });
}

// BrandingAssetsSection emits {kind, theme, event} bundles — keep the
// positional uploadAsset/deleteAsset signatures and add thin adapters
// the template binds.
function onAssetUpload(args: {
    kind: 'logo' | 'icon';
    theme: 'light' | 'dark';
    event: Event;
}): Promise<void> {
    return uploadAsset(args.kind, args.theme, args.event);
}

function onAssetDelete(args: {
    kind: 'logo' | 'icon';
    theme: 'light' | 'dark';
}): Promise<void> {
    return deleteAsset(args.kind, args.theme);
}

async function uploadAsset(
    kind: 'logo' | 'icon',
    theme: 'light' | 'dark',
    e: Event
): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const {base64, type} = await fileToBase64(file);
    const method = kind === 'logo' ? 'Branding.SetLogo' : 'Branding.SetIcon';
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', method, {
                orgId: orgId.value,
                fileBase64: base64,
                contentType: type,
                theme
            }),
        `${kind} (${theme}) uploaded.`
    );
}

function deleteAsset(
    kind: 'logo' | 'icon',
    theme: 'light' | 'dark'
): Promise<void> {
    const method =
        kind === 'logo' ? 'Branding.DeleteLogo' : 'Branding.DeleteIcon';
    return withBusy(
        () =>
            sendRPC('FLEET_MANAGER', method, {
                orgId: orgId.value,
                theme
            }),
        `${kind} (${theme}) removed.`
    );
}

async function uploadFont(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const {base64, type} = await fileToBase64(file);
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Branding.SetFont', {
                orgId: orgId.value,
                fileBase64: base64,
                contentType: type
            }),
        'Font uploaded.'
    );
}

function deleteFont(): Promise<void> {
    return withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Branding.DeleteFont', {
                orgId: orgId.value
            }),
        'Font removed.'
    );
}

async function loadPreview(): Promise<void> {
    await withBusy(async () => {
        const res = await sendRPC<Record<string, string | boolean>>(
            'FLEET_MANAGER',
            'Branding.GetPreview',
            {orgId: orgId.value}
        );
        preview.value = (res ?? {}) as Record<
            string,
            string | boolean | undefined
        >;
        previewJson.value = JSON.stringify(res, null, 2);
        // Refresh — give a re-uploaded asset another chance to load
        // even if its URL string is identical to the previous one.
        logoBroken.value = false;
        iconBroken.value = false;
        // Honor the policy's declared theme mode on first load; later
        // toggles by the admin override this. THEME_MODE_AUTO defers to
        // the OS preference (matches what Zitadel does at render time).
        const mode = preview.value?.themeMode;
        if (mode === 'THEME_MODE_DARK') {
            previewTheme.value = 'dark';
        } else if (mode === 'THEME_MODE_LIGHT') {
            previewTheme.value = 'light';
        } else if (mode === 'THEME_MODE_AUTO') {
            previewTheme.value = window.matchMedia?.(
                '(prefers-color-scheme: dark)'
            ).matches
                ? 'dark'
                : 'light';
        }
    }, 'Preview loaded.');
}

const activateBranding = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Branding.Activate', {
                orgId: orgId.value
            }),
        'Branding activated.'
    );

const resetBranding = (): Promise<void> =>
    withBusy(
        () => sendRPC('FLEET_MANAGER', 'Branding.Reset', {orgId: orgId.value}),
        'Branding reset.'
    );

function privacySetPayload(): Record<string, unknown> {
    const p = (privacy.value ?? {}) as Record<string, unknown>;
    const allowed = [
        'tosLink',
        'privacyLink',
        'helpLink',
        'supportEmail',
        'docsLink',
        'customLink',
        'customLinkText'
    ] as const;
    const out: Record<string, unknown> = {orgId: orgId.value};
    for (const k of allowed) {
        if (p[k] !== undefined) out[k] = p[k];
    }
    return out;
}

const savePrivacy = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Privacy.SetPolicy', privacySetPayload()),
        'Privacy policy saved.'
    );

const resetPrivacy = (): Promise<void> =>
    withBusy(
        () => sendRPC('FLEET_MANAGER', 'Privacy.Reset', {orgId: orgId.value}),
        'Privacy reset.'
    );

async function saveRestrictions(): Promise<void> {
    if (!canAccessPlatformAdmin.value) return;
    if (!restrictions.value) return;
    const langs = restrictionsLanguages.value
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Restrictions.Set', {
                disallowPublicOrgRegistration:
                    restrictions.value?.disallowPublicOrgRegistration,
                allowedLanguages: langs.length ? langs : undefined
            }),
        'Restrictions saved.'
    );
}

function domainPolicySetPayload(): Record<string, unknown> {
    const d = (domainPolicy.value ?? {}) as Record<string, unknown>;
    const allowed = [
        'userLoginMustBeDomain',
        'validateOrgDomains',
        'smtpSenderAddressMatchesInstanceDomain'
    ] as const;
    const out: Record<string, unknown> = {orgId: orgId.value};
    for (const k of allowed) {
        if (d[k] !== undefined) out[k] = d[k];
    }
    return out;
}

const saveDomainPolicy = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC(
                'FLEET_MANAGER',
                'domain_policy.SetPolicy',
                domainPolicySetPayload()
            ),
        'Domain policy saved.'
    );

const resetDomainPolicy = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'domain_policy.Reset', {
                orgId: orgId.value
            }),
        'Domain policy reset.'
    );

function notificationPolicySetPayload(): Record<string, unknown> {
    const n = (notificationPolicy.value ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {orgId: orgId.value};
    if (n.passwordChange !== undefined) out.passwordChange = n.passwordChange;
    return out;
}

const saveNotificationPolicy = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC(
                'FLEET_MANAGER',
                'notification_policy.SetPolicy',
                notificationPolicySetPayload()
            ),
        'Notification policy saved.'
    );

const resetNotificationPolicy = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'notification_policy.Reset', {
                orgId: orgId.value
            }),
        'Notification policy reset.'
    );

async function loadLoginText(): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
        const t = await sendRPC<Record<string, unknown>>(
            'FLEET_MANAGER',
            'login_text.GetText',
            {orgId: orgId.value, language: loginTextLanguage.value}
        );
        loginText.value = t ?? {};
        loginTextRaw.value = JSON.stringify(t ?? {}, null, 2);
        flash('Login text loaded.');
    } catch (err) {
        fail(err);
    } finally {
        busy.value = false;
    }
}

async function saveLoginText(): Promise<void> {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(loginTextRaw.value || '{}');
    } catch (err) {
        fail(`Invalid JSON: ${err}`);
        return;
    }
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'login_text.SetText', {
                orgId: orgId.value,
                language: loginTextLanguage.value,
                text: parsed
            }),
        'Login text saved.'
    );
}

const resetLoginText = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'login_text.Reset', {
                orgId: orgId.value,
                language: loginTextLanguage.value
            }),
        'Login text reset.'
    );

async function loadMessageText(): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
        const t = await sendRPC<Record<string, unknown>>(
            'FLEET_MANAGER',
            'message_text.GetText',
            {
                orgId: orgId.value,
                type: messageTextType.value,
                language: messageTextLanguage.value
            }
        );
        messageText.value = t ?? {};
        // Hydrate the per-field draft. Unknown keys round-trip via
        // messageText so we don't drop anything Zitadel sent us.
        const draft: Record<string, string> = {};
        for (const f of messageTextFields.value) {
            const v = (t as Record<string, unknown> | undefined)?.[f.key];
            draft[f.key] = typeof v === 'string' ? v : '';
        }
        messageTextDraft.value = draft;
        flash('Message text loaded.');
    } catch (err) {
        fail(err);
    } finally {
        busy.value = false;
    }
}

async function saveMessageText(): Promise<void> {
    // Build payload from the structured draft. Empty strings are
    // dropped so Zitadel falls back to its default for that field.
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(messageTextDraft.value)) {
        if (typeof v === 'string' && v.trim() !== '') payload[k] = v;
    }
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'message_text.SetText', {
                ...payload,
                orgId: orgId.value,
                type: messageTextType.value,
                language: messageTextLanguage.value
            }),
        'Message text saved.'
    );
}

const resetMessageText = (): Promise<void> =>
    withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'message_text.Reset', {
                orgId: orgId.value,
                type: messageTextType.value,
                language: messageTextLanguage.value
            }),
        'Message text reset.'
    );

async function loadMailTemplate(): Promise<void> {
    busy.value = true;
    error.value = null;
    try {
        const t = await sendRPC<{template: string; isDefault: boolean}>(
            'FLEET_MANAGER',
            'Branding.GetMailTemplate',
            {orgId: orgId.value}
        );
        mailTemplate.value = t?.template ?? '';
        mailTemplateIsDefault.value = t?.isDefault ?? true;
        flash('Email template loaded.');
    } catch (err) {
        fail(err);
    } finally {
        busy.value = false;
    }
}

async function saveMailTemplate(): Promise<void> {
    if (mailTemplateEmpty.value) return;
    if (!canManageBranding.value) return;
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Branding.SetMailTemplate', {
                orgId: orgId.value,
                html: mailTemplate.value
            }),
        'Email template saved.'
    );
    mailTemplateIsDefault.value = false;
}

async function resetMailTemplate(): Promise<void> {
    await withBusy(
        () =>
            sendRPC('FLEET_MANAGER', 'Branding.ResetMailTemplate', {
                orgId: orgId.value
            }),
        'Email template reset to default.'
    );
    mailTemplate.value = '';
    mailTemplateIsDefault.value = true;
}

onMounted(() => {
    if (!canAccessPlatformAdmin.value) return;
    // Restrictions is instance-scoped; provider support only.
    void (async () => {
        try {
            const r = await sendRPC<RestrictionsPolicy>(
                'FLEET_MANAGER',
                'Restrictions.Get',
                {}
            );
            restrictions.value = r ?? {};
            restrictionsLanguages.value = (r?.allowedLanguages ?? []).join(
                ', '
            );
        } catch {
            // Restrictions optional; ignore.
        }
    })();
});
</script>

<style scoped>
.br-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 1080px;
    width: 100%;
    margin: 0 auto;
}
.br-assets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--space-4);
}
.br-asset {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
}
.br-asset__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.br-asset__themes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
}
.br-asset__theme {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}
.br-asset__label {
    text-transform: uppercase;
    font-size: var(--type-caption);
    letter-spacing: 0.04em;
    color: var(--color-text-tertiary);
}
.br-preview {
    margin: 0;
    padding: var(--space-2);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
    max-height: 280px;
    overflow: auto;
}

/* ── Preview theme tabs ────────────────────────────────────────────── */
.br-preview-themes {
    display: inline-flex;
    gap: var(--space-0-5);
    padding: var(--space-0-5);
    background: var(--color-surface-2);
    border-radius: var(--radius-md);
    margin-left: auto;
}
.br-preview-themes__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: transparent;
    border: none;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--motion-hover), color var(--motion-hover);
}
.br-preview-themes__btn--active {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
}

/* ── Preview stage — frames the mock with a brand-tinted radial glow,
 *    mirroring the real login.vue's atmosphere. The stage owns the
 *    background; the inner card is the actual login card. ──────────── */
.br-preview-stage {
    position: relative;
    margin-top: var(--space-3);
    padding: var(--space-6) var(--space-5) var(--space-5);
    border-radius: var(--radius-lg);
    overflow: hidden;
    isolation: isolate;
    background: var(--brand-background);
    color: var(--brand-font);
    font-family: var(--brand-font-family);
    border: 1px solid color-mix(in srgb, var(--brand-font) 10%, transparent);
    transition: background 250ms ease, color 250ms ease;
}
.br-preview-stage__glow {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background: radial-gradient(
        ellipse 60% 50% at 50% 30%,
        color-mix(in oklch, var(--brand-primary) 28%, transparent) 0%,
        color-mix(in oklch, var(--brand-primary) 14%, transparent) 30%,
        color-mix(in oklch, var(--brand-primary) 5%, transparent) 55%,
        transparent 75%
    );
    filter: blur(1.5px);
}

/* ── Browser chrome — refined, not "3 dots in a box" ──────────────── */
.br-preview-chrome {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    /* Negate the stage's own padding so the chrome strip runs full-bleed
       to the stage edges (stage padding is --space-6 top, --space-5
       sides). Bottom margin pushes the card down so it doesn't collide
       with the chrome. */
    margin: calc(var(--space-6) * -1) calc(var(--space-5) * -1) var(--space-5);
    background: color-mix(in srgb, var(--brand-background) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--brand-font) 8%, transparent);
}
.br-preview-chrome__dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    flex-shrink: 0;
}
/* macOS window-controls fidelity — same exception class as PreviewChrome_*. */
.br-preview-chrome__dot--r { background: #ff5f56; }
.br-preview-chrome__dot--y { background: #ffbd2e; }
.br-preview-chrome__dot--g { background: #27c93f; }
.br-preview-chrome__url {
    margin: 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-3);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--brand-font) 8%, transparent);
    color: color-mix(in srgb, var(--brand-font) 70%, transparent);
    font-size: var(--type-caption);
}
.br-preview-chrome__url > i { font-size: var(--icon-size-2xs); opacity: 0.7; }
.br-preview-chrome__favicon {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-xs);
    object-fit: contain;
}

/* ── Login card — the body of the preview ─────────────────────────── */
.br-preview-mock {
    position: relative;
    z-index: 1;
    max-width: 360px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.br-preview-mock__hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
}
.br-preview-mock__logo {
    max-height: 52px;
    max-width: 200px;
    object-fit: contain;
    /* Soft brand-tinted halo behind the logo so it feels intentional. */
    filter: drop-shadow(
        0 0 18px color-mix(in srgb, var(--brand-primary) 22%, transparent)
    );
}
.br-preview-mock__logo-placeholder {
    width: 84px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    border: 1px dashed color-mix(in srgb, var(--brand-font) 28%, transparent);
    color: color-mix(in srgb, var(--brand-font) 55%, transparent);
    font-size: var(--type-body);
    letter-spacing: 0.18em;
}
.br-preview-mock__title {
    margin: 0;
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    letter-spacing: -0.025em;
    line-height: 1.1;
    text-align: center;
    /* Gradient title — perceptually-smooth white → soft-white falloff,
       matches the login.vue hero treatment. */
    background: linear-gradient(
        in oklch 180deg,
        var(--brand-font) 0%,
        color-mix(in oklch, var(--brand-font) 86%, transparent) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.br-preview-mock__sub {
    margin: 0;
    font-size: var(--type-caption);
    line-height: 1.5;
    text-align: center;
    color: color-mix(in srgb, var(--brand-font) 60%, transparent);
}
.br-preview-mock__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
/* Field is a static <label> wrapping spans (no real input), so no
   hover state — pretending it's interactive would mislead admins. */
.br-preview-mock__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--brand-font) 18%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--brand-font) 4%, transparent);
}
.br-preview-mock__field-label {
    font-size: var(--icon-size-2xs);
    font-weight: var(--font-medium);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--brand-font) 55%, transparent);
}
.br-preview-mock__field-value {
    font-size: var(--type-body);
    color: var(--brand-font);
}
.br-preview-mock__field-value--dots {
    letter-spacing: 0.18em;
    color: color-mix(in srgb, var(--brand-font) 80%, transparent);
}
/* CTA — primary-colored with the brand-glow halo the real login uses. */
.br-preview-mock__cta {
    margin-top: var(--space-1);
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: linear-gradient(
        in oklch 180deg,
        color-mix(in oklch, var(--brand-primary) 100%, transparent) 0%,
        color-mix(in oklch, var(--brand-primary) 86%, #000) 100%
    );
    /* CTA label color is contrast-aware: luminance of the primary
       picks black or white so we don't fail WCAG AA on light/yellow
       primaries. Computed in previewStyle. */
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    letter-spacing: -0.005em;
    box-shadow:
        0 1px 0 color-mix(in srgb, #fff 16%, transparent) inset,
        0 0 0 1px color-mix(in srgb, #000 18%, transparent) inset,
        0 0 18px -3px color-mix(in srgb, var(--brand-primary) 55%, transparent),
        0 0 40px -8px color-mix(in srgb, var(--brand-primary) 38%, transparent),
        0 0 80px -18px color-mix(in srgb, var(--brand-primary) 28%, transparent);
}
.br-preview-mock__warn {
    margin: var(--space-1) 0 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--brand-warn) 12%, transparent);
    color: var(--brand-warn);
    font-size: var(--type-caption);
}
.br-preview-mock__watermark {
    margin: var(--space-4) 0 0;
    text-align: center;
    color: color-mix(in srgb, var(--brand-font) 38%, transparent);
    font-size: var(--icon-size-2xs);
    letter-spacing: 0.06em;
}
.br-btn--ghost {
    background: transparent;
    border: 1px solid var(--color-border-default);
}

.br-hint {
    margin: 0 0 var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    line-height: var(--leading-relaxed);
    max-width: 65ch;
}

.br-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
    align-items: end;
    padding: var(--space-1) 0;
}

.br-form label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    letter-spacing: 0.02em;
    min-width: 0;
}

.br-form input[type='text'],
.br-form input[type='url'],
.br-form input[type='email'],
.br-form select {
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    min-width: 0;
    width: 100%;
}

.br-form input[type='text']:focus,
.br-form input[type='url']:focus,
.br-form input[type='email']:focus,
.br-form select:focus {
    border-color: var(--color-primary);
    outline: none;
    box-shadow: 0 0 0 3px rgba(var(--color-primary-rgb), 0.2);
}

/* Native color input — give it a swatch-tile shape that matches the rest. */
.br-form input[type='color'] {
    appearance: none;
    width: 100%;
    height: 36px;
    padding: 2px;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    cursor: pointer;
}

.br-form input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
}

.br-form input[type='color']::-webkit-color-swatch {
    border: none;
    border-radius: calc(var(--radius-md) - 4px);
}

.br-form-checkbox {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
}

.br-form-checkbox input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: var(--color-primary);
}

.br-textarea {
    width: 100%;
    padding: var(--space-2);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    margin-top: var(--space-2);
}

.br-template {
    font-size: var(--type-body);
    min-height: 360px;
}

.br-msg-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
}
.br-msg-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.br-msg-label {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.br-msg-input {
    padding: var(--space-1-5) var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    min-height: var(--touch-target-min);
}
.br-msg-hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
}
.br-msg-foot-hint {
    margin: var(--space-3) 0 0;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}

.br-actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-default);
    width: 100%;
    flex-wrap: wrap;
}

/* Reusable button shape — matches the design-system Button atom visually
   so every action on this page reads as a button at a glance. */
.br-btn {
    height: var(--btn-h-md);
    padding: 0 var(--space-4);
    background: var(--color-primary);
    color: var(--color-text-on-primary);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    letter-spacing: 0.01em;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast),
        color var(--duration-fast),
        filter var(--duration-fast),
        transform var(--duration-fast);
}

.br-btn:hover:not(:disabled) {
    filter: brightness(1.1);
}

.br-btn:active:not(:disabled) {
    transform: translateY(1px);
}

.br-btn:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
}

.br-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    box-shadow: none;
}

.br-btn--danger {
    background: var(--color-status-off);
    border-color: var(--color-status-off);
    color: var(--color-text-on-danger);
}

.br-btn--ghost {
    background: transparent;
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
}

.br-btn--ghost:hover:not(:disabled) {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
    filter: none;
}

.br-error {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(var(--color-status-off-rgb), 0.08);
    border: 1px solid rgba(var(--color-status-off-rgb), 0.3);
    color: var(--color-status-off);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.br-ok {
    margin: 0;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(var(--color-status-on-rgb), 0.08);
    border: 1px solid rgba(var(--color-status-on-rgb), 0.3);
    color: var(--color-status-on);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
</style>
