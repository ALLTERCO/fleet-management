// OAuth-email callback popup. CSP-clean (no inline JS). Reads status +
// detail from body data-* attrs. postMessage to own-origin opener only.
(function () {
    var body = document.body;
    var s = body.dataset.oauthStatus === 'ok' ? 'ok' : 'error';
    var d = body.dataset.oauthDetail || '';
    var h = document.getElementById('h');
    var p = document.getElementById('p');
    if (h) h.innerText = s === 'ok' ? 'Connected' : 'Failed';
    if (p) p.innerText = d;
    if (window.opener) {
        try {
            window.opener.postMessage(
                {type: 'fleet-oauth-email', status: s, detail: d},
                window.location.origin
            );
        } catch (e) {
            // postMessage failed (opener gone) — close anyway
        }
        setTimeout(function () {
            window.close();
        }, s === 'ok' ? 800 : 3000);
    }
})();
