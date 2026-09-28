import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://www.anytimeanywork.com",
  "http://127.0.0.1:4174",
]);

function corsHeadersFor(request: Request): Record<string, string> {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : "https://www.anytimeanywork.com";
  return {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  };
}

type PortalAccount = {
  legacy_client_id: string;
  outlets: string[] | null;
};

type SourceShift = {
  id: string;
  shift_date: string;
  worker_name: string | null;
  outlet: string;
  role: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  rate: number | null;
  clock_in: string | null;
  clock_out: string | null;
  cancelled: boolean | null;
  updated_at: string | null;
  break_mins: number | null;
  country: string | null;
  ot_approved: boolean | null;
  ot_end: string | null;
  arrived_on_time: boolean | null;
};

function response(request: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeadersFor(request) });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

function normalizeOutlet(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(request) });
  }
  if (request.method !== "POST") {
    return response(request, 405, { ok: false, error: "Method not allowed" });
  }

  const runId = crypto.randomUUID();
  let destinationAdmin: ReturnType<typeof createClient> | null = null;
  let requestedClientId: string | null = null;
  let requesterId: string | null = null;

  try {
    const destinationUrl = requiredEnv("SUPABASE_URL");
    const destinationAnonKey = requiredEnv("SUPABASE_ANON_KEY");
    const destinationServiceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const sourceUrl = requiredEnv("SHIFTOPS_SUPABASE_URL");
    const sourceServiceKey = requiredEnv("SHIFTOPS_SERVICE_ROLE_KEY");

    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return response(request, 401, { ok: false, error: "Authentication required" });

    const destinationUser = createClient(destinationUrl, destinationAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    destinationAdmin = createClient(destinationUrl, destinationServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await destinationUser.auth.getUser(token);
    if (userError || !userData.user) {
      return response(request, 401, { ok: false, error: "Invalid session" });
    }
    requesterId = userData.user.id;

    let payload: { client_id?: unknown } = {};
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }
    requestedClientId = typeof payload.client_id === "string" && payload.client_id.trim()
      ? payload.client_id.trim()
      : null;

    const { data: isAdmin, error: adminCheckError } = await destinationUser.rpc(
      "is_client_portal_admin",
    );
    if (adminCheckError) throw adminCheckError;

    if (!requestedClientId && !isAdmin) {
      return response(request, 403, { ok: false, error: "A client account is required" });
    }

    let accountsQuery = destinationUser
      .from("client_portal_accounts")
      .select("legacy_client_id,outlets");

    if (!isAdmin) {
      accountsQuery = accountsQuery
        .eq("access_enabled", true)
        .eq("email_status", "verified");
    }

    if (requestedClientId) {
      accountsQuery = accountsQuery.eq("legacy_client_id", requestedClientId);
    } else if (!isAdmin) {
      return response(request, 403, { ok: false, error: "Portal administrator access required" });
    }

    const { data: accountRows, error: accountsError } = await accountsQuery;
    if (accountsError) throw accountsError;
    const accounts = (accountRows || []) as PortalAccount[];
    if (!accounts.length) {
      return response(request, 403, { ok: false, error: "No permitted client account found" });
    }

    // Avoid hammering Daily Ops if a user reloads repeatedly.
    const cooldownCutoff = new Date(Date.now() - 30_000).toISOString();
    let recentRunQuery = destinationAdmin
      .from("client_portal_sync_runs")
      .select("id,completed_at")
      .eq("status", "completed")
      .gte("completed_at", cooldownCutoff)
      .order("completed_at", { ascending: false })
      .limit(1);
    recentRunQuery = requestedClientId
      ? recentRunQuery.eq("requested_client_id", requestedClientId)
      : recentRunQuery.is("requested_client_id", null);
    const { data: recentRun } = await recentRunQuery.maybeSingle();
    if (recentRun) {
      return response(request, 200, { ok: true, cached: true, synced_at: recentRun.completed_at });
    }

    await destinationAdmin.from("client_portal_sync_runs").insert({
      id: runId,
      requested_client_id: requestedClientId,
      requested_by: requesterId,
      status: "running",
    });

    const accountsByOutlet = new Map<string, PortalAccount[]>();
    for (const account of accounts) {
      for (const outlet of account.outlets || []) {
        const key = normalizeOutlet(outlet);
        const list = accountsByOutlet.get(key) || [];
        list.push(account);
        accountsByOutlet.set(key, list);
      }
    }
    const outletNames = Array.from(
      new Set(accounts.flatMap((account) => (account.outlets || []).map((outlet) => outlet.trim()))),
    ).filter(Boolean);

    if (!outletNames.length) {
      await destinationAdmin.from("client_portal_sync_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", runId);
      return response(request, 200, { ok: true, source_rows: 0, mirrored_rows: 0, removed_rows: 0 });
    }

    // This client is created only for SELECT calls. No source mutation method is
    // used anywhere in this function.
    const source = createClient(sourceUrl, sourceServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const sourceColumns = [
      "id", "shift_date", "worker_name", "outlet", "role", "scheduled_start",
      "scheduled_end", "rate", "clock_in", "clock_out", "cancelled", "updated_at",
      "break_mins", "country", "ot_approved", "ot_end", "arrived_on_time",
    ].join(",");

    // Client invoicing is separate from worker payroll. The shifts.is_paid
    // column means the worker was paid, so it must never drive the client
    // portal's Paid/Due badge. ShiftOps records per-shift client billing in
    // app_settings.billing_invoiced_shifts, keyed by the shift UUID.
    const { data: billedLedgerRow, error: billedLedgerError } = await source
      .from("app_settings")
      .select("value")
      .eq("key", "billing_invoiced_shifts")
      .maybeSingle();
    if (billedLedgerError) {
      throw new Error(`Daily Ops billing-ledger read failed: ${billedLedgerError.message}`);
    }
    const rawBilledLedger = billedLedgerRow?.value;
    if (!rawBilledLedger || typeof rawBilledLedger !== "object" || Array.isArray(rawBilledLedger)) {
      throw new Error("Daily Ops billing ledger is unavailable; existing mirror was kept");
    }
    const billedShiftIds = new Set(
      Object.entries(rawBilledLedger as Record<string, unknown>)
        .filter(([, mark]) => {
          if (mark === true) return true;
          if (!mark || typeof mark !== "object" || Array.isArray(mark)) return false;
          return (mark as Record<string, unknown>).deleted !== true;
        })
        .map(([shiftId]) => shiftId),
    );

    const sourceShifts: SourceShift[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await source
        .from("shifts")
        .select(sourceColumns)
        .in("outlet", outletNames)
        .order("shift_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Daily Ops read failed: ${error.message}`);
      const page = (data || []) as unknown as SourceShift[];
      sourceShifts.push(...page);
      if (page.length < pageSize) break;
    }

    if (!sourceShifts.length) {
      throw new Error("Daily Ops returned no shifts for the permitted outlets; existing mirror was kept");
    }

    const now = new Date().toISOString();
    const mirrorRows: Record<string, unknown>[] = [];
    for (const shift of sourceShifts) {
      const matchingAccounts = accountsByOutlet.get(normalizeOutlet(shift.outlet)) || [];
      for (const account of matchingAccounts) {
        mirrorRows.push({
          client_id: account.legacy_client_id,
          source_reference: `shiftops:${account.legacy_client_id}:${shift.id}`,
          shift_date: shift.shift_date,
          outlet: shift.outlet,
          worker_name: shift.worker_name,
          role: shift.role,
          scheduled_start: shift.scheduled_start,
          scheduled_end: shift.scheduled_end,
          rate: shift.rate,
          clock_in: shift.clock_in,
          clock_out: shift.clock_out,
          cancelled: shift.cancelled === true,
          break_mins: shift.break_mins,
          country: shift.country,
          ot_approved: shift.ot_approved,
          ot_end: shift.ot_end,
          arrived_on_time: shift.arrived_on_time,
          client_billed: billedShiftIds.has(shift.id),
          source_updated_at: shift.updated_at,
          synced_at: now,
          sync_run_id: runId,
        });
      }
    }

    for (const batch of chunks(mirrorRows, 400)) {
      const { error } = await destinationAdmin
        .from("client_portal_shifts")
        .upsert(batch, { onConflict: "source_reference" });
      if (error) throw new Error(`Portal mirror write failed: ${error.message}`);
    }

    let removedRows = 0;
    for (const account of accounts) {
      const { data: removed, error } = await destinationAdmin
        .from("client_portal_shifts")
        .delete()
        .eq("client_id", account.legacy_client_id)
        .like("source_reference", `shiftops:${account.legacy_client_id}:%`)
        .neq("sync_run_id", runId)
        .select("id");
      if (error) throw new Error(`Portal mirror cleanup failed: ${error.message}`);
      removedRows += removed?.length || 0;
    }

    await destinationAdmin.from("client_portal_sync_runs").update({
      status: "completed",
      source_rows: sourceShifts.length,
      mirrored_rows: mirrorRows.length,
      removed_rows: removedRows,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);

    return response(request, 200, {
      ok: true,
      source_rows: sourceShifts.length,
      mirrored_rows: mirrorRows.length,
      removed_rows: removedRows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected sync failure";
    if (destinationAdmin) {
      await destinationAdmin.from("client_portal_sync_runs").upsert({
        id: runId,
        requested_client_id: requestedClientId,
        requested_by: requesterId,
        status: "failed",
        error_message: message.slice(0, 1000),
        completed_at: new Date().toISOString(),
      });
    }
    console.error("sync-shiftops failed", message);
    return response(request, 500, { ok: false, error: "Shift data refresh failed; cached portal data was kept" });
  }
});
