// Email templates — default HTML/text + renderer for per-endpoint
// overrides. All user-facing interpolation goes through renderTemplate
// (one HTML-escape code path). Branding is env-driven (FM_EMAIL_*).

import * as log4js from 'log4js';
import {envStr} from '../../../config/envReader';
import {buildDeliveryContext} from '../../alert/templateContext';
import {renderTemplate} from '../../alert/templateRenderer';
import {alertHref as buildAlertHref} from '../alertLink';
import {analyzePayload, summaryLine} from '../groupedRender';
import type {DeliveryPayload} from '../types';

const logger = log4js.getLogger('EmailTemplate');

interface BrandConfig {
    name: string;
    logoUrl: string;
    colorInfo: string;
    colorWarning: string;
    colorCritical: string;
}

function brand(): BrandConfig {
    return {
        name: envStr('FM_EMAIL_BRAND_NAME', 'Fleet Manager'),
        logoUrl: envStr('FM_EMAIL_BRAND_LOGO_URL', ''),
        colorInfo: envStr('FM_EMAIL_COLOR_INFO', '#3b82f6'),
        colorWarning: envStr('FM_EMAIL_COLOR_WARNING', '#f59e0b'),
        colorCritical: envStr('FM_EMAIL_COLOR_CRITICAL', '#ef4444')
    };
}

function colorFor(severity: DeliveryPayload['severity'], b: BrandConfig) {
    if (severity === 'critical') return b.colorCritical;
    if (severity === 'warning') return b.colorWarning;
    return b.colorInfo;
}

function alertHref(payload: DeliveryPayload): string {
    return buildAlertHref(payload.alertId);
}

/** Tokenized default HTML — interpolates everything through renderTemplate. */
function defaultHtmlTemplate(
    b: BrandConfig,
    accent: string,
    href: string
): string {
    // Presentational conditionals (logo vs text, button present) stay in
    // TS; every user-facing value uses {{…}} tokens so renderTemplate's
    // HTML escape is the single code path for attribute/text contexts.
    const logo = b.logoUrl
        ? `<img src="{{brand.logoUrl}}" alt="{{brand.name}}" height="28" style="display:block;border:0;outline:none;"/>`
        : `<span style="color:#fff;font-size:16px;font-weight:600;letter-spacing:.02em;">{{brand.name}}</span>`;
    const button = href
        ? `<tr><td style="padding:20px 24px 4px 24px;"><a href="{{brand.alertHref}}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px;">Open alert →</a></td></tr>`
        : '';
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <tr><td style="background:#111827;padding:14px 24px;">${logo}</td></tr>
      <tr><td style="background:${accent};height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:24px 24px 4px 24px;">
        <div style="display:inline-block;background:${accent};color:#fff;font-size:11px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:4px;">{{brand.severityLabel}}</div>
        <h1 style="margin:12px 0 0 0;font-size:20px;line-height:1.3;color:#111827;">{{alert.title}}</h1>
      </td></tr>
      <tr><td style="padding:12px 24px 20px 24px;color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap;">{{alert.message}}</td></tr>
      ${button}
      <tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
        Rule: <strong>{{rule.name}}</strong> · Source: {{alert.source.id}}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function brandContext(b: BrandConfig, payload: DeliveryPayload) {
    return {
        ...buildDeliveryContext(payload),
        brand: {
            name: b.name,
            logoUrl: b.logoUrl,
            alertHref: alertHref(payload),
            severityLabel: payload.severity.toUpperCase()
        }
    };
}

export function renderDefaultEmailHtml(payload: DeliveryPayload): string {
    const b = brand();
    const accent = colorFor(payload.severity, b);
    const template = defaultHtmlTemplate(b, accent, alertHref(payload));
    return renderTemplate(template, brandContext(b, payload), {
        escapeMode: 'html'
    }).rendered;
}

export function renderDefaultEmailText(payload: DeliveryPayload): string {
    const info = analyzePayload(payload);
    const b = brand();
    const href = alertHref(payload);
    if (info.mode === 'single') {
        const template = href
            ? '[{{brand.severityLabel}}] {{alert.title}}\n\n{{alert.message}}\n\nRule: {{rule.name}}\nOpen alert: {{brand.alertHref}}'
            : '[{{brand.severityLabel}}] {{alert.title}}\n\n{{alert.message}}\n\nRule: {{rule.name}}';
        return renderTemplate(template, brandContext(b, payload)).rendered;
    }
    const header =
        info.mode === 'summary'
            ? `[${payload.severity.toUpperCase()}] ${summaryLine(info.aggregate)} — ${payload.ruleName}`
            : `[${payload.severity.toUpperCase()}] ${info.alerts.length} alerts — ${payload.ruleName}`;
    const body =
        info.mode === 'summary'
            ? 'Open Fleet Manager for the full list.'
            : info.alerts
                  .slice(0, 50)
                  .map(
                      (a) =>
                          `• [${a.severity.toUpperCase()}] ${a.title}${a.source ? ` (${a.source.subjectId})` : ''}`
                  )
                  .join('\n');
    const footer = href ? `\n\nOpen alerts: ${href}` : '';
    return `${header}\n\n${body}${footer}`;
}

export interface RenderedEmail {
    html: string;
    text: string;
    missingTokens: string[];
    truncated: boolean;
}

function renderWith(
    template: string | null | undefined,
    mode: 'html' | 'none',
    payload: DeliveryPayload,
    providerLabel: string
): {text: string; missing: string[]; truncated: boolean} | null {
    if (!template) return null;
    try {
        const out = renderTemplate(template, buildDeliveryContext(payload), {
            escapeMode: mode
        });
        return {
            text: out.rendered,
            missing: out.missingTokens,
            truncated: out.truncated
        };
    } catch (err) {
        logger.warn(
            '%s: template render failed — falling back to default. error=%s',
            providerLabel,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

export function renderEmail(
    payload: DeliveryPayload,
    htmlTemplate?: string | null,
    textTemplate?: string | null
): RenderedEmail {
    const html = renderWith(htmlTemplate, 'html', payload, 'email_smtp.html');
    const text = renderWith(textTemplate, 'none', payload, 'email_smtp.text');
    const missing = new Set<string>([
        ...(html?.missing ?? []),
        ...(text?.missing ?? [])
    ]);
    return {
        html: html?.text ?? renderDefaultEmailHtml(payload),
        text: text?.text ?? renderDefaultEmailText(payload),
        missingTokens: [...missing].sort(),
        truncated: Boolean(html?.truncated || text?.truncated)
    };
}

/** Subject template renderer — falls back to payload.title. */
export function renderSubject(
    payload: DeliveryPayload,
    subjectTemplate?: string | null
): string {
    const out = renderWith(
        subjectTemplate,
        'none',
        payload,
        'email_smtp.subject'
    );
    return out?.text ?? payload.title;
}
