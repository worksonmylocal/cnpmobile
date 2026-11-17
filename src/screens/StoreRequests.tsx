import { StyleSheet, View } from "react-native";
import { productCode, productName } from "../nav";
import { useQueueItems } from "../queueView";
import { waitingStoreRequests } from "../overlay";
import { C, F, shadowCard } from "../theme";
import { Empty, Pill, PillKind, Spinner, Text } from "../ui";
import { useLoad } from "../useLoad";

type Req = {
  name?: string; block?: string; status: string; date?: string; waiting?: boolean;
  fertilizer_product?: string; fertilizer_product_name?: string;
};

const pillFor = (s: string): PillKind =>
  s === "Issued" ? "good"
    : s === "Approved" ? "info"
      : s === "Rejected" || s === "Not sent" ? "bad"
        : s === "Cancelled" || s === "Draft" || s === "Waiting to send" ? "mute"
          : "warn";

/**
 * The store requests this supervisor raised - only theirs - with the ones
 * still waiting to send at the top, so a request made with no signal is
 * visibly there rather than apparently lost.
 */
export default function StoreRequests() {
  const { data, error, loading, stale, at } = useLoad<Req[]>("get_store_requests");
  const { pending, failed } = useQueueItems();
  const waiting = waitingStoreRequests([...pending, ...failed]) as Req[];

  if (loading) return <Spinner />;
  if (error && !waiting.length) return <Empty>{error}</Empty>;
  const rows = [...waiting, ...(data ?? [])];
  if (!rows.length) return <Empty>You haven't raised any store requests yet.</Empty>;

  return (
    <View>
      {stale && at ? (
        <Text style={s.stale}>Showing saved data from {new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</Text>
      ) : null}
      {rows.map((r, i) => (
        <View key={r.name ?? i} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{r.block || "—"}</Text>
            <Text style={s.meta}>
              {productName(r)}
              {productCode(r) && !r.waiting ? ` · ${productCode(r)}` : ""}
              {r.date ? ` · ${r.date}` : ""}
            </Text>
          </View>
          <Pill kind={pillFor(r.status)}>{r.status}</Pill>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  stale: { fontFamily: F.regular, fontSize: 11.5, color: C.inkMute, marginBottom: 10 },
  row: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    gap: 10, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: C.surface2,
    borderRadius: 14, marginBottom: 8, ...shadowCard,
  },
  name: { fontFamily: F.semibold, fontSize: 13, color: C.ink },
  meta: { fontFamily: F.regular, fontSize: 11, color: C.inkMute, marginTop: 2 },
});
