/**
 * What the screens should show for work that has been done but not yet
 * confirmed by the server.
 *
 * A supervisor who marks attendance, asks for fertilizer or records an
 * application with no signal expects the screen to remember it - the round
 * should leave the "ready to record" list, the request should appear, the
 * person should read "In". So every read has the waiting work laid over it.
 *
 * It is applied when data is READ and never written back into the saved copy.
 * The saved copy stays exactly what the server said, so there is nothing to
 * undo if an item is later refused, and the moment the server has it the
 * overlay simply stops applying.
 *
 * Pure functions: data in, new data out.
 */

export type OverlayItem = {
  method: string;
  args: Record<string, any>;
  meta?: Record<string, any>;
};

const clone = <T,>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));

function patchAttendanceGroups(groups: any[], employee: string, status: string) {
  for (const g of groups) {
    for (const a of g.applicators || []) if (a.name === employee) a.status = status;
    g.present = (g.applicators || []).filter((a: any) => a.status === "Present").length;
    g.absent = (g.applicators || []).filter((a: any) => a.status === "Absent").length;
    g.unmarked = (g.applicators || []).filter((a: any) => !a.status).length;
  }
}

function dropPlan(plans: any[], plan: string) {
  return plans.filter((p) => p.name !== plan);
}

function decrement(rows: any[], key: string, value: string, countField: string) {
  return rows
    .map((r) => (r[key] === value ? { ...r, [countField]: (r[countField] || 0) - 1 } : r))
    .filter((r) => (r[countField] ?? 1) > 0);
}

function metricsAfterRecord(m: any) {
  const out = { ...m };
  out.pending_applications = Math.max(0, (m.pending_applications || 0) - 1);
  out.ready_to_record = Math.max(0, (m.ready_to_record || 0) - 1);
  out.applied = (m.applied || 0) + 1;
  out.my_applications = (m.my_applications || 0) + 1;
  out.applications_today = (m.applications_today || 0) + 1;
  out.progress_pct = out.total_plans ? Math.round((out.applied / out.total_plans) * 1000) / 10 : m.progress_pct;
  return out;
}

/** Lay `items` (oldest first) over one saved/fetched answer. */
export function applyOverlay(method: string, args: Record<string, any>, data: any, items: OverlayItem[]): any {
  if (!items.length || data == null) return data;
  let out = clone(data);

  for (const it of items) {
    const a = it.args || {};
    const m = it.meta || {};

    if (it.method === "mark_attendance") {
      if (method === "get_attendance_by_block" && Array.isArray(out)) patchAttendanceGroups(out, a.employee, a.status);
      if (method === "get_my_applicators_by_section" && Array.isArray(out)) {
        for (const s of out) for (const b of s.blocks || []) for (const p of b.applicators || [])
          if (p.name === a.employee) p.attendance_status = a.status;
      }
    }

    if (it.method === "create_store_request") {
      if ((method === "get_pending_plans_for_section" || method === "get_pending_plans_for_block") && Array.isArray(out)) {
        for (const p of out) if (p.name === a.block_fertilizer_plan) {
          p.request_status = "Pending Approval";
          p.request_name = p.request_name || "waiting to send";
        }
      }
      if (method === "get_home_metrics") out.pending_requests = (out.pending_requests || 0) + 1;
    }

    if (it.method === "record_application") {
      const plan = a.block_fertilizer_plan;
      if ((method === "get_pending_plans_for_section" || method === "get_pending_plans_for_block") && Array.isArray(out))
        out = dropPlan(out, plan);
      if (method === "get_sections_with_pending_work" && m.section && Array.isArray(out))
        out = decrement(out, "section", m.section, "pending_count");
      if (method === "get_sections_with_issued_work" && m.section && Array.isArray(out))
        out = decrement(out, "section", m.section, "pending_count");
      if (method === "get_issued_blocks_in_section" && m.section && args.section === m.section && Array.isArray(out))
        out = decrement(out, "block", m.block, "issued_count");
      if (method === "get_home_metrics") out = metricsAfterRecord(out);
    }
  }
  return out;
}

/** Requests raised on the phone that the server hasn't seen yet, shaped like
 *  the rows of the Store Requests list. */
export function waitingStoreRequests(items: Array<OverlayItem & { createdAt?: number; status?: string }>): any[] {
  return items
    .filter((i) => i.method === "create_store_request")
    .map((i) => ({
      name: "waiting-" + (i.args.block_fertilizer_plan || ""),
      block: i.meta?.block ?? null,
      fertilizer_product: i.meta?.product ?? null,
      fertilizer_product_name: i.meta?.product_name ?? i.meta?.product ?? null,
      date: i.meta?.date ?? null,
      status: i.status === "failed" ? "Not sent" : "Waiting to send",
      waiting: true,
    }))
    .reverse();
}
