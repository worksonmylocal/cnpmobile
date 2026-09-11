import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { C, F, shadowCard } from "../theme";
import {
  FONT_MAX, FONT_MIN, FONT_STEP, Settings as S, fs, useSettings,
} from "../settings";
import { BtnBig, Card, CardH3, Meta, Text } from "../ui";

export default function Settings({
  user, pending, onSync,
}: {
  user: string;
  pending: number;
  onSync: () => void;
}) {
  const [set, update, reset] = useSettings();

  const stepFont = (by: number) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, set.fontScale + by));
    if (next !== set.fontScale) update({ fontScale: next });
  };

  return (
    <View>
      <Card>
        <CardH3>Display</CardH3>
        <Meta>Saved on this phone only — it won't change anything for anyone else.</Meta>

        <Text style={[s.label, { fontSize: fs(13, set.fontScale) }]}>
          Text size — <Text style={s.labelValue}>{set.fontScale}%</Text>
        </Text>

        <View style={s.stepper}>
          <Pressable
            style={[s.stepBtn, set.fontScale <= FONT_MIN && s.stepBtnOff]}
            onPress={() => stepFont(-FONT_STEP)}
            disabled={set.fontScale <= FONT_MIN}
            accessibilityRole="button"
            accessibilityLabel="Smaller text"
          >
            <Feather name="minus" size={18} color={set.fontScale <= FONT_MIN ? C.inkFaint : C.ink} />
          </Pressable>

          <View style={s.previewWrap}>
            <Text style={[s.preview, { fontSize: fs(15, set.fontScale) }]} numberOfLines={1}>
              BLOCK BLK 1 · CAN
            </Text>
            <Text style={[s.previewSub, { fontSize: fs(12, set.fontScale) }]} numberOfLines={1}>
              139.8 Kg planned
            </Text>
          </View>

          <Pressable
            style={[s.stepBtn, set.fontScale >= FONT_MAX && s.stepBtnOff]}
            onPress={() => stepFont(FONT_STEP)}
            disabled={set.fontScale >= FONT_MAX}
            accessibilityRole="button"
            accessibilityLabel="Larger text"
          >
            <Feather name="plus" size={18} color={set.fontScale >= FONT_MAX ? C.inkFaint : C.ink} />
          </Pressable>
        </View>

        <Toggle
          label="Bigger buttons"
          hint="Easier to hit with gloves on"
          value={set.bigTouch}
          onChange={(v) => update({ bigTouch: v })}
        />
        <Toggle
          label="Quick bar at the bottom"
          hint="One tap to Home, Upcoming, Record, Team and Register"
          value={set.bottomNav}
          onChange={(v) => update({ bottomNav: v })}
        />
        <Toggle
          label="Confirm before submitting"
          hint="Ask once more before sending a request or recording an application"
          value={set.confirmSubmit}
          onChange={(v) => update({ confirmSubmit: v })}
        />
      </Card>

      <Card>
        <CardH3>This device</CardH3>
        <Meta>Signed in as {user}</Meta>
        <Meta style={{ marginBottom: 12 }}>
          {pending
            ? `${pending} item${pending > 1 ? "s" : ""} waiting to sync`
            : "Everything is synced"}
        </Meta>
        {pending > 0 && <BtnBig label="Sync pending items now" kind="warn" onPress={onSync} />}
        <BtnBig label="Reset display settings" kind="grey" onPress={reset} />
      </Card>
    </View>
  );
}

function Toggle({
  label, hint, value, onChange,
}: {
  label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <Pressable style={s.toggleRow} onPress={() => onChange(!value)} accessibilityRole="switch">
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        <Text style={s.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: C.track, true: C.ink2 }}
        thumbColor={C.surface2}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  label: { fontFamily: F.regular, color: C.ink4, marginTop: 6 },
  labelValue: { fontFamily: F.semibold, color: C.ink },
  stepper: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, marginBottom: 16 },
  stepBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.surface2,
    alignItems: "center", justifyContent: "center", ...shadowCard,
  },
  stepBtnOff: { opacity: 0.45 },
  previewWrap: {
    flex: 1, backgroundColor: C.bg, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 14, justifyContent: "center",
  },
  preview: { fontFamily: F.semibold, color: C.ink },
  previewSub: { fontFamily: F.regular, color: C.inkMute, marginTop: 2 },
  toggleRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.hairline,
  },
  toggleLabel: { fontFamily: F.medium, fontSize: 14, color: C.ink3 },
  toggleHint: { fontFamily: F.regular, fontSize: 12, color: C.inkMute, marginTop: 2 },
});
