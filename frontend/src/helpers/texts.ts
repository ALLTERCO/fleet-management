/**
 * Escape HTML special characters to prevent XSS in tooltip formatters and
 * other contexts where untrusted strings are interpolated into HTML.
 */
export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function getTestEmail(from: string, to: string) {
    const text =
        'If you have received this mail, this means that the mail plugin in your Fleet Manager is configured correctly and working';

    return {
        from: `"Fleet Manager" <${from}>`,
        to: to,
        subject: 'Hello from Fleet Manager ✔',
        text: text,
        html: `<b>Mail Component Working</b><br><span>${text}</span>`
    };
}
