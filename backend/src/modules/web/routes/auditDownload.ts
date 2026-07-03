import * as fs from 'node:fs';
import * as path from 'node:path';
import express from 'express';
import {tuning} from '../../../config';
import {
    createAuditDownloadUrl,
    getAuditExportOwner,
    hasValidAuditDownloadTicket
} from '../../../model/component/AuditComponent';
import {isExportOwner} from '../../../model/energy/exportHandler';
import {
    authzAuditActor,
    authzAuditWriter
} from '../../../modules/authz/audit/AuthzAuditWriter';
import {UNAUTHORIZED_USER} from '../../user';
import {httpRouteLimit} from '../rateLimit';
import {
    isLoggedIn,
    requiresAuditView,
    userHasRole,
    userIsAdmin
} from '../utils/authMiddleware';
import {paramStr} from '../utils/params';
import {auditLogsPath, emReportsPath} from '../utils/uploadPaths';

const router = express.Router();

// Owner-bound artifact download from uploads/reports. Shared by reports +
// exports routes — same regex, owner check, path, and access guard.
async function serveOwnerBoundReportArtifact(
    req: express.Request,
    res: express.Response
): Promise<void> {
    const filename = paramStr(req.params.filename);
    // CSV, gzipped CSV, and energy HTML twins are owner-bound artifacts.
    if (!/^[a-zA-Z0-9\-_.]+\.(csv(\.gz)?|html)$/.test(filename)) {
        res.status(400).send('Invalid filename');
        return;
    }
    const userId = req.user?.userId;
    if (!userId || !(await isExportOwner(filename, userId))) {
        res.status(403).end();
        return;
    }
    // CWE-22 belt-and-braces: the regex already blocks separators; basename
    // strips any traversal a future regex tweak might let through.
    const safeName = path.basename(filename);
    const fullPath = path.join(emReportsPath, safeName);
    fs.access(fullPath, fs.constants.R_OK, (err) => {
        if (err) {
            res.status(404).send('File not found');
            return;
        }
        void authzAuditWriter.writeReportDownloaded({
            tenantId:
                typeof req.user?.organizationId === 'string'
                    ? req.user.organizationId
                    : null,
            actorId: authzAuditActor(req.user),
            file: safeName,
            route: req.path.startsWith('/reports/')
                ? '/reports/download'
                : '/exports/download'
        });
        res.download(fullPath, safeName);
    });
}

router.get(
    '/audit-log/download/:filename',
    httpRouteLimit({
        name: 'audit-log-download',
        capacityPerMin: tuning.http.rateLimitReportsDownloadPerMin
    }),
    async (req, res) => {
        const filename = paramStr(req.params.filename);
        if (!/^audit-log-([0-9]+|fleet)-\d+\.csv$/.test(filename)) {
            res.status(400).send('Invalid filename');
            return;
        }

        // Cross-tenant guard: tickets are user-bound and the role-bypass
        // path additionally requires the caller to be the original exporter.
        // A foreign-tenant admin/auditor who guesses a filename gets a 403.
        const userId = req.user?.userId;
        const owner = await getAuditExportOwner(filename);
        const hasValidTicket = await hasValidAuditDownloadTicket(
            filename,
            typeof req.query.ticket === 'string' ? req.query.ticket : undefined,
            userId
        );
        const isOriginalExporter = Boolean(
            userId &&
                owner === userId &&
                req.user &&
                req.user.username !== UNAUTHORIZED_USER.username &&
                (userIsAdmin(req.user) || userHasRole(req.user, 'auditor'))
        );

        if (!hasValidTicket && !isOriginalExporter) {
            res.status(403).end();
            return;
        }

        // OWASP CWE-22 belt-and-braces: even though the regex above already
        // blocks `../`, basename() strips any directory traversal that
        // could slip past a future regex tweak.
        const safeName = path.basename(filename);
        const fullPath = path.join(auditLogsPath, safeName);
        fs.access(fullPath, fs.constants.R_OK, (err) => {
            if (err) {
                res.status(404).send('File not found');
                return;
            }
            res.download(fullPath, safeName);
        });
    }
);

router.post(
    '/audit-log/download-ticket/:filename',
    requiresAuditView,
    httpRouteLimit({
        name: 'audit-log-download-ticket',
        capacityPerMin: tuning.http.rateLimitReportsDownloadPerMin
    }),
    async (req, res) => {
        const filename = paramStr(req.params.filename);
        if (!/^audit-log-([0-9]+|fleet)-\d+\.csv$/.test(filename)) {
            res.status(400).json({error: 'Invalid filename'});
            return;
        }
        // Mint-ticket also requires owner match — prevents a tenant-A
        // auditor from minting a ticket against a tenant-B file.
        const userId = req.user?.userId;
        const owner = await getAuditExportOwner(filename);
        if (!userId || owner !== userId) {
            res.status(403).json({error: 'forbidden'});
            return;
        }
        const fullPath = path.join(auditLogsPath, filename);
        fs.access(fullPath, fs.constants.R_OK, async (err) => {
            if (err) {
                res.status(404).json({error: 'File not found'});
                return;
            }
            const downloadUrl = await createAuditDownloadUrl(filename, userId);
            res.json({downloadUrl});
        });
    }
);

// Same uploads/reports directory as /exports/download. Owner-bound via
// Redis (or in-memory in single-process deploys); ReportComponent CSV
// writers and handleEnergyExport both call bindExportOwner so every
// file written under uploads/reports has an owner. Without this check
// the legacy admin-only route would let any admin download an export
// CSV created by another user — including across tenants — bypassing
// the owner bind enforced on /exports/download.
router.get(
    '/reports/download/:filename',
    isLoggedIn,
    httpRouteLimit({
        name: 'reports-download',
        capacityPerMin: tuning.http.rateLimitReportsDownloadPerMin
    }),
    serveOwnerBoundReportArtifact
);

// One-off export downloads — owner-bound via Redis (or in-memory in
// single-process deploys). No token in URL.
router.get(
    '/exports/download/:filename',
    isLoggedIn,
    httpRouteLimit({
        name: 'exports-download',
        capacityPerMin: tuning.http.rateLimitReportsDownloadPerMin
    }),
    serveOwnerBoundReportArtifact
);

export default router;
