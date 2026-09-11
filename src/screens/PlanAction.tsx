import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { call, writeCall } from "../api";
import { Plan, PlanMode, productCode, productName } from "../nav";
import { C, F } from "../theme";
import { BtnBig, Card, CardH3, Empty, FieldInput, InputLabel, Meta, PickRow, Spinner } from "../ui";

type Applicator = { name: string; employee_name: string };

const STATUS_LABELS: Record<string, string> = {
  Draft: "📝 Draft — not yet submitted for approval.",
  "Pending Approval": "⏳ Pending approval — waiting for the farm manager.",
  Approved: "✅ Approved — waiting for the store to issue the fertilizer.",
  Issued: "📦 Issued — collect it from the store and record the application.",
  Rejected: "❌ Rejected — raise a new request if it is still needed.",
  Cancelled: "🚫 Cancelled — raise a new one if it is still needed.",
};

export default function PlanAction({
  plan, mode, onBack, toast,
}: {
  plan: Plan;
  mode: PlanMode;
  onBack: () => void;
  toast: (m: string) => void;
}) {
  if (mode === "status") {
    return (
      <Card>
        <CardH3>{plan.block} · {productName(plan)}</CardH3>
        <Meta>{productCode(plan)}</Meta>
        <Meta>{STATUS_LABELS[plan.request_status ?? ""] ?? plan.request_status}</Meta>
        <BtnBig label="Back" kind="grey" onPress={onBack} />
      </Card>
    );
  }
  if (mode === "request") return <RequestForm plan={plan} onBack={onBack} toast={toast} />;
  return <RecordFlow plan={plan} onBack={onBack} toast={toast} />;
}

/* ------------------------------------------------------------- Request */

function RequestForm({ plan, onBack, toast }: { plan: Plan; onBack: () => void; toast: (m: string) => void }) {
  const [qty, setQty] = useState(String(plan.total_kg_required ?? ""));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await writeCall<{ name: string }>("create_store_request", {
        block_fertilizer_plan: plan.name, quantity: qty,
      });
      toast("Request sent: " + r.name);
      onBack();
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message);
      if (err.queued) onBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardH3>Request {productName(plan)}</CardH3>
      <Meta>{productCode(plan)} · {plan.block} · {plan.application_month}</Meta>
      <InputLabel>Quantity to request (Kg)</InputLabel>
      <FieldInput value={qty} onChangeText={setQty} keyboardType="numeric" />
      <BtnBig label="Send request to store" kind="ink" onPress={submit} disabled={busy} />
    </Card>
  );
}

/* -------------------------------------------------------------- Record */

function RecordFlow({ plan, onBack, toast }: { plan: Plan; onBack: () => void; toast: (m: string) => void }) {
  const [roster, setRoster] = useState<Applicator[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [step, setStep] = useState<"who" | "qty">("who");
  const [search, setSearch] = useState("");

  useEffect(() => {
    call<Applicator[]>("get_applicators_for_block", { block: plan.block })
      .then((r) => {
        const list = r ?? [];
        setRoster(list);
        // Everyone assigned to the block is pre-selected - the common case is
        // that the whole assigned crew applied it.
        setSelected(list.map((a) => a.name));
      })
      .catch(() => setRoster([]));
  }, [plan.block]);

  if (roster === null) return <Card><Spinner text="Loading applicators…" /></Card>;

  if (step === "qty") {
    return <RecordForm plan={plan} operators={selected} onBack={onBack} toast={toast} />;
  }

  if (!roster.length) {
    return (
      <Card>
        <CardH3>Who applied this?</CardH3>
        <Empty>
          No applicators are assigned to {plan.block} yet. Assign some under Manage Team,
          or continue without selecting anyone.
        </Empty>
        <BtnBig label="Continue" kind="warn" onPress={() => setStep("qty")} />
      </Card>
    );
  }

  const rows = roster.filter((a) => a.employee_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card>
      <CardH3>Who applied this?</CardH3>
      <Meta>
        {plan.block} · {productName(plan)} · everyone assigned to this block is
        pre-selected — adjust if needed
      </Meta>
      {roster.length > 6 && (
        <FieldInput placeholder="Search applicators…" value={search} onChangeText={setSearch} />
      )}
      {rows.length === 0 ? (
        <Empty>No matches.</Empty>
      ) : (
        rows.map((a) => (
          <PickRow
            key={a.name}
            label={a.employee_name}
            selected={selected.includes(a.name)}
            showCheck
            showInitial
            onPress={() =>
              setSelected((cur) =>
                cur.includes(a.name) ? cur.filter((n) => n !== a.name) : [...cur, a.name]
              )
            }
          />
        ))
      )}
      <BtnBig
        kind="warn"
        disabled={selected.length === 0}
        onPress={() => setStep("qty")}
        label={selected.length ? `Continue (${selected.length} selected)` : "Select at least one applicator"}
      />
    </Card>
  );
}

function RecordForm({
  plan, operators, onBack, toast,
}: {
  plan: Plan; operators: string[]; onBack: () => void; toast: (m: string) => void;
}) {
  const [qty, setQty] = useState(String(plan.total_kg_required ?? ""));
  const [full, setFull] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!full && !reason.trim()) { toast("Please give a reason"); return; }
    setBusy(true);
    try {
      // The web page refuses to record against a block the store has not
      // fully issued - the same guard belongs here.
      const sr = await call<string | null>("get_issued_request_for_plan", {
        block_fertilizer_plan: plan.name,
      });
      if (!sr) {
        toast("No fully-issued store request found for this block — check Store Requests before recording.");
        return;
      }
      const r = await writeCall<{ name: string }>("record_application", {
        block_fertilizer_plan: plan.name,
        actual_quantity: qty,
        applied_in_full: full ? 1 : 0,
        partial_reason: full ? "" : reason,
        store_request: sr,
        operators,
      });
      toast("Application recorded: " + r.name);
      onBack();
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message);
      if (err.queued) onBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardH3>Record {productName(plan)}</CardH3>
      <Meta>
        {productCode(plan)} · {plan.block} · {plan.application_month} · {plan.total_kg_required} Kg planned
      </Meta>
      <InputLabel>Actual quantity applied (Kg)</InputLabel>
      <FieldInput value={qty} onChangeText={setQty} keyboardType="numeric" />

      <Pressable style={s.toggleRow} onPress={() => setFull((v) => !v)}>
        <Feather
          name={full ? "check-square" : "square"}
          size={22}
          color={full ? C.ink : C.inkFaint}
        />
        <Text style={s.toggleLabel}>Applied in full</Text>
      </Pressable>

      {!full && (
        <View>
          <InputLabel>Reason it was not done in full</InputLabel>
          <FieldInput placeholder="e.g. ran out of stock" value={reason} onChangeText={setReason} />
        </View>
      )}

      <BtnBig label="Submit application" kind="warn" onPress={submit} disabled={busy} />
    </Card>
  );
}

const s = StyleSheet.create({
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 14 },
  toggleLabel: { fontFamily: F.regular, fontSize: 14, color: C.ink3 },
});
