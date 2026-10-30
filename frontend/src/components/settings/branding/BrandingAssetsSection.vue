<template>
    <BasicBlock darker title="Branding assets">
        <div class="br-assets">
            <div
                v-for="kind in ASSET_KINDS"
                :key="kind"
                class="br-asset"
            >
                <h4 class="br-asset__title">
                    {{ kind === 'logo' ? 'Logo' : 'Icon' }}
                </h4>
                <div class="br-asset__themes">
                    <div
                        v-for="theme in ASSET_THEMES"
                        :key="theme"
                        class="br-asset__theme"
                    >
                        <label class="br-asset__label">{{ theme }}</label>
                        <FileUploadField
                            accept="image/png,image/svg+xml,image/jpeg,image/webp"
                            :disabled="busy"
                            :upload-label="`Upload ${theme}`"
                            :delete-label="`Delete ${kind} ${theme}`"
                            @upload="(e) => $emit('upload-asset', {kind, theme, event: e})"
                            @delete="$emit('delete-asset', {kind, theme})"
                        />
                    </div>
                </div>
            </div>

            <div class="br-asset">
                <h4 class="br-asset__title">Font</h4>
                <FileUploadField
                    accept="font/woff2,font/woff,font/ttf,application/x-font-ttf,application/font-woff,application/font-woff2"
                    :disabled="busy"
                    upload-label="Upload font"
                    delete-label="Delete font"
                    @upload="(e) => $emit('upload-font', e)"
                    @delete="$emit('delete-font')"
                />
            </div>

            <div class="br-actions">
                <button
                    type="button"
                    class="br-btn"
                    :disabled="busy"
                    @click="$emit('load-preview')"
                >
                    {{ preview ? 'Refresh preview' : 'Show preview' }}
                </button>
                <button
                    v-if="preview"
                    type="button"
                    class="br-btn br-btn--ghost"
                    @click="rawModel = !rawModel"
                >
                    {{ rawModel ? 'Visual' : 'Raw JSON' }}
                </button>
                <!-- Theme toggle — most policies declare separate light/dark
                     color sets; let admin flip between. Uses aria-pressed
                     (toggle-button pattern) rather than role=tablist since
                     there's no tabpanel; the preview stage updates in place. -->
                <div
                    v-if="preview && !rawModel"
                    class="br-preview-themes"
                    role="group"
                    aria-label="Preview theme"
                >
                    <button
                        v-for="theme in ASSET_THEMES"
                        :key="theme"
                        type="button"
                        class="br-preview-themes__btn"
                        :class="{
                            'br-preview-themes__btn--active':
                                themeModel === theme
                        }"
                        :aria-pressed="themeModel === theme"
                        @click="themeModel = theme"
                    >
                        <i
                            class="fas"
                            :class="theme === 'light' ? 'fa-sun' : 'fa-moon'"
                        />
                        {{ theme === 'light' ? 'Light' : 'Dark' }}
                    </button>
                </div>
                <!-- Out-of-band link: admin verifies the LIVE policy
                     (post-Activate) by opening Zitadel's actual login URL
                     in a new tab. liveLoginUrl is empty when orgId is unset,
                     so the v-if covers both conditions. -->
                <a
                    v-if="preview && liveLoginUrl"
                    class="br-btn br-btn--ghost"
                    :href="liveLoginUrl"
                    target="_blank"
                    rel="noopener"
                >
                    <i class="fas fa-arrow-up-right-from-square" />
                    Open live login
                </a>
            </div>

            <!-- High-fidelity preview — mirrors the real login.vue aesthetic
                 (radial glow, gradient title, glowing CTA, refined fields)
                 using the draft policy. Theme variant flows through CSS
                 variables only — previewStyle injects the right colors. -->
            <div
                v-if="preview && !rawModel"
                class="br-preview-stage"
                :style="previewStyle"
            >
                <div class="br-preview-stage__glow" aria-hidden="true" />
                <div class="br-preview-chrome">
                    <span
                        class="br-preview-chrome__dot br-preview-chrome__dot--r"
                    />
                    <span
                        class="br-preview-chrome__dot br-preview-chrome__dot--y"
                    />
                    <span
                        class="br-preview-chrome__dot br-preview-chrome__dot--g"
                    />
                    <div class="br-preview-chrome__url">
                        <i class="fas fa-lock" />
                        <img
                            v-if="previewIconUrl && !iconBrokenModel"
                            class="br-preview-chrome__favicon"
                            :src="previewIconUrl"
                            alt=""
                            aria-hidden="true"
                            @error="iconBrokenModel = true"
                        />
                        <span>
                            accounts.{{ orgId || 'example' }}.com / login
                        </span>
                    </div>
                </div>

                <div class="br-preview-mock">
                    <header class="br-preview-mock__hero">
                        <img
                            v-if="previewLogoUrl && !logoBrokenModel"
                            class="br-preview-mock__logo"
                            :src="previewLogoUrl"
                            alt="Brand logo"
                            @error="logoBrokenModel = true"
                        />
                        <div
                            v-else
                            class="br-preview-mock__logo-placeholder"
                        >
                            LOGO
                        </div>
                        <h4 class="br-preview-mock__title">Welcome back</h4>
                        <p class="br-preview-mock__sub">
                            Sign in to continue to your account
                        </p>
                    </header>

                    <div class="br-preview-mock__form">
                        <!-- <div> not <label> — there's no real input to
                             associate; the value is a static span and a
                             <label> with no form control reads oddly in AT. -->
                        <div class="br-preview-mock__field">
                            <span class="br-preview-mock__field-label">
                                Email
                            </span>
                            <span class="br-preview-mock__field-value">
                                {{ loginNameSample }}
                            </span>
                        </div>
                        <div class="br-preview-mock__field">
                            <span class="br-preview-mock__field-label">
                                Password
                            </span>
                            <span
                                class="br-preview-mock__field-value br-preview-mock__field-value--dots"
                            >
                                ••••••••••
                            </span>
                        </div>
                        <div class="br-preview-mock__cta">Continue</div>
                    </div>

                    <p
                        v-if="preview?.warnColor"
                        class="br-preview-mock__warn"
                    >
                        <i class="fas fa-circle-info" />
                        Sample warning text uses warnColor.
                    </p>
                    <p
                        v-if="!watermarkHidden"
                        class="br-preview-mock__watermark"
                    >
                        Powered by Zitadel
                    </p>
                </div>
            </div>

            <pre v-if="preview && rawModel" class="br-preview">{{
                previewJson
            }}</pre>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import BasicBlock from '@/components/core/BasicBlock.vue';
import FileUploadField from '@/components/core/FileUploadField.vue';

const ASSET_KINDS = ['logo', 'icon'] as const;
const ASSET_THEMES = ['light', 'dark'] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];
export type AssetTheme = (typeof ASSET_THEMES)[number];

defineProps<{
    orgId: string;
    busy: boolean;
    preview: Record<string, string | boolean | undefined> | null;
    previewJson: string;
    previewStyle: Record<string, string>;
    previewLogoUrl: string;
    previewIconUrl: string;
    loginNameSample: string;
    watermarkHidden: boolean;
    liveLoginUrl: string;
}>();

const rawModel = defineModel<boolean>('raw', {required: true});
const themeModel = defineModel<AssetTheme>('theme', {required: true});
const logoBrokenModel = defineModel<boolean>('logoBroken', {required: true});
const iconBrokenModel = defineModel<boolean>('iconBroken', {required: true});

defineEmits<{
    'upload-asset': [args: {kind: AssetKind; theme: AssetTheme; event: Event}];
    'delete-asset': [args: {kind: AssetKind; theme: AssetTheme}];
    'upload-font': [event: Event];
    'delete-font': [];
    'load-preview': [];
}>();
</script>
