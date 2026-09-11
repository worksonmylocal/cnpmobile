/** Mirrors the VIEWS and TITLES tables in field.html. */
export const VIEWS = [
  "home", "blocks", "upcoming", "section-plans", "plan-action", "store-requests",
  "team", "applicator-detail", "pick-section", "pick-block", "add-employee",
  "record-section", "record-block", "record-plans", "correction",
] as const;

export type View = (typeof VIEWS)[number];

export const TITLES: Record<View, string> = {
  home: "Home",
  blocks: "All Blocks",
  upcoming: "Upcoming Applications",
  "section-plans": "Section",
  "plan-action": "Application",
  "store-requests": "Store Requests",
  team: "Manage Team",
  "applicator-detail": "Applicator",
  "pick-section": "Choose Section",
  "pick-block": "Choose Block",
  "add-employee": "Choose Applicator",
  "record-section": "Record Application",
  "record-block": "Choose Block",
  "record-plans": "Choose Product",
  correction: "Correction",
};

/** The drawer, in field.html's order. */
export const DRAWER: { view: View; icon: string; label: string }[] = [
  { view: "home", icon: "🏠", label: "Home" },
  { view: "blocks", icon: "🧱", label: "All Blocks" },
  { view: "upcoming", icon: "⏳", label: "Upcoming Applications" },
  { view: "store-requests", icon: "📦", label: "Store Requests" },
  { view: "team", icon: "👷", label: "Manage Team" },
  { view: "record-section", icon: "📝", label: "Record Application" },
  { view: "correction", icon: "🛠️", label: "Correction" },
];

export type Plan = {
  name: string;
  block: string;
  status?: string;
  request_status?: string;
  fertilizer_product?: string;
  fertilizer_product_name?: string;
  application_month?: string;
  total_kg_required?: number;
};

/**
 * Item codes are what the store runs on but mean nothing to a supervisor,
 * so lead with the fertilizer name and keep the code beside it.
 */
export const productName = (p?: Partial<Plan>) =>
  (p && (p.fertilizer_product_name || p.fertilizer_product)) || "";
export const productCode = (p?: Partial<Plan>) => (p && p.fertilizer_product) || "";

export type PlanMode = "status" | "request" | "record";

/** Where a flow returns to when it finishes or backs out. */
export type NavState = {
  view: View;
  section?: string | null;
  plan?: Plan | null;
  planMode?: PlanMode;
  planReturn?: View;
  applicator?: string | null;
  pickPurpose?: "add" | "reassign";
  pickedSection?: string | null;
  pickedBlock?: string | null;
  reassignEmployee?: string | null;
  addEmployeeReturn?: View;
  recordSection?: string | null;
  recordPlans?: Plan[];
};
