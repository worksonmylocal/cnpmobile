import { StyleSheet, View } from "react-native";
import { productCode, productName } from "../nav";
import { C, F, shadowCard } from "../theme";
import { Empty, Pill, PillKind, Spinner, Text } from "../ui";
import { useLoad } from "../useLoad";

type Req = {
  name?: string; block?: string; status: string; date?: string;
  fertilizer_product?: string; fertilizer_product_name?: string;
};

const pillFor = (s: string): PillKind =>
  s === "Issued" ? "good"
    : s === "Approved" ? "info"
      : s === "Rejected" ? "bad"
        : s === "Cancelled" || s === "Draft" ? "mute"
          : "warn";

export default function StoreRequests() {
  const { data, error, loading } = useLoad<Req[]>("get_store_requests");

  if (loading) return <Spinner />;
  if (error) return <Empty>{error}</Empty>;
  if (!data?.length) return <Empty>No store requests yet.</Empty>;

  return (
    <View>
      {data.map((r, i) => (
        <View key={r.name ?? i} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{r.block || "—"}</Text>
            <Text style={s.meta}>
              {productName(r)}
              {productCode(r) ? ` · ${productCode(r)}` : ""}
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
  row: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    gap: 10, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: C.surface2,
    borderRadius: 14, marginBottom: 8, ...shadowCard,
  },
  name: { fontFamily: F.semibold, fontSize: 13, color: C.ink },
  meta: { fontFamily: F.regular, fontSize: 11, color: C.inkMute, marginTop: 2 },
});
