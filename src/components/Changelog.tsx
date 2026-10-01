import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  Dimensions, Modal, Pressable, ScrollView, StyleSheet, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, F, FS, R, SP } from "../theme";
import { Text } from "../ui";

/**
 * What's New.
 *
 * Shown once per release and then never again unless asked for from the menu.
 * Bump CHANGELOG_VERSION when the entries change - the stored value is
 * compared against it, so an unchanged version is silent even after a reinstall
 * of the same build, and a changed one surfaces to everyone exactly once.
 *
 * Entries are newest first, and each one is written for the person doing the
 * work rather than from the commit: what changed on your screen, not what
 * changed in the code.
 */

const CHANGELOG_VERSION = "1.2.0";
const SEEN_KEY = "cnp_changelog_seen";
const { width: SW } = Dimensions.get("window");

type Entry = {
  id: string;
  tag: "New" | "Improved" | "Fixed";
  accent: string;
  bg: string;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
};

const ENTRIES: Entry[] = [
  {
    id: "server",
    tag: "New", accent: "#6366F1", bg: "#12101E", icon: "server",
    title: "Set your own server",
    body: "Hold the Upande logo on the sign-in screen for two seconds to show the server address. It is saved on this phone and reused every time you sign back in, so you only ever type it once.",
  },
  {
    id: "dot",
    tag: "New", accent: "#22C55E", bg: "#022C22", icon: "wifi",
    title: "Connection at a glance",
    body: "A dot in the top-right corner of every screen shows green when the server is answering, grey when the phone has no network, and red when there is signal but the server cannot be reached. Tap it to check again.",
  },
  {
    id: "back",
    tag: "Improved", accent: "#38BDF8", bg: "#0C1A2E", icon: "corner-up-left",
    title: "Back button behaves",
    body: "The phone's back button now closes the menu or steps back one screen instead of shutting the app. It only closes the app from the home screen.",
  },
  {
    id: "record",
    tag: "Improved", accent: "#F59E0B", bg: "#1C0A00", icon: "edit-3",
    title: "Recording an application",
    body: "You now choose the application method and the weather, and \"applied in full\" is worked out from the quantity instead of being a box you tick. Record less than planned and it asks why.",
  },
  {
    id: "menu",
    tag: "Improved", accent: "#A78BFA", bg: "#0F172A", icon: "menu",
    title: "A tidier menu",
    body: "The side menu is narrower and easier to read, and the home shortcuts that duplicated the bottom bar are gone. How to Use and What's New live at the bottom of the menu.",
  },
];

export function changelogVersion() {
  return CHANGELOG_VERSION;
}

/** True when this build has something the viewer has not been shown yet. */
export async function changelogUnseen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) !== CHANGELOG_VERSION;
  } catch {
    return false;   // never let unreadable storage force the sheet open
  }
}

export default function Changelog({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  useEffect(() => { if (open) setPage(0); }, [open]);

  function close() {
    AsyncStorage.setItem(SEEN_KEY, CHANGELOG_VERSION).catch(() => {});
    onClose();
  }

  function goTo(i: number) {
    const next = Math.max(0, Math.min(i, ENTRIES.length - 1));
    setPage(next);
    scroll.current?.scrollTo({ x: next * SW, animated: true });
  }

  const entry = ENTRIES[page];
  const last = page === ENTRIES.length - 1;

  return (
    <Modal visible={open} transparent animationType="fade"
      statusBarTranslucent onRequestClose={close}>
      <View style={[s.sheet, { backgroundColor: entry.bg, paddingTop: insets.top + SP.lg }]}>
        <Pressable style={s.close} onPress={close} hitSlop={12}
          accessibilityRole="button" accessibilityLabel="Close what's new">
          <Feather name="x" size={20} color="#ffffff88" />
        </Pressable>

        {/* The icon pages with the text so a swipe moves one thing, not two. */}
        <ScrollView
          ref={scroll} horizontal pagingEnabled scrollEnabled={false}
          showsHorizontalScrollIndicator={false} style={s.artScroll}
        >
          {ENTRIES.map((e) => (
            <View key={e.id} style={[s.artPage, { width: SW }]}>
              <View style={[s.artCircle, { backgroundColor: e.accent + "1f", borderColor: e.accent + "55" }]}>
                <Feather name={e.icon} size={56} color={e.accent} />
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={[s.content, { paddingBottom: SP.xl + insets.bottom }]}>
          <View style={s.topRow}>
            <View style={[s.tag, { backgroundColor: entry.accent + "22", borderColor: entry.accent + "55" }]}>
              <Text style={[s.tagText, { color: entry.accent }]}>{entry.tag}</Text>
            </View>
            <Text style={s.counter}>{page + 1} / {ENTRIES.length}</Text>
          </View>

          <Text style={s.title}>{entry.title}</Text>
          <View style={{ flex: 1, paddingTop: SP.sm }}>
            <Text style={s.body}>{entry.body}</Text>
          </View>

          <View style={s.dots}>
            {ENTRIES.map((_, i) => (
              <Pressable key={i} onPress={() => goTo(i)} hitSlop={8}>
                <View style={[
                  s.dot,
                  i === page
                    ? { backgroundColor: entry.accent, width: 20 }
                    : { backgroundColor: "#ffffff33" },
                ]} />
              </Pressable>
            ))}
          </View>

          <View style={s.actions}>
            {page > 0 && (
              <Pressable style={s.backBtn} onPress={() => goTo(page - 1)} hitSlop={6}
                accessibilityRole="button" accessibilityLabel="Previous">
                <Feather name="chevron-left" size={20} color="#ffffffaa" />
              </Pressable>
            )}
            <Pressable
              style={[s.nextBtn, { backgroundColor: entry.accent }]}
              onPress={last ? close : () => goTo(page + 1)}
              accessibilityRole="button"
            >
              <Text style={s.nextText}>{last ? "Got it" : "Next"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: { flex: 1 },
  close: { position: "absolute", right: SP.lg, top: SP.xxl + 8, zIndex: 2, padding: 4 },
  artScroll: { flexGrow: 0, height: 240 },
  artPage: { alignItems: "center", justifyContent: "center", height: 240 },
  artCircle: {
    width: 136, height: 136, borderRadius: 68, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  content: { flex: 1, paddingHorizontal: SP.xl, paddingTop: SP.lg },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.full, borderWidth: 1,
  },
  tagText: { fontFamily: F.semibold, fontSize: FS.xs, letterSpacing: 0.3 },
  counter: { fontFamily: F.medium, fontSize: FS.xs, color: "#ffffff66" },
  title: {
    fontFamily: F.bold, fontSize: FS.xl, color: "#ffffff",
    marginTop: SP.lg, letterSpacing: -0.3,
  },
  body: { fontFamily: F.regular, fontSize: FS.md, color: "#ffffffbb", lineHeight: 23 },
  dots: { flexDirection: "row", gap: 6, marginBottom: SP.lg, alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: SP.md },
  backBtn: {
    width: 48, height: 48, borderRadius: R.lg, alignItems: "center",
    justifyContent: "center", backgroundColor: "#ffffff14",
  },
  nextBtn: {
    flex: 1, height: 48, borderRadius: R.lg,
    alignItems: "center", justifyContent: "center",
  },
  nextText: { fontFamily: F.semibold, fontSize: FS.md, color: "#0a0a0a" },
});
