// Side-effect-only polyfill module — imported first by app.ts so the global
// is in place before any decorator-using module loads. Node 22 LTS still
// lacks Symbol.metadata; tc39 stage-3 decorators read it through this slot.

// @ts-expect-error read-only at the type level but populated at runtime here.
Symbol.metadata ??= Symbol('Symbol.metadata');
