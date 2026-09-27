# ShiftOps read-only mirror

This Edge Function runs in the isolated client-portal Supabase project. It:

- authenticates the portal user against the isolated project;
- resolves the client account through destination RLS;
- reads only the permitted outlet rows from Daily Ops `public.shifts`;
- writes only to the isolated `client_portal_shifts` mirror; and
- never sends client credentials to Daily Ops.

Required server-side secrets:

- `SHIFTOPS_SUPABASE_URL`
- `SHIFTOPS_SERVICE_ROLE_KEY`

The source key must never be placed in `index.html`, browser storage, or a public
repository. The source client in `index.ts` is intentionally used only with
`.from("shifts").select(...)`.

Deploy with JWT verification enabled. Do not use `--no-verify-jwt`.

