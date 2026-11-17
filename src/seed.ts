/**
 * Turn the server's one-call bootstrap into the saved answers the screens
 * would otherwise have fetched one by one.
 *
 * Each entry is stored under the same method name and arguments a screen uses
 * when it asks, so opening a screen finds its data already there - including
 * with no signal at all. `fold` adds the selected programme to the arguments
 * exactly as every real call does, so the keys line up.
 */

export type Seed = { method: string; args: Record<string, unknown>; value: unknown };
export type Fold = (args?: Record<string, unknown>) => Record<string, unknown>;

export function seedsFromBootstrap(b: any, fold: Fold): Seed[] {
  const out: Seed[] = [];
  const add = (method: string, args: Record<string, unknown>, value: unknown) => {
    if (value !== undefined && value !== null) out.push({ method, args: fold(args), value });
  };

  add("get_field_programmes", {}, b.programmes);
  add("get_home_metrics", {}, b.home);
  add("get_upcoming_and_overdue", {}, b.upcoming);
  add("get_block_progress", {}, b.block_progress);
  add("get_store_requests", {}, b.store_requests);
  add("get_my_applicators_by_section", {}, b.applicators_by_section);
  add("get_attendance_by_block", {}, b.attendance);
  add("get_sections_with_pending_work", {}, b.sections_pending);
  add("get_sections_with_issued_work", {}, b.sections_issued);
  add("get_all_sections", {}, b.sections_all);

  // Plans arrive grouped by section. The block-level list the Record flow asks
  // for is the same plans, narrowed to one block.
  const byBlock: Record<string, any[]> = {};
  for (const [section, plans] of Object.entries<any[]>(b.plans_by_section || {})) {
    add("get_pending_plans_for_section", { section }, plans);
    for (const p of plans) (byBlock[p.block] ||= []).push(p);
  }
  for (const [block, plans] of Object.entries(byBlock)) add("get_pending_plans_for_block", { block }, plans);

  for (const [section, blocks] of Object.entries(b.issued_blocks_by_section || {})) add("get_issued_blocks_in_section", { section }, blocks);
  for (const [section, blocks] of Object.entries(b.blocks_by_section || {})) add("get_blocks_in_section", { section }, blocks);
  for (const [block, crew] of Object.entries(b.applicators_by_block || {})) add("get_applicators_for_block", { block }, crew);
  for (const [plan, request] of Object.entries(b.issued_request_by_plan || {})) {
    out.push({ method: "get_issued_request_for_plan", args: fold({ block_fertilizer_plan: plan }), value: request ?? null });
  }
  return out;
}
