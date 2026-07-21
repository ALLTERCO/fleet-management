// Editable source for ../authorization.svg, edit this, then regenerate:
//   node docs/api/guides/diagrams/src/authorization.js
const fs = require('node:fs');
const path = require('node:path');
const k = require('./kit.js');
const {ROLE, MUT} = k;

let g = k.svg({
    w: 1230, h: 560,
    title: 'Authorization: persona plus assignment plus scope becomes effective permissions',
    desc: 'Permissions follow an IAM-style model. A persona is a reusable bundle of allow and deny statements over actions and resource types. An assignment attaches a persona to a subject, a user or user group, optionally narrowed by a scope. Your effective permissions are the union of the personas from your roles and assignments, with an explicit deny always winning. On every call the server enforces the operation x-fm-permission; no permission returns PermissionDenied 403 and no identity returns Unauthorized 401.',
    heading: 'Authorization: who can do what',
    sub: 'Persona plus assignment plus scope becomes your effective permissions, enforced on every call.'
});

// inputs
g += k.chip(60, 146, 220, 124, {title: 'Persona', color: ROLE.identity, icon: 'shieldcheck',
    body: ['allow / deny statements', 'actions · resource types']});
g += k.chip(60, 320, 220, 124, {title: 'User or user group', color: ROLE.client, icon: 'users',
    body: ['the subject', 'inherited up the tree']});

// assignment + scope
g += k.chip(340, 208, 220, 124, {title: 'Assignment', color: ROLE.core, icon: 'tag',
    body: ['attaches a persona', 'to a subject']});
g += k.chip(340, 388, 220, 124, {title: 'Scope', color: ROLE.warn, icon: 'grid',
    body: ['all · devices · locations', 'groups · tags · dashboards']});

// result + enforcement
g += k.chip(640, 208, 240, 124, {title: 'Effective permissions', color: ROLE.core, icon: 'key',
    body: ['union of assignments', 'explicit deny wins']});
g += k.chip(960, 208, 210, 124, {title: 'Enforced', color: ROLE.delivery, icon: 'check',
    body: ['on every call', 'x-fm-permission']});

// arrows
g += k.link([[280, 208], [320, 208], [320, 250], [340, 250]], {color: MUT});
g += k.link([[280, 382], [320, 382], [320, 290], [340, 290]], {color: MUT});
g += k.link([[450, 388], [450, 332]], {color: MUT});
g += k.pill('narrows', 450, 360, {color: MUT});
g += k.link([[560, 270], [640, 270]], {color: MUT});
g += k.link([[880, 270], [960, 270]], {color: MUT});

g += `<text x="615" y="532" text-anchor="middle" font-size="12.5" fill="${MUT}">Eight built-in personas: admin · manager · editor · installer · operator · automation_admin · auditor · viewer. A deployment can add its own.</text>`;
g += `<text x="615" y="550" text-anchor="middle" font-size="12.5" fill="${MUT}">No permission returns PermissionDenied (403); no identity returns Unauthorized (401). A scoped token can only narrow, never grant more.</text>`;

g += k.close();
fs.writeFileSync(path.join(__dirname, '..', 'authorization.svg'), g);
console.log('wrote ../authorization.svg', Math.round(g.length / 1024) + 'KB');
