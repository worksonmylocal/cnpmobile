import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { writeCall } from "../api";
import { productName } from "../nav";
import { useQueueItems } from "../queueView";
import { C, F, shadowCard } from "../theme";
import { BtnBig, Card, CardH3, Empty, FieldInput, InputLabel, Meta, Pill, PillKind, PickRow, Spinner, Text } from "../ui";
import { useLoad } from "../useLoad";

type Kind = "Application" | "Store Request";
type Correctable = {
  name: string; block?: string; quantity: number; date?: string; status?: string;
  fertilizer_product?: string; fertilizer_product_name?: string;
  pending?: boolean; corrected?: boolean | number;
};
type Mine = {
  name: string; request_type: Kind; reference: string; block?: string;
  fertilizer_product?: string; fertilizer_product_name?: string;
  original_quantity: number; corrected_quantity: number; reason: string;
  status: "Pending" | "Approved" | "Rejected"; review_note?: string | null;
  replaced_by?: string | null; reviewed_on?: string | null; requested_on?: string | null;
  waiting?: boolean;
};

const pillFor = (s: string): PillKind =>
  s === "Approved" ? "good" : s === "Rejected" || s === "Not sent" ? "bad" : s === "Waiting to send" ? "mute" : "warn";
const label = (s: string) => (s === "Pending" ? "Waiting for approval" : s);
const kg = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;

/**
 * Ask for a submitted application or store request to be corrected - say 100 kg
 * was requested but 105 was needed. Nothing changes until the approver says so;
 * this screen shows each request and where it stands, and once it is approved
 * the original is replaced by a record tagged "corrected".
 */
export default function Correction({ toast }: { toast: (m: string) => void }) {
  const items = useLoad<{ applications: Correctable[]; store_requests: Correctable[] }>("get_correctable");
  const mine = useLoad<Mine[]>("get_my_corrections");
  const { pending, failed } = useQueueItems();
  const [kind, setKind] = useState<Kind>("Application");
  const [picked, setPicked] = useState<Correctable | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const waiting = [...pending, ...failed].filter((i) => i.method === "request_correction");
  const waitingRefs = new Set(waiting.map((i) => String(i.args.reference)));
  const waitingRows: Mine[] = waiting.map((i) => ({
    name: "waiting-" + i.args.reference,
    request_type: i.args.request_type as Kind, reference: String(i.args.reference),
    block: (i.meta as any)?.block, fertilizer_product_name: (i.meta as any)?.product_name,
    original_quantity: Number((i.meta as any)?.original ?? 0), corrected_quantity: Number(i.args.corrected_quantity),
    reason: String(i.args.reason ?? ""), status: "Pending", waiting: true,
  }));

  const list = (kind === "Application" ? items.data?.applications : items.data?.store_requests) ?? [];
  const choices = list.filter((r) => !r.pending && !waitingRefs.has(r.name));

  const pick = (r: Correctable) => { setPicked(r); setQty(String(r.quantity)); setReason(""); };

  async function send() {
    if (!picked) return;
    const n = Number(qty);
    if (!(n > 0)) { toast("Enter the correct quantity in kg."); return; }
    if (Math.abs(n - picked.quantity) < 0.005) { toast(`That is the same as the ${kg(picked.quantity)} recorded.`); return; }
    if (!reason.trim()) { toast("Say why it needs correcting."); return; }
    setBusy(true);
    try {
      await writeCall("request_correction", {
        request_type: kind, reference: picked.name, corrected_quantity: n, reason: reason.trim(),
      }, { meta: { block: picked.block, product_name: productName(picked), original: picked.quantity } });
      toast("Sent - waiting for approval.");
      setPicked(null);
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message || "Could not send the request.");
      if (err.queued) setPicked(null);
    } finally { setBusy(false); }
  }

  const history = [...waitingRows, ...(mine.data ?? [])];

  return (
    <View>
      <Card>
        <CardH3>Ask for a correction</CardH3>
        <Meta>Pick the record, enter the right quantity and why. The approver decides; the record changes only once they approve.</Meta>
        <View style={s.seg}>
          {(["Application", "Store Request"] as Kind[]).map((k) => (
            <Pressable key={k} style={[s.segBtn, kind === k && s.segOn]} onPress={() => { setKind(k); setPicked(null); }}>
              <Text style={[s.segText, kind === k && s.segTextOn]}>{k === "Application" ? "Applications" : "Store requests"}</Text>
            </Pressable>
          ))}
        </View>

        {items.loading ? <Spinner /> : items.error && !items.data ? <Empty>{items.error}</Empty> : picked ? (
          <View style={{ marginTop: 10 }}>
            <Text style={s.name}>{picked.block || "—"} · {productName(picked)}</Text>
            <Meta>{picked.date || ""}{picked.status ? ` · ${picked.status}` : ""} · currently {kg(picked.quantity)}</Meta>
            <InputLabel>Correct quantity (kg)</InputLabel>
            <FieldInput value={qty} onChangeText={setQty} keyboardType="numeric" />
            <InputLabel>Reason</InputLabel>
            <FieldInput placeholder="e.g. weighed again, 105 kg went on" value={reason} onChangeText={setReason} />
            <BtnBig label="Send for approval" kind="ink" onPress={send} disabled={busy} />
            <BtnBig label="Choose a different one" kind="grey" onPress={() => setPicked(null)} />
          </View>
        ) : choices.length === 0 ? (
          <Empty>{kind === "Application"
            ? "No recorded applications in the last 45 days that can be corrected."
            : "No store requests that can still be corrected. Once the store has issued one it can't be changed here."}</Empty>
        ) : (
          <View style={{ marginTop: 6 }}>
            {choices.map((r) => (
              <PickRow key={r.name} label={`${r.block || "—"} · ${productName(r)}`}
                sub={`${kg(r.quantity)}${r.date ? " · " + r.date : ""}${r.corrected ? " · already corrected" : ""}`}
                onPress={() => pick(r)} />
            ))}
          </View>
        )}
      </Card>

      <Text style={s.h}>My correction requests</Text>
      {mine.loading && !history.length ? <Spinner /> : !history.length ? (
        <Empty>You haven't asked for any corrections.</Empty>
      ) : history.map((m) => (
        <View key={m.name} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{m.block || "—"} · {productName(m)}</Text>
            <Text style={s.meta}>
              {m.request_type} · {kg(m.original_quantity)} → <Text style={s.bold}>{kg(m.corrected_quantity)}</Text>
            </Text>
            <Text style={s.meta}>{m.reason}</Text>
            {m.status === "Approved" && m.replaced_by ? <Text style={s.meta}>Replaced by {m.replaced_by} (corrected)</Text> : null}
            {m.status === "Rejected" && m.review_note ? <Text style={s.meta}>Reason: {m.review_note}</Text> : null}
          </View>
          <Pill kind={pillFor(m.waiting ? "Waiting to send" : m.status)}>{m.waiting ? "Waiting to send" : label(m.status)}</Pill>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 6 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: C.grey, alignItems: "center" },
  segOn: { backgroundColor: C.ink },
  segText: { fontFamily: F.semibold, fontSize: 12.5, color: C.ink3 },
  segTextOn: { color: C.onInk },
  h: { fontFamily: F.semibold, fontSize: 13, color: C.ink, marginTop: 18, marginBottom: 10 },
  row: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10,
    paddingVertical: 14, paddingHorizontal: 16, backgroundColor: C.surface2, borderRadius: 14, marginBottom: 8, ...shadowCard,
  },
  name: { fontFamily: F.semibold, fontSize: 13, color: C.ink },
  meta: { fontFamily: F.regular, fontSize: 11, color: C.inkMute, marginTop: 2 },
  bold: { fontFamily: F.semibold, color: C.ink },
});
