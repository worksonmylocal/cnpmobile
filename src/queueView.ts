import { useEffect, useState } from "react";
import { currentUser, queue } from "./core";
import type { QItem } from "./queue";

/** Waiting work, in words a supervisor would use. */
export function describeItem(i: QItem): string {
  const m = (i.meta ?? {}) as Record<string, any>;
  const where = m.block ? ` - ${m.block}` : "";
  switch (i.method) {
    case "mark_attendance": return `Attendance marked ${i.args.status === "Present" ? "In" : "Out"}${m.name ? " - " + m.name : ""}`;
    case "create_store_request": return `Store request${m.product_name ? " for " + m.product_name : ""}${where}`;
    case "record_application": return `Application recorded${m.product_name ? " - " + m.product_name : ""}${where}`;
    case "add_applicators": return `Added ${Array.isArray(i.args.employees) ? i.args.employees.length : ""} applicator(s) to the team`;
    case "remove_applicator": return "Removed an applicator from the team";
    case "assign_block": return "Changed an applicator's block";
    default: return i.method.replace(/_/g, " ");
  }
}

/** The signed-in user's unsent and failed items, kept live. */
export function useQueueItems(): { pending: QItem[]; failed: QItem[] } {
  const [v, setV] = useState<{ pending: QItem[]; failed: QItem[] }>({ pending: [], failed: [] });
  useEffect(() => {
    const read = () => {
      const u = currentUser();
      setV({ pending: u ? queue.pending(u) : [], failed: u ? queue.failed(u) : [] });
    };
    queue.load(currentUser() ?? undefined).then(read);
    return queue.subscribe(read);
  }, []);
  return v;
}
