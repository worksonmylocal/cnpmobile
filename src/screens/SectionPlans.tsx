import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Plan, PlanMode, productCode, productName } from "../nav";
import { C, F, shadowCard } from "../theme";
import { BtnBig, BtnKind, Empty, Pill, PillKind, Select, Spinner } from "../ui";
import { useLoad } from "../useLoad";

/** The status -> pill + action mapping from drawSectionPlans(). */
function planUi(p: Plan): { pill: PillKind; text: string; btn: string; kind: BtnKind; mode: PlanMode } {
  if (p.status === "Issued")
    return { pill: "good", text: "Issued — ready to apply", btn: "Record application", kind: "warn", mode: "record" };
  switch (p.request_status) {
    case "Pending Approval":
      return { pill: "warn", text: "Pending approval", btn: "Show status", kind: "grey", mode: "status" };
    case "Approved":
      return { pill: "info", text: "Approved — awaiting store issue", btn: "Show status", kind: "grey", mode: "status" };
    case "Draft":
      return { pill: "warn", text: "Draft — not submitted", btn: "Show status", kind: "grey", mode: "status" };
    case "Rejected":
      return { pill: "bad", text: "Rejected", btn: "Request again", kind: "ink", mode: "request" };
    case "Cancelled":
      return { pill: "mute", text: "Cancelled", btn: "Request again", kind: "ink", mode: "request" };
    default:
      return { pill: "mute", text: "Planned", btn: "Request from store", kind: "ink", mode: "request" };
  }
}

export default function SectionPlans({
  section, onOpenPlan,
}: {
  section: string;
  onOpenPlan: (plan: Plan, mode: PlanMode) => void;
}) {
  const [blockFilter, setBlockFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const { data, error, loading } = useLoad<Plan[]>("get_pending_plans_for_section", { section });

  const plans = data ?? [];

  // A section can hold dozens of plans across several products, so let the
  // supervisor narrow to the block in front of them or the product they carry.
  const blocks = useMemo(
    () => [...new Set(plans.map((p) => p.block).filter(Boolean))].sort(),
    [plans]
  );
  const products = useMemo(() => {
    const codes = [...new Set(plans.map((p) => productCode(p)).filter(Boolean))];
    return codes
      .map((code) => ({ code, name: productName(plans.find((p) => productCode(p) === code)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [plans]);

  const rows = plans.filter(
    (p) =>
      (!blockFilter || p.block === blockFilter) &&
      (!productFilter || productCode(p) === productFilter)
  );

  return (
    <View>
      <View style={s.titleCard}>
        <Text style={s.titleText}>{section}</Text>
      </View>

      {loading ? (
        <Spinner />
      ) : error ? (
        <Empty>{error}</Empty>
      ) : !plans.length ? (
        <Empty>Nothing pending in this section.</Empty>
      ) : (
        <>
          <View style={s.filterRow}>
            <View style={{ flex: 1 }}>
              <Select
                value={blockFilter}
                onChange={setBlockFilter}
                options={[
                  { value: "", label: `All blocks (${blocks.length})` },
                  ...blocks.map((b) => ({ value: b, label: b })),
                ]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Select
                value={productFilter}
                onChange={setProductFilter}
                options={[
                  { value: "", label: `All products (${products.length})` },
                  ...products.map((p) => ({ value: p.code, label: p.name })),
                ]}
              />
            </View>
          </View>

          {rows.length === 0 ? (
            <Empty>Nothing matches this filter.</Empty>
          ) : (
            rows.map((p) => {
              const ui = planUi(p);
              return (
                <View key={p.name} style={s.planCard}>
                  <Pill kind={ui.pill}>{ui.text}</Pill>
                  <Text style={s.planTitle}>{p.block} · {productName(p)}</Text>
                  <Text style={s.planMeta}>
                    {productCode(p)} · {p.application_month} · {p.total_kg_required} Kg planned
                  </Text>
                  <BtnBig label={ui.btn} kind={ui.kind} onPress={() => onOpenPlan(p, ui.mode)} />
                </View>
              );
            })
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  titleCard: {
    backgroundColor: C.gradInk, borderRadius: 24, paddingVertical: 18,
    paddingHorizontal: 20, marginBottom: 14, ...shadowCard,
  },
  titleText: { fontFamily: F.semibold, fontSize: 16, color: "#fff" },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  planCard: {
    backgroundColor: C.surface2, borderRadius: 24, paddingVertical: 18,
    paddingHorizontal: 20, marginBottom: 10, ...shadowCard,
  },
  planTitle: { fontFamily: F.semibold, fontSize: 16, color: C.ink, marginTop: 8, marginBottom: 4 },
  planMeta: { fontFamily: F.regular, fontSize: 12, color: C.inkMute, marginBottom: 12 },
});
