import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { C, F, shadowCard } from "../theme";
import { Empty, Pill, PillKind, SectionGroup, Spinner } from "../ui";
import { useLoad } from "../useLoad";

type BlockRow = { block: string; status: string };
type Sec = { section: string; total_blocks: number; pct_complete: number; blocks: BlockRow[] };

const pillFor = (s: string): PillKind =>
  s === "Completed" ? "good" : s === "Behind Schedule" ? "bad" : s === "In Progress" ? "info" : "mute";

export default function Blocks() {
  // Accordion: only one section stays open, as on the web page - with 78
  // blocks across four sections, leaving them all expanded buries the list.
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading } = useLoad<Sec[]>("get_block_progress");

  if (loading) return <Spinner text="Loading blocks…" />;
  if (error) return <Empty>{error}</Empty>;
  if (!data?.length) return <Empty>No blocks in this programme yet.</Empty>;

  return (
    <View>
      {data.map((sec, i) => (
        <SectionGroup
          key={sec.section}
          title={sec.section}
          count={`${sec.total_blocks} blocks · ${sec.pct_complete}% done`}
          open={open === i}
          onToggle={() => setOpen(open === i ? null : i)}
        >
          {sec.blocks.map((b) => (
            <View key={b.block} style={s.blockRow}>
              <Text style={s.blockName}>{b.block}</Text>
              <Pill kind={pillFor(b.status)}>{b.status}</Pill>
            </View>
          ))}
        </SectionGroup>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  blockRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: 10, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: C.surface2,
    borderRadius: 14, marginBottom: 8, ...shadowCard,
  },
  blockName: { fontFamily: F.semibold, fontSize: 13, color: C.ink, flex: 1 },
});
