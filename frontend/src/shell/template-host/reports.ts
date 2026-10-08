// Re-bound to the Fleet transport. The behaviour lives in the core domain;
// this file only names it. A second untyped proxy over the same namespace
// meant one call had two homes, and one home skipped the argument shaping.

import {hostRpcAccess} from './api';
import {createReportsDomain} from './core/domains/reports';
import {createHostDomain} from './domain';

export const reports = createReportsDomain(hostRpcAccess);

// Named for reports, but it is the energy namespace, and it is documented
// with its own vocabulary (`energyReports.query`, where the curated energy
// domain calls the same RPC `history`). Collapsing the two renames a
// published method, so that is a decision with a doc change attached, not a
// tidy-up to fold into this one.
export const energyReports = createHostDomain('energy');
