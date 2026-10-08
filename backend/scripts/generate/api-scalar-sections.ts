// Static section HTML — no per-spec interpolation.

export const SECTION_AUTH_HTML = `    <section id="auth" class="fm-panel">
      <div class="fm-panel-head">
        <p class="fm-panel-eyebrow">Authentication</p>
        <h2>Authenticate the socket, then call freely.</h2>
        <p>Fleet Manager uses <strong>Zitadel OIDC</strong> for identity. The WebSocket is authenticated at the upgrade to <code>wss://your-host/</code>: browsers pass the OIDC access token as the WebSocket subprotocol, and non-browser clients send an <code>Authorization: Bearer</code> token. Once the socket is open, every call on it is authenticated — there is no per-call token.</p>
      </div>
      <div class="fm-panel-split">
        <div class="fm-panel-body">
          <p><strong>Browser clients</strong> — after the user signs in, open the socket with the access token as the subprotocol (the second <code>WebSocket</code> argument). An invalid token closes the socket with code <code>4401</code>.</p>
          <p><strong>Server-to-server</strong> — create a scoped token with <code>user.CreateScopedPAT</code> and present it as <code>Authorization: Bearer</code> on <code>POST /rpc</code> or on the WebSocket upgrade. A scoped token can only narrow its owner's permissions, never widen them.</p>
          <p><strong>Permissions</strong> — every operation declares its required permission via the <code>x-fm-permission</code> extension on each method below (e.g. <code>{component: 'devices', operation: 'read'}</code>). The dispatcher enforces it before the handler runs.</p>
          <p><span class="fm-pill">Revocable</span> &nbsp; Tokens are re-checked about every 30&nbsp;seconds on an open socket, so revoking one drops its live sessions.</p>
        </div>
        <div class="fm-codeblock">
          <pre><span class="fm-tok-com">// Browser — the OIDC access token rides in the subprotocol slot</span>
<span class="fm-tok-kw">const</span> ws = <span class="fm-tok-kw">new</span> WebSocket(<span class="fm-tok-str">'wss://your-host/'</span>, accessToken);

<span class="fm-tok-com">// Server-to-server — bearer token on the upgrade (or on POST /rpc)</span>
<span class="fm-tok-kw">const</span> ws = <span class="fm-tok-kw">new</span> WebSocket(<span class="fm-tok-str">'wss://your-host/'</span>, {
  <span class="fm-tok-key">headers</span>: { <span class="fm-tok-key">Authorization</span>: <span class="fm-tok-str">'Bearer &lt;token&gt;'</span> }
});

<span class="fm-tok-com">// Connection-scoped: the socket carries the authenticated identity.</span>
<span class="fm-tok-com">// No per-call auth header needed.</span></pre>
        </div>
      </div>
    </section>`;

export const SECTION_TRANSPORT_HTML = `    <section id="transport" class="fm-panel">
      <div class="fm-panel-head">
        <p class="fm-panel-eyebrow">Transport</p>
        <h2>WebSocket framing, JSON-RPC 2.0.</h2>
        <p>One persistent connection per client. Requests are JSON-RPC frames; the server answers with <code>result</code> or <code>error</code> using the same <code>id</code>. Server-pushed events arrive as id-less notifications on the same socket — no separate event channel.</p>
      </div>
      <div class="fm-codeblock-stack">
        <div>
          <span class="fm-codeblock-label">Request frame</span>
          <div class="fm-codeblock"><pre>{
  <span class="fm-tok-key">"jsonrpc"</span>: <span class="fm-tok-str">"2.0"</span>,
  <span class="fm-tok-key">"id"</span>: <span class="fm-tok-num">1</span>,
  <span class="fm-tok-key">"src"</span>: <span class="fm-tok-str">"my-client"</span>,
  <span class="fm-tok-key">"dst"</span>: <span class="fm-tok-str">"FLEET_MANAGER"</span>,
  <span class="fm-tok-key">"method"</span>: <span class="fm-tok-str">"device.List"</span>,
  <span class="fm-tok-key">"params"</span>: { <span class="fm-tok-key">"limit"</span>: <span class="fm-tok-num">25</span> }
}</pre></div>
        </div>
        <div>
          <span class="fm-codeblock-label">Success response</span>
          <div class="fm-codeblock"><pre>{
  <span class="fm-tok-key">"jsonrpc"</span>: <span class="fm-tok-str">"2.0"</span>,
  <span class="fm-tok-key">"id"</span>: <span class="fm-tok-num">1</span>,
  <span class="fm-tok-key">"src"</span>: <span class="fm-tok-str">"FLEET_MANAGER"</span>,
  <span class="fm-tok-key">"dst"</span>: <span class="fm-tok-str">"my-client"</span>,
  <span class="fm-tok-key">"result"</span>: {
    <span class="fm-tok-key">"items"</span>: [ ... ],
    <span class="fm-tok-key">"total"</span>: <span class="fm-tok-num">128</span>,
    <span class="fm-tok-key">"has_more"</span>: <span class="fm-tok-kw">true</span>
  }
}</pre></div>
        </div>
        <div>
          <span class="fm-codeblock-label">Error response</span>
          <div class="fm-codeblock"><pre>{
  <span class="fm-tok-key">"jsonrpc"</span>: <span class="fm-tok-str">"2.0"</span>,
  <span class="fm-tok-key">"id"</span>: <span class="fm-tok-num">1</span>,
  <span class="fm-tok-key">"src"</span>: <span class="fm-tok-str">"FLEET_MANAGER"</span>,
  <span class="fm-tok-key">"dst"</span>: <span class="fm-tok-str">"my-client"</span>,
  <span class="fm-tok-key">"error"</span>: {
    <span class="fm-tok-key">"code"</span>: -<span class="fm-tok-num">32602</span>,
    <span class="fm-tok-key">"message"</span>: <span class="fm-tok-str">"Invalid params"</span>,
    <span class="fm-tok-key">"data"</span>: { <span class="fm-tok-key">"field"</span>: <span class="fm-tok-str">"limit"</span> }
  }
}</pre></div>
        </div>
        <div>
          <span class="fm-codeblock-label">Server-pushed event (no <code>id</code>)</span>
          <div class="fm-codeblock"><pre>{
  <span class="fm-tok-key">"method"</span>: <span class="fm-tok-str">"Shelly.Status"</span>,
  <span class="fm-tok-key">"params"</span>: { <span class="fm-tok-key">"shellyID"</span>: <span class="fm-tok-str">"shellyplus1-..."</span>, <span class="fm-tok-key">"status"</span>: { ... } },
  <span class="fm-tok-key">"streamId"</span>: <span class="fm-tok-str">"1684123456789-0"</span>
}</pre></div>
        </div>
      </div>
      <p style="margin-top:24px;font-size:13.5px;color:var(--fm-muted);max-width:760px;line-height:1.6;">
        <strong>Reconnection.</strong> Clients should reconnect on disconnect with exponential backoff. Subscriptions are connection-scoped — after reconnecting, call <code>system.Subscribe</code> again with the prior <code>connectionId</code> and your last <code>streamId</code> to replay missed events (retained about one hour). If the gap is too large, the server signals a full resync.
      </p>
    </section>`;

export const SECTION_QUICKSTART_HTML = `    <section id="quickstart" class="fm-quickstart">
      <div class="fm-quickstart-inner">
        <div class="fm-qs-text">
          <h2>Quick start</h2>
          <p>The API is a JSON-RPC surface over WebSocket. Open a connection to <code>wss://your-host/</code> (authenticated at the upgrade — see below), then send framed RPC calls; each frame carries <code>src</code> and <code>dst</code> routing fields. Every namespace advertises a <code>Describe</code> method so clients can self-introspect at runtime.</p>
          <p>The full OpenAPI 3.1 spec is also available at <code>/api/docs/openapi.json</code> on any running deployment, with the <code>servers</code> field rewritten to that host.</p>
        </div>
        <div class="fm-qs-code"><pre><span class="fm-tok-com">// Open + authenticate (token rides in the subprotocol slot)</span>
<span class="fm-tok-kw">const</span> ws = <span class="fm-tok-kw">new</span> WebSocket(<span class="fm-tok-str">'wss://your-fleet.example.com/'</span>, accessToken);

ws.onopen = () =&gt; {
  ws.send(JSON.stringify({
    <span class="fm-tok-key">jsonrpc</span>: <span class="fm-tok-str">'2.0'</span>,
    <span class="fm-tok-key">id</span>: <span class="fm-tok-num">1</span>,
    <span class="fm-tok-key">src</span>: <span class="fm-tok-str">'my-client'</span>,
    <span class="fm-tok-key">dst</span>: <span class="fm-tok-str">'FLEET_MANAGER'</span>,
    <span class="fm-tok-key">method</span>: <span class="fm-tok-str">'device.List'</span>,
    <span class="fm-tok-key">params</span>: { <span class="fm-tok-key">limit</span>: <span class="fm-tok-num">25</span> }
  }));
};

ws.onmessage = (evt) =&gt; {
  <span class="fm-tok-kw">const</span> msg = JSON.parse(evt.data);
  <span class="fm-tok-com">// { id, result: { items: [...], total, has_more } }</span>
};</pre></div>
      </div>
    </section>`;

export const SECTION_MCP_HTML = `    <section id="mcp" class="fm-panel">
      <div class="fm-panel-head">
        <p class="fm-panel-eyebrow">MCP</p>
        <h2>The same API, for AI agents.</h2>
        <p>Fleet Manager speaks <strong>Model Context Protocol</strong> at <code>/mcp</code>. An agent connects once and gets the whole surface as tools, with the same permissions as the user whose key it holds. There is no second API and no separate permission model.</p>
      </div>
      <div class="fm-panel-split">
        <div class="fm-panel-body">
          <p><strong>Reading</strong> — <code>fm_read</code> runs any read-only method. Results are redacted and row-capped; follow the cursor when one comes back. Device firmware methods and raw RPC tunnels are refused.</p>
          <p><strong>Writing</strong> — <code>fm_write</code> defaults to <code>mode:"prepare"</code>, which previews the change in plain language. Additive writes can run straight away with <code>mode:"execute"</code>. Anything destructive returns <code>confirmation_required</code> plus a single-use token, and only <code>fm_confirm_write</code> can spend it, on the exact user, method and params it was issued for.</p>
          <p><strong>Starting cold</strong> — <code>fm_situation</code> groups causes rather than symptoms, so a whole site going dark reads as one problem instead of twelve offline devices.</p>
          <p><strong>Finding things</strong> — <code>find_place</code> turns "the kitchen" or "Store 12" into an id and a scope. It refuses to guess when two places share a name.</p>
          <p><span class="fm-pill">Capability level</span> &nbsp; A scoped key carries <code>read</code>, <code>write</code> or <code>full</code>. Device firmware and sensitive namespaces need <code>full</code>. The level can only narrow the user's own RBAC, never widen it.</p>
        </div>
        <div class="fm-codeblock">
          <pre><span class="fm-tok-com">// Preview first — this is the default</span>
{ <span class="fm-tok-key">"tool"</span>: <span class="fm-tok-str">"fm_write"</span>,
  <span class="fm-tok-key">"method"</span>: <span class="fm-tok-str">"group.Delete"</span>,
  <span class="fm-tok-key">"params"</span>: { <span class="fm-tok-key">"id"</span>: <span class="fm-tok-num">42</span> } }

<span class="fm-tok-com">// → destructive, so it comes back to be confirmed</span>
{ <span class="fm-tok-key">"status"</span>: <span class="fm-tok-str">"confirmation_required"</span>,
  <span class="fm-tok-key">"summary"</span>: <span class="fm-tok-str">"Delete group Warehouse (8 devices)"</span>,
  <span class="fm-tok-key">"confirmationToken"</span>: <span class="fm-tok-str">"..."</span> }

<span class="fm-tok-com">// A human approves, then the token is spent once</span>
{ <span class="fm-tok-key">"tool"</span>: <span class="fm-tok-str">"fm_confirm_write"</span>,
  <span class="fm-tok-key">"confirmationToken"</span>: <span class="fm-tok-str">"..."</span> }</pre>
        </div>
      </div>
    </section>`;

export const SECTION_RESOURCES_HTML = `    <section id="resources" class="fm-panel">
      <div class="fm-panel-head">
        <p class="fm-panel-eyebrow">SDKs &amp; Resources</p>
        <h2>Spec downloads &amp; integration tooling.</h2>
        <p>This page is self-contained — the OpenAPI 3.1 spec is embedded. The same spec is available as a live JSON endpoint for any tool that consumes OpenAPI.</p>
      </div>
      <div class="fm-res-grid">
        <a class="fm-res-card" href="/api/docs/openapi.json">
          <div class="fm-res-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h7l5 5v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM14 2v6h6"/></svg></div>
          <div class="fm-res-title">OpenAPI 3.1 spec (live)</div>
          <div class="fm-res-desc">Always-fresh spec served from this deployment, with <code>servers</code> rewritten to the current host.</div>
          <div class="fm-res-link">openapi.json <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></div>
        </a>
        <a class="fm-res-card" href="https://www.postman.com/" target="_blank" rel="noopener">
          <div class="fm-res-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM12 8v8M8 12h8"/></svg></div>
          <div class="fm-res-title">Postman / Insomnia</div>
          <div class="fm-res-desc">Import the OpenAPI URL above into Postman or Insomnia to get a full collection — every operation, with example payloads.</div>
          <div class="fm-res-link">How to import <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></div>
        </a>
        <a class="fm-res-card" href="#reference">
          <div class="fm-res-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18 22 12 16 6M8 6 2 12 8 18"/></svg></div>
          <div class="fm-res-title">Client SDKs</div>
          <div class="fm-res-desc">Generate a typed client in your language with <code>openapi-generator</code> from the spec above. First-party SDKs are on the roadmap.</div>
          <div class="fm-res-link">Browse reference <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></div>
        </a>
      </div>
    </section>`;

export const SECTION_SPLASH_HTML = `  <div id="fm-splash" role="status">
    <div class="fm-splash-brand">Fleet Manager <span>API</span></div>
    <div class="fm-splash-spinner" aria-hidden="true"></div>
    <div class="fm-splash-hint">Loading reference&hellip;</div>
  </div>`;
