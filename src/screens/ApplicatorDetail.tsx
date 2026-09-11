import { useEffect, useState } from "react";
import {  } from "react-native";
import { call, writeCall } from "../api";
import { C, F } from "../theme";
import { BtnBig, Card, CardH3, Meta, Spinner, Text } from "../ui";
import { Applicator } from "./Team";

type Stats = { applications: number; total_kg: number };

export default function ApplicatorDetail({
  applicator, onReassign, onDone, toast,
}: {
  applicator: Applicator;
  onReassign: (employee: string) => void;
  onDone: () => void;
  toast: (m: string) => void;
}) {
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<Stats[]>("get_operator_activity", { employees: [applicator.name], group_by: "operator" })
      .then((d) => setStats((d ?? [])[0] ?? null))
      .catch(() => setStats(null));
  }, [applicator.name]);

  async function remove() {
    setBusy(true);
    try {
      await writeCall("remove_applicator", { employee: applicator.name });
      toast("Removed from your team");
      onDone();
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message);
      if (err.queued) onDone();
    } finally {
      setBusy(false);
    }
  }

  if (stats === undefined) return <Card><Spinner /></Card>;

  return (
    <Card>
      <CardH3>{applicator.employee_name}</CardH3>
      <Meta>
        {applicator.custom_assigned_block
          ? "📍 " + applicator.custom_assigned_block
          : "No block assigned"}
      </Meta>
      <Text style={{ fontFamily: F.regular, fontSize: 13, color: C.ink4, marginBottom: 6 }}>
        {stats
          ? `${stats.applications} application${stats.applications === 1 ? "" : "s"} recorded · ${stats.total_kg.toLocaleString()} Kg total`
          : "No applications recorded yet."}
      </Text>
      <BtnBig label="Reassign block" kind="ink" onPress={() => onReassign(applicator.name)} />
      <BtnBig label="Remove from team" kind="bad" onPress={remove} disabled={busy} />
    </Card>
  );
}
