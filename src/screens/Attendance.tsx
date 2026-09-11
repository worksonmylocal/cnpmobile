import { Pressable, StyleSheet, View } from "react-native";
import { writeCall } from "../api";
import { currentSettings, fs, pad } from "../settings";
import { C, F, shadowCard } from "../theme";
import { useLoad } from "../useLoad";
import { Empty, initials, Spinner, Text } from "../ui";

type Person = {
  name: string;
  employee_name: string;
  employee_number?: string | null;
  block?: string | null;
  status?: "Present" | "Absent" | null;
};

type Group = {
  block: string;
  applicators: Person[];
  present: number;
  absent: number;
  unmarked: number;
};

/**
 * The day's register, grouped by the block each applicator works.
 *
 * Only the applicators this supervisor added - a supervisor marks and reviews
 * their own people, not the whole farm's labour.
 */
export default function Attendance({
  reloadKey, toast,
}: {
  reloadKey: number;
  toast: (m: string) => void;
}) {
  const { data, error, loading, reload } = useLoad<Group[]>(
    "get_attendance_by_block", undefined, [reloadKey],
  );
  const set = currentSettings();

  async function mark(employee: string, status: "Present" | "Absent") {
    try {
      await writeCall("mark_attendance", { employee, status });
      toast(`${status} marked`);
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (loading && !data) return <Spinner text="Loading your team…" />;
  if (error) {
    // The app ships independently of the server, so a phone can be newer than
    // the site it talks to. Say that plainly instead of showing Frappe's
    // "failed to get method" internals.
    const outdatedServer = /get_attendance_by_block|has no attribute|failed to get method/i.test(error);
    return (
      <Empty>
        {outdatedServer
          ? "The register needs a newer version of the server than this site is running. Everything else in the app still works."
          : error}
      </Empty>
    );
  }
  if (!data?.length) {
    return <Empty>No applicators on your team yet. Add them under Manage Team.</Empty>;
  }

  const present = data.reduce((n, g) => n + g.present, 0);
  const absent = data.reduce((n, g) => n + g.absent, 0);
  const unmarked = data.reduce((n, g) => n + g.unmarked, 0);

  return (
    <View>
      <View style={s.tally}>
        <Tally label="PRESENT" value={present} color={C.good} />
        <Tally label="ABSENT" value={absent} color={C.bad} />
        <Tally label="NOT MARKED" value={unmarked} color={C.ink} />
      </View>

      {data.map((g) => (
        <View key={g.block} style={s.group}>
          <View style={s.groupHead}>
            <Text style={[s.groupName, { fontSize: fs(14, set.fontScale) }]}>{g.block}</Text>
            <Text style={[s.groupCount, { fontSize: fs(12, set.fontScale) }]}>
              {g.present} present · {g.absent} absent · {g.unmarked} not marked
            </Text>
          </View>

          {g.applicators.map((a) => (
            <View key={a.name} style={[s.row, { paddingVertical: pad(14, set.bigTouch) }]}>
              <View style={s.initial}>
                <Text style={s.initialText}>{initials(a.employee_name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.name, { fontSize: fs(14, set.fontScale) }]}>{a.employee_name}</Text>
                <Text style={[s.number, { fontSize: fs(11, set.fontScale) }]}>
                  {a.employee_number || "no employee number"}
                </Text>
              </View>
              <View style={s.btns}>
                <AttBtn label="In" on={a.status === "Present"} onColor={C.good}
                  big={set.bigTouch} onPress={() => mark(a.name, "Present")} />
                <AttBtn label="Out" on={a.status === "Absent"} onColor={C.bad}
                  big={set.bigTouch} onPress={() => mark(a.name, "Absent")} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Tally({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={s.tallyCard}>
      <Text style={s.tallyLabel}>{label}</Text>
      <Text style={[s.tallyValue, { color }]}>{value}</Text>
    </View>
  );
}

function AttBtn({
  label, on, onColor, big, onPress,
}: {
  label: string; on: boolean; onColor: string; big: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={[
        s.attBtn,
        { paddingVertical: big ? 12 : 8, paddingHorizontal: big ? 16 : 10 },
        on ? { backgroundColor: onColor } : { backgroundColor: C.grey },
      ]}
    >
      <Text style={[s.attBtnText, { color: on ? C.onInk : C.ink3 }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  tally: { flexDirection: "row", gap: 10, marginBottom: 16 },
  tallyCard: {
    flex: 1, backgroundColor: C.surface2, borderRadius: 20,
    paddingVertical: 16, paddingHorizontal: 14, ...shadowCard,
  },
  tallyLabel: { fontFamily: F.medium, fontSize: 10, letterSpacing: 0.8, color: C.inkMute, marginBottom: 6 },
  tallyValue: { fontFamily: F.semibold, fontSize: 26, letterSpacing: -0.5 },
  group: { marginBottom: 14 },
  groupHead: {
    backgroundColor: C.surface2, borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 16, ...shadowCard,
  },
  groupName: { fontFamily: F.semibold, color: C.ink },
  groupCount: { fontFamily: F.regular, color: C.inkMute, marginTop: 2 },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface2, borderRadius: 14, paddingHorizontal: 16,
    marginTop: 8, ...shadowCard,
  },
  initial: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.gradInk,
    alignItems: "center", justifyContent: "center",
  },
  initialText: { fontFamily: F.semibold, fontSize: 13, color: C.onInk },
  name: { fontFamily: F.semibold, color: C.ink },
  number: { fontFamily: F.regular, color: C.inkMute, marginTop: 2 },
  btns: { flexDirection: "row", gap: 6 },
  attBtn: { borderRadius: 8 },
  attBtnText: { fontFamily: F.semibold, fontSize: 11 },
});
