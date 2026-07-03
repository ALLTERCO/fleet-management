import type {BackendOidcConfig} from './index';

export function oidcUserinfoEndpoint(config: BackendOidcConfig): string {
    if (config.userinfoEndpoint) {
        return config.userinfoEndpoint;
    }
    return `${config.authority}/oidc/v1/userinfo`;
}

export function oidcApiBaseUrl(config: BackendOidcConfig): string {
    return config.apiBaseUrl || config.authority;
}
