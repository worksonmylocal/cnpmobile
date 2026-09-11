import { StyleSheet, View } from "react-native";
import { C, F, shadowCard } from "../theme";
import { Empty, Spinner, Text } from "../ui";
import { useLoad } from "../useLoad";
import { Pressable } from "react-native";

type Sec = { section: string; pending_count: number };

export default function Upcoming({ onOpen }: { onOpen: (section: string) => void }) {
  const { data, error, loading } = useLoad<Sec[]>("get_sections_with_pending_work");

  if (loading) return <Spinner text="Loading sections…" />;
  if (error) return <Empty>{error}</Empty>;
  if (!data?.length) return <Empty>No pending work. All caught up! 🎉</Empty>;

  return (
    <View>
      {data.map((s0) => (
        <Pressable key={s0.section} style={s.row} onPress={() => onOpen(s0.section)}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{s0.section}</Text>
            <Text style={s.count}>{s0.pending_count} pending</Text>
          </View>
          <Text style={s.arrow}>→</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: 10, paddingVertical: 16, paddingHorizontal: 18, backgroundColor: C.surface2,
    borderRadius: 16, marginBottom: 10, ...shadowCard,
  },
  name: { fontFamily: F.semibold, fontSize: 14, color: C.ink },
  count: { fontFamily: F.regular, fontSize: 12, color: C.inkMute, marginTop: 2 },
  arrow: { color: C.inkMute, fontSize: 16 },
});
