// Exchange a Bearer access token for an HttpOnly `token` cookie so plain
// navigations (e.g. /api/docs) authenticate without the SPA touching cookies.

import express from 'express';
import {tuning} from '../../../config/tuning';
import {httpRouteLimit} from '../rateLimit';
import {isLoggedIn} from '../utils/authMiddleware';
import {isSecureRequest} from '../utils/secureCookie';

const COOKIE_NAME = 'token';
const router = express.Router();

const SESSION_LIMIT = {
    name: 'auth-session',
    capacityPerMin: tuning.http.rateLimitAuthSessionPerMin
};

function cookieOptions(req: express.Request): express.CookieOptions {
    return {
        httpOnly: true,
        sameSite: 'strict',
        secure: isSecureRequest(req),
        path: '/'
    };
}

router.post('/', httpRouteLimit(SESSION_LIMIT), isLoggedIn, (req, res) => {
    if (!req.token) {
        res.status(400).json({error: 'No token in request'});
        return;
    }
    res.cookie(COOKIE_NAME, req.token, cookieOptions(req));
    res.status(204).end();
});

// Unauthenticated by design: logout must clear an expired session's cookie.
router.delete('/', httpRouteLimit(SESSION_LIMIT), (_req, res) => {
    res.clearCookie(COOKIE_NAME, {path: '/', sameSite: 'strict'});
    res.status(204).end();
});

export default router;
