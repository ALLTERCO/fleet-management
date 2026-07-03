import {
    CHANNEL_PROVIDER_DESCRIPTORS,
    type ChannelProvider,
    type ChannelProviderDescriptor
} from '../../types/api/channel';
import {enforceEmailAttachmentLimit} from '../delivery/emailAttachments';
import {getEmailCaps} from '../delivery/emailCaps';
import {enforceDkimAlignment} from '../delivery/emailDkim';
import {
    mergeIntegrationConfig,
    mergeIntegrationConfigPatch,
    validateIntegrationConfig
} from '../integrationConfig';

type JsonRecord = Record<string, unknown>;

export interface ValidatedChannelConfig {
    publicConfig: JsonRecord;
    secretConfig: JsonRecord;
    fullConfig: JsonRecord;
    hasSecretFields: boolean;
}

export function listChannelProviderDescriptors(): {
    items: ChannelProviderDescriptor[];
} {
    const caps = getEmailCaps();
    return {
        items: CHANNEL_PROVIDER_DESCRIPTORS.map((item) =>
            item.key === 'email_smtp' ? {...item, emailCaps: caps} : {...item}
        )
    };
}

export function validateChannelConfig(
    provider: ChannelProvider,
    config: JsonRecord
): ValidatedChannelConfig {
    enforceProviderSpecificRules(provider, config);
    return validateIntegrationConfig(provider, config);
}

export function mergeChannelConfigPatch(
    provider: ChannelProvider,
    currentPublicConfig: unknown,
    currentSecretConfig: unknown,
    patchConfig: JsonRecord
): ValidatedChannelConfig {
    const merged = mergeIntegrationConfigPatch(
        provider,
        currentPublicConfig,
        currentSecretConfig,
        patchConfig
    );
    enforceProviderSpecificRules(provider, merged.publicConfig);
    return merged;
}

export function mergeChannelConfig(
    provider: ChannelProvider,
    publicConfig: unknown,
    secretConfig: unknown
): JsonRecord {
    return mergeIntegrationConfig(provider, publicConfig, secretConfig);
}

function enforceProviderSpecificRules(
    provider: ChannelProvider,
    config: JsonRecord
): void {
    if (provider !== 'email_smtp') return;
    enforceEmailAttachmentLimit(config.attachments);
    enforceDkimAlignment(config);
}
