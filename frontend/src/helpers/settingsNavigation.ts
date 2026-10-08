import {canAccessPage, type PageAccessContext} from '@/auth/pageAccess';
import {ALERTS_PATH, PROFILE_PATH, SETTINGS_PATH} from '@/constants';
import {MONITORING_CLUSTERS} from '@/helpers/monitoringNavigation';
import type {SearchCandidate} from '@/helpers/searchMatch';

// One sidebar for the whole settings area — the device-settings language
// (grouped items, circular icon chips) instead of horizontal tab rows. The
// list lives here so the sidebar and the global search read the same pages.

export interface SettingsNavItem {
    label: string;
    path: string;
    icon: string;
    external?: boolean;
    /** Words this page also answers to. A name alone is not how people ask. */
    keywords?: readonly string[];
}

export interface SettingsNavGroup {
    label: string;
    items: readonly SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
    {
        label: 'Application',
        items: [
            {
                label: 'General',
                path: SETTINGS_PATH,
                icon: 'fas fa-cog',
                keywords: [
                    'organization',
                    'company',
                    'timezone',
                    'currency',
                    'branding',
                    'locale',
                    'language',
                    'date format',
                    'number format',
                    'logo',
                    'name',
                    'units',
                    'region'
                ]
            },
            {
                label: 'User settings',
                path: PROFILE_PATH,
                icon: 'fas fa-user-cog',
                keywords: [
                    'profile',
                    'me',
                    'my account',
                    'password',
                    'preferences',
                    'dark mode',
                    'theme',
                    'my notifications',
                    'sign in'
                ]
            }
        ]
    },
    {
        label: 'Alerts',
        items: [
            {
                label: 'Inbox',
                path: ALERTS_PATH,
                icon: 'fas fa-bolt',
                keywords: [
                    'alarms',
                    'incidents',
                    'firing',
                    'active alerts',
                    'notifications',
                    'what happened',
                    'open alerts',
                    'unread'
                ]
            },
            {
                label: 'Alerts',
                path: '/settings/alerts/rules',
                icon: 'fas fa-sliders',
                keywords: [
                    'rules',
                    'alarm',
                    'threshold',
                    'trigger',
                    'new alert',
                    'notify me',
                    'tell me when',
                    'create',
                    'condition',
                    'watch'
                ]
            },
            {
                label: 'Channels',
                path: '/settings/alerts/channels',
                icon: 'fas fa-bullhorn',
                keywords: [
                    'email',
                    'slack',
                    'teams',
                    'telegram',
                    'webhook',
                    'sms',
                    'recipients',
                    'where to send',
                    'destination',
                    'discord',
                    'notify',
                    'send to'
                ]
            },
            {
                label: 'Templates',
                path: '/settings/alerts/templates',
                icon: 'fas fa-envelope-open-text',
                keywords: [
                    'message',
                    'wording',
                    'text',
                    'alert template',
                    'subject',
                    'body',
                    'customise',
                    'wording of the message'
                ]
            }
        ]
    },
    {
        label: 'Energy and billing',
        items: [
            {
                label: 'Bill',
                path: '/settings/energy/bill',
                icon: 'fas fa-file-invoice',
                keywords: [
                    'invoice',
                    'quote',
                    'charges',
                    'cost',
                    'money',
                    'utility bill',
                    'how much',
                    'spend',
                    'total',
                    'vat',
                    'what we owe'
                ]
            },
            {
                label: 'Tariffs',
                path: '/settings/energy/tariffs',
                icon: 'fas fa-tags',
                keywords: [
                    'price',
                    'prices',
                    'rate',
                    'rates',
                    'cost',
                    'kwh',
                    'tax',
                    'standing charge',
                    'time of use',
                    'supplier',
                    'contract',
                    'peak',
                    'off peak',
                    'vat',
                    'unit price',
                    'day night'
                ]
            },
            {
                label: 'Recorded bills',
                path: '/settings/energy/bills',
                icon: 'fas fa-receipt',
                keywords: [
                    'invoice',
                    'invoices',
                    'utility bill',
                    'reconcile',
                    'statement',
                    'upload bill',
                    'actual bill',
                    'compare',
                    'paid'
                ]
            },
            {
                label: 'Meters',
                path: '/settings/energy/meters',
                icon: 'fas fa-gauge',
                keywords: [
                    'ct',
                    'clamp',
                    'submeter',
                    'logical meter',
                    'channel',
                    'main meter',
                    'sub meter',
                    'circuit',
                    'what feeds what'
                ]
            },
            {
                label: 'Carbon and gas',
                path: '/settings/energy/carbon',
                icon: 'fas fa-leaf',
                keywords: [
                    'co2',
                    'emissions',
                    'footprint',
                    'gas',
                    'm3',
                    'calorific',
                    'therm',
                    'cubic metre',
                    'sustainability',
                    'green',
                    'esg'
                ]
            },
            {
                label: 'Fix data',
                path: '/settings/energy/repair',
                icon: 'fas fa-screwdriver-wrench',
                keywords: [
                    'repair',
                    'history',
                    'backfill',
                    'correct',
                    'gap',
                    'wrong data',
                    'mistake',
                    'reclassify',
                    'fix history'
                ]
            }
        ]
    },
    {
        label: 'Operations',
        items: [
            {
                label: 'Operations',
                path: '/settings/operations',
                icon: 'fas fa-list-check',
                keywords: [
                    'operational policy',
                    'refrigeration',
                    'parking',
                    'irrigation',
                    'solar',
                    'pv',
                    'water',
                    'safety',
                    'schedule',
                    'health',
                    'configure operations'
                ]
            }
        ]
    },
    {
        label: 'Users & access',
        items: [
            {
                label: 'Users',
                path: '/settings/users',
                icon: 'fas fa-users',
                keywords: [
                    'people',
                    'accounts',
                    'staff',
                    'invite',
                    'member',
                    'add user',
                    'remove user',
                    'colleague',
                    'who has access'
                ]
            },
            {
                label: 'Groups',
                path: '/settings/user-groups',
                icon: 'fas fa-user-friends',
                keywords: [
                    'team',
                    'teams',
                    'user group',
                    'membership',
                    'team of people',
                    'permission group'
                ]
            },
            {
                label: 'Personas',
                path: '/settings/personas',
                icon: 'fas fa-id-badge',
                keywords: [
                    'role',
                    'roles',
                    'permission',
                    'permissions',
                    'access',
                    'who can do what',
                    'job',
                    'what they may do'
                ]
            },
            {
                label: 'Access simulator',
                path: '/settings/authz-simulator',
                icon: 'fas fa-bolt',
                keywords: [
                    'permission',
                    'test access',
                    'who can',
                    'authz',
                    'check permissions',
                    'why can this person'
                ]
            },
            {
                label: 'Identity policies',
                path: '/settings/identity-policies',
                icon: 'fas fa-id-card-clip',
                keywords: [
                    'login',
                    'password policy',
                    'mfa',
                    'sso',
                    'zitadel',
                    'two factor',
                    '2fa',
                    'session',
                    'sign in rules'
                ]
            },
            {
                label: 'Identity SMTP',
                path: '/settings/identity-smtp',
                icon: 'fas fa-envelope',
                keywords: [
                    'email server',
                    'mail',
                    'smtp',
                    'sender',
                    'outgoing mail',
                    'mail server',
                    'send email from'
                ]
            }
        ]
    },
    // Five clusters, one per operator question — detail pages are tabs
    // inside each cluster, defined next to the pages they navigate.
    {
        label: 'Monitoring',
        items: MONITORING_CLUSTERS.map((cluster) => ({
            label: cluster.label,
            path: cluster.path,
            icon: cluster.icon
        }))
    },
    {
        label: 'System',
        items: [
            {
                label: 'Security',
                path: '/settings/security',
                icon: 'fas fa-shield-halved',
                keywords: [
                    'audit',
                    'sessions',
                    'tokens',
                    'api key',
                    'login history',
                    'who logged in',
                    'access log',
                    'personal access token',
                    'pat'
                ]
            },
            {
                label: 'Plugins',
                path: '/settings/plugins',
                icon: 'fas fa-puzzle-piece',
                keywords: [
                    'integrations',
                    'extensions',
                    'add-ons',
                    'node-red',
                    'apps',
                    'connect'
                ]
            },
            {
                label: 'Configurations',
                path: '/settings/configurations',
                icon: 'fas fa-wrench',
                keywords: [
                    'config',
                    'settings backup',
                    'export',
                    'import',
                    'backup',
                    'restore',
                    'save settings'
                ]
            },
            {
                label: 'Connect your AI',
                path: '/settings/connect-ai',
                icon: 'fas fa-robot',
                keywords: [
                    'ai',
                    'mcp',
                    'claude',
                    'chatgpt',
                    'cursor',
                    'vs code',
                    'copilot',
                    'agent',
                    'assistant',
                    'llm',
                    'connector',
                    'model context protocol'
                ]
            },
            {
                label: 'API reference',
                path: '/api/docs',
                icon: 'fas fa-code',
                keywords: [
                    'docs',
                    'documentation',
                    'rpc',
                    'openapi',
                    'developer',
                    'api',
                    'swagger',
                    'integrate'
                ],
                external: true
            }
        ]
    }
];

/** Pages this person may see. An external link is a public doc, always shown. */
export function settingsPageVisible(
    item: SettingsNavItem,
    canOpenPage: (path: string) => boolean
): boolean {
    return item.external === true || canOpenPage(item.path);
}

/** The sidebar's own access test, so search hides exactly the same pages. */
export function canOpenSettingsPage(
    access: PageAccessContext
): (path: string) => boolean {
    return (path) => canAccessPage(path, access);
}

// The sidebar filters nav items, the global search routes to pages. Only the
// value differs, so the words a page answers to are written once, here.
/**
 * A page as the search sees it. The group name joins its words, because that
 * is how a person asks: "the alert settings" means every page under Alerts,
 * not only the one called Alerts.
 */
export function settingsNavCandidate(
    item: SettingsNavItem,
    group?: SettingsNavGroup
): SearchCandidate<SettingsNavItem> {
    const own = item.keywords ?? [];
    const groupWord = group?.label.toLowerCase();
    return {
        value: item,
        label: item.label,
        keywords:
            groupWord && !own.includes(groupWord) ? [...own, groupWord] : own
    };
}
