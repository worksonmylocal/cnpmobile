import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Dimensions, Modal, Pressable, ScrollView, StyleSheet, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, FS, R, SP, shadowCard } from "../theme";
import { Text } from "../ui";

/**
 * How to Use.
 *
 * One page per thing a supervisor actually does, in the order a season runs:
 * see what is due, request it, record it, keep the team and the register. Each
 * page says where the screen lives, because "tap Upcoming" is useless if you
 * cannot find Upcoming.
 *
 * Deliberately not a first-run walkthrough. Nobody reads those, and the moment
 * someone needs instructions is the moment they are stuck halfway through a
 * task - so this is in the menu, available then.
 */

const { width: SW } = Dimensions.get("window");

type Lesson = {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  colour: string;
  tint: string;
  title: string;
  where: string;
  steps: string[];
  tip?: string;
};

const LESSONS: Lesson[] = [
  {
    id: "upcoming",
    icon: "clock", colour: "#2c6bb3", tint: "rgba(44,107,179,0.10)",
    title: "Upcoming Applications",
    where: "Upcoming, on the bottom bar",
    steps: [
      "Pick a section to see the blocks with work due.",
      "Pick a block to see each product and the month it is planned for.",
      "Tap a round to see the planned quantity and its status.",
      "Use the filter at the top to narrow by block or product.",
    ],
    tip: "A round has to be requested and issued by the store before it can be recorded.",
  },
  {
    id: "request",
    icon: "package", colour: "#b9770e", tint: "rgba(185,119,14,0.10)",
    title: "Requesting from the store",
    where: "Open a round from Upcoming",
    steps: [
      "Open the round you need fertilizer for.",
      "Check the quantity, then tap Request from Store.",
      "The request goes to the farm manager's approval queue.",
      "Watch its status under Store Requests.",
    ],
    tip: "Draft, Pending Approval, Approved, then the store issues. Only an issued request can be recorded against.",
  },
  {
    id: "record",
    icon: "edit-3", colour: "#1a8a3a", tint: "rgba(26,138,58,0.10)",
    title: "Recording an application",
    where: "Record, on the bottom bar",
    steps: [
      "Choose the section, then the block, then the round.",
      "Pick the applicators who did the work.",
      "Enter the quantity actually applied.",
      "Choose the application method and the weather.",
      "Submit.",
    ],
    tip: "Applied in full is worked out from the quantity. If you applied less than planned it will ask why.",
  },
  {
    id: "team",
    icon: "users", colour: "#228883", tint: "rgba(34,136,131,0.10)",
    title: "Manage Team",
    where: "Team, on the bottom bar",
    steps: [
      "Search for an employee and add them to your team.",
      "Assign each applicator the block they work.",
      "Remove anyone who has moved on.",
    ],
    tip: "Only people on your team can be picked as applicators when recording.",
  },
  {
    id: "register",
    icon: "calendar", colour: "#7c53e0", tint: "rgba(124,83,224,0.10)",
    title: "Attendance register",
    where: "Register, on the bottom bar",
    steps: [
      "Pick the block you are working today.",
      "Mark each applicator present or absent.",
      "The tallies at the top show who is still unmarked.",
    ],
    tip: "You only see the applicators you added yourself.",
  },
  {
    id: "offline",
    icon: "wifi-off", colour: "#8a8780", tint: "rgba(138,135,128,0.10)",
    title: "Working without signal",
    where: "Anywhere",
    steps: [
      "Keep working - what you submit is saved on the phone.",
      "The header shows how many items are waiting to sync.",
      "They send themselves when signal returns.",
      "The dot in the corner tells you where you stand.",
    ],
    tip: "Grey dot means no network. Red means there is signal but the server is not answering, so walking around will not help.",
  },
];

export default function Tutorial({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  useEffect(() => { if (open) setPage(0); }, [open]);

  function goTo(i: number) {
    const next = Math.max(0, Math.min(i, LESSONS.length - 1));
    setPage(next);
    scroll.current?.scrollTo({ x: next * SW, animated: true });
  }

  const last = page === LESSONS.length - 1;

  return (
    <Modal visible={open} transparent animationType="slide"
      statusBarTranslucent onRequestClose={onClose}>
      <View style={[s.page, { paddingTop: insets.top }]}>
        <View style={s.head}>
          <Text style={s.headTitle}>How to use the app</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button"
            accessibilityLabel="Close how to use">
            <Feather name="x" size={22} color={C.ink3} />
          </Pressable>
        </View>

        <ScrollView
          ref={scroll} horizontal pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / SW))}
        >
          {LESSONS.map((l) => (
            <ScrollView key={l.id} style={{ width: SW }}
              contentContainerStyle={s.lesson}>
              <View style={[s.bubble, { backgroundColor: l.tint }]}>
                <Feather name={l.icon} size={26} color={l.colour} />
              </View>
              <Text style={s.lessonTitle}>{l.title}</Text>
              <Text style={s.where}>{l.where}</Text>

              {l.steps.map((step, i) => (
                <View key={i} style={s.stepRow}>
                  <View style={[s.stepNum, { backgroundColor: l.tint }]}>
                    <Text style={[s.stepNumText, { color: l.colour }]}>{i + 1}</Text>
                  </View>
                  <Text style={s.stepText}>{step}</Text>
                </View>
              ))}

              {l.tip && (
                <View style={s.tip}>
                  <Feather name="info" size={14} color={C.inkMute} />
                  <Text style={s.tipText}>{l.tip}</Text>
                </View>
              )}
            </ScrollView>
          ))}
        </ScrollView>

        <View style={[s.foot, { paddingBottom: SP.lg + insets.bottom }]}>
          <View style={s.dots}>
            {LESSONS.map((_, i) => (
              <Pressable key={i} onPress={() => goTo(i)} hitSlop={8}>
                <View style={[s.dot, i === page
                  ? { backgroundColor: C.ink, width: 20 }
                  : { backgroundColor: C.inkFaint }]} />
              </Pressable>
            ))}
          </View>
          <Pressable style={s.next} onPress={last ? onClose : () => goTo(page + 1)}
            accessibilityRole="button">
            <Text style={s.nextText}>{last ? "Done" : "Next"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SP.xl, paddingVertical: SP.lg,
  },
  headTitle: { fontFamily: F.semibold, fontSize: FS.lg, color: C.ink, letterSpacing: -0.2 },
  lesson: { paddingHorizontal: SP.xl, paddingBottom: SP.xl },
  bubble: {
    width: 56, height: 56, borderRadius: R.lg,
    alignItems: "center", justifyContent: "center", marginBottom: SP.lg,
  },
  lessonTitle: { fontFamily: F.semibold, fontSize: FS.xl, color: C.ink, letterSpacing: -0.3 },
  where: { fontFamily: F.medium, fontSize: FS.xs, color: C.inkMute, marginTop: 4, marginBottom: SP.xl },
  stepRow: { flexDirection: "row", gap: SP.md, marginBottom: SP.md, alignItems: "flex-start" },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, alignItems: "center",
    justifyContent: "center", marginTop: 1,
  },
  stepNumText: { fontFamily: F.semibold, fontSize: FS.xs },
  stepText: { flex: 1, fontFamily: F.regular, fontSize: FS.sm, color: C.ink3, lineHeight: 20 },
  tip: {
    flexDirection: "row", gap: SP.sm, alignItems: "flex-start",
    backgroundColor: C.surface2, borderRadius: R.lg, padding: SP.md,
    marginTop: SP.md, ...shadowCard,
  },
  tipText: { flex: 1, fontFamily: F.regular, fontSize: FS.xs, color: C.ink4, lineHeight: 17 },
  foot: {
    paddingHorizontal: SP.xl, paddingTop: SP.md, gap: SP.md,
    borderTopWidth: 1, borderTopColor: C.hairline, backgroundColor: C.bg,
  },
  dots: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  next: {
    height: 50, borderRadius: R.lg, backgroundColor: C.ink,
    alignItems: "center", justifyContent: "center",
  },
  nextText: { fontFamily: F.semibold, fontSize: FS.md, color: C.onInk },
});
