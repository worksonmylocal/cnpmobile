import { Pressable, StyleSheet, View } from "react-native";
import { writeCall } from "../api";
import { C, F, shadowCard } from "../theme";
import { BtnBig, Empty, initials, SectionGroup, Spinner, Text } from "../ui";
import { useLoad } from "../useLoad";

export type Applicator = {
  name: string;
  employee_name: string;
  attendance_status?: string;
  custom_assigned_block?: string;
};
type BlockGroup = { block: string; applicators: Applicator[] };
type Sec = { section: string; blocks: BlockGroup[] };

export default function Team({
  onAdd, onQuickAdd, onOpenApplicator, toast, registerRoster,
}: {
  onAdd: () => void;
  onQuickAdd: (block: string) => void;
  onOpenApplicator: (a: Applicator) => void;
  toast: (m: string) => void;
  registerRoster: (map: Record<string, Applicator>) => void;
}) {
  const { data, error, loading, reload } = useLoad<Sec[]>("get_my_applicators_by_section");

  async function setAttendance(employee: string, status: string) {
    try {
      await writeCall("mark_attendance", { employee, status });
      toast(status + " marked");
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const map: Record<string, Applicator> = {};
  data?.forEach((sec) => sec.blocks.forEach((b) => b.applicators.forEach((a) => { map[a.name] = a; })));
  if (data) registerRoster(map);

  return (
    <View>
      <BtnBig label="+ Add Applicator" kind="ink" onPress={onAdd} style={{ marginTop: 0 }} />
      <View style={{ marginTop: 14 }}>
        {loading ? (
          <Spinner text="Loading your team…" />
        ) : error ? (
          <Empty>{error}</Empty>
        ) : !data?.length ? (
          <Empty>No applicators on your team yet. Tap "Add Applicator" above.</Empty>
        ) : (
          data.map((sec) => (
            <SectionGroup
              key={sec.section}
              title={sec.section}
              staticHead
              right={
                <Text style={s.headCount}>
                  {sec.blocks.reduce((n, b) => n + b.applicators.length, 0)}
                </Text>
              }
            >
              {sec.blocks.map((blk) => (
                <View key={blk.block}>
                  <View style={s.subhead}>
                    <Text style={s.subheadText}>{blk.block.toUpperCase()}</Text>
                    {blk.block !== "No block assigned" && (
                      <Pressable
                        style={s.addChip}
                        onPress={() => onQuickAdd(blk.block)}
                        accessibilityLabel={`Add applicator to ${blk.block}`}
                      >
                        <Text style={s.addChipText}>+</Text>
                      </Pressable>
                    )}
                  </View>
                  {blk.applicators.map((a) => (
                    <View key={a.name} style={s.rosterRow}>
                      <Pressable style={s.initial} onPress={() => onOpenApplicator(a)}>
                        <Text style={s.initialText}>{initials(a.employee_name)}</Text>
                      </Pressable>
                      <Pressable style={{ flex: 1 }} onPress={() => onOpenApplicator(a)}>
                        <Text style={s.name}>{a.employee_name}</Text>
                      </Pressable>
                      <View style={s.attBtns}>
                        <AttBtn
                          label="In"
                          on={a.attendance_status === "Present"}
                          onColor={C.good}
                          onPress={() => setAttendance(a.name, "Present")}
                        />
                        <AttBtn
                          label="Out"
                          on={a.attendance_status === "Absent"}
                          onColor={C.bad}
                          onPress={() => setAttendance(a.name, "Absent")}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </SectionGroup>
          ))
        )}
      </View>
    </View>
  );
}

function AttBtn({
  label, on, onColor, onPress,
}: { label: string; on: boolean; onColor: string; onPress: () => void }) {
  return (
    <Pressable
      style={[s.attBtn, { backgroundColor: on ? onColor : C.grey }]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[s.attBtnText, { color: on ? C.onInk : C.ink3 }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  headCount: { fontFamily: F.regular, fontSize: 12, color: C.inkMute },
  subhead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 10, paddingHorizontal: 4, paddingBottom: 6, marginTop: 4,
  },
  subheadText: { fontFamily: F.semibold, fontSize: 12, color: C.ink4, letterSpacing: 0.4 },
  addChip: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: C.gradInk,
    alignItems: "center", justifyContent: "center",
  },
  addChipText: { fontFamily: F.semibold, fontSize: 15, color: C.onInk, lineHeight: 17 },
  rosterRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14,
    paddingHorizontal: 16, borderRadius: 14, backgroundColor: C.surface2,
    marginBottom: 10, ...shadowCard,
  },
  initial: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.gradInk,
    alignItems: "center", justifyContent: "center",
  },
  initialText: { fontFamily: F.semibold, fontSize: 13, color: C.onInk },
  name: { fontFamily: F.semibold, fontSize: 14, color: C.ink },
  attBtns: { flexDirection: "row", gap: 6 },
  attBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  attBtnText: { fontFamily: F.semibold, fontSize: 11 },
});
