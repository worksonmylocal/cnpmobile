/**
 * The field page's CSS classes, as React Native components. Each block notes
 * the rule in field.html / dashboard.css it mirrors, so the two stay in step.
 */
import { Feather } from "@expo/vector-icons";
import { ReactNode, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet,
  Text as RNText, TextInput, TextProps, View, ViewStyle,
} from "react-native";
import { currentSettings } from "./settings";
import { C, F, shadowCard } from "./theme";

/**
 * Text that honours the user's chosen size.
 *
 * Every screen builds its typography with StyleSheet.create, which runs once
 * at module load - so sizes baked in there can never react to a setting.
 * Scaling here instead means one import swap per screen makes the whole app
 * respond, rather than every size having to be threaded through by hand.
 *
 * Read synchronously rather than subscribed: the shell watches the settings
 * and re-renders on change, which re-renders every Text below it. Hundreds of
 * individual subscriptions would cost more and buy nothing.
 */
export function Text({ style, ...rest }: TextProps) {
  const { fontScale } = currentSettings();
  if (fontScale === 100) return <RNText style={style} {...rest} />;

  const flat = StyleSheet.flatten(style) as { fontSize?: number } | undefined;
  // 14 is React Native's own default, so an unsized Text scales like the rest.
  const base = typeof flat?.fontSize === "number" ? flat.fontSize : 14;
  return <RNText style={[style, { fontSize: Math.round((base * fontScale) / 100) }]} {...rest} />;
}

export function initials(name?: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0] || "")[0] || "?").toUpperCase() + ((parts[1] || "")[0] || "").toUpperCase();
}

/* .card */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[u.card, style]}>{children}</View>;
}
export function CardH3({ children }: { children: ReactNode }) {
  return <Text style={u.cardH3}>{children}</Text>;
}
export function Meta({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[u.meta, style]}>{children}</Text>;
}
export function InputLabel({ children }: { children: ReactNode }) {
  return <Text style={u.inputLabel}>{children}</Text>;
}

/* .btn-big + variants */
export type BtnKind = "ink" | "signal" | "warn" | "good" | "bad" | "grey";
export function BtnBig({
  label, onPress, kind = "ink", disabled, style,
}: {
  label: string; onPress?: () => void; kind?: BtnKind;
  disabled?: boolean; style?: ViewStyle;
}) {
  const bg = {
    ink: C.gradInk, signal: C.signal, warn: C.warn,
    good: C.good, bad: C.bad, grey: C.grey,
  }[kind];
  const fg = kind === "grey" ? C.ink3 : C.onInk;
  const { bigTouch } = currentSettings();
  return (
    <Pressable
      style={[
        u.btnBig,
        bigTouch && { paddingVertical: 21 },
        { backgroundColor: bg },
        disabled && u.btnDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={[u.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/* .pill */
export type PillKind = "good" | "bad" | "warn" | "info" | "mute";
export function Pill({ kind, children }: { kind: PillKind; children: ReactNode }) {
  const map = {
    good: [C.goodBg, C.good], bad: [C.badBg, C.bad], warn: [C.warnBg, C.warn],
    info: [C.infoBg, C.info], mute: [C.track, C.inkMute],
  }[kind];
  return (
    <View style={[u.pill, { backgroundColor: map[0], alignSelf: "flex-start" }]}>
      <Text style={[u.pillText, { color: map[1] }]}>{children}</Text>
    </View>
  );
}

/* .field-input */
export function FieldInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={C.inkFaint} {...props} style={[u.input, props.style]} />;
}

/* .spinner / .empty */
export function Spinner({ text = "Loading…" }: { text?: string }) {
  return (
    <View style={u.spinner}>
      <ActivityIndicator color={C.inkMute} />
      <Text style={u.spinnerText}>{text}</Text>
    </View>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <Text style={u.empty}>{children}</Text>;
}

/* .back-link */
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={u.backLink}>← {label}</Text>
    </Pressable>
  );
}

/* .section-group with the accordion chevron */
export function SectionGroup({
  title, count, open, onToggle, children, staticHead, right,
}: {
  title: string; count?: string; open?: boolean; onToggle?: () => void;
  children?: ReactNode; staticHead?: boolean; right?: ReactNode;
}) {
  return (
    <View style={u.sectionGroup}>
      <Pressable
        style={u.sectionHead}
        onPress={onToggle}
        disabled={staticHead}
        accessibilityRole={staticHead ? undefined : "button"}
      >
        <View style={{ flex: 1 }}>
          <Text style={u.sectionHeadTitle}>{title}</Text>
          {!!count && <Text style={u.count}>{count}</Text>}
        </View>
        {right}
        {!staticHead && (
          <Text style={[u.chevron, open && { transform: [{ rotate: "90deg" }] }]}>›</Text>
        )}
      </Pressable>
      {(staticHead || open) && <View style={u.sectionBody}>{children}</View>}
    </View>
  );
}

/* .pick-row inside renderPickList - search box plus a filtered list */
export function PickList<T>({
  items, getLabel, getSub, onSelect, placeholder = "Search…",
  emptyText = "Nothing to show.", selectedKeys, getKey,
}: {
  items: T[];
  getLabel: (t: T) => string;
  getSub?: (t: T) => string;
  onSelect: (t: T) => void;
  placeholder?: string;
  emptyText?: string;
  selectedKeys?: string[];
  getKey?: (t: T) => string;
}) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () => items.filter((it) => getLabel(it).toLowerCase().includes(q.toLowerCase())),
    [items, q, getLabel]
  );

  if (!items.length) return <Empty>{emptyText}</Empty>;

  return (
    <View>
      <FieldInput placeholder={placeholder} value={q} onChangeText={setQ}
        autoCapitalize="none" autoCorrect={false} />
      {rows.length === 0
        ? <Empty>No matches.</Empty>
        : rows.map((it, i) => {
            const key = getKey ? getKey(it) : String(i);
            const selected = !!selectedKeys?.includes(key);
            return (
              <PickRow
                key={key}
                label={getLabel(it)}
                sub={getSub?.(it)}
                selected={selected}
                showCheck={!!selectedKeys}
                showInitial={!!getSub || !!selectedKeys}
                onPress={() => onSelect(it)}
              />
            );
          })}
    </View>
  );
}

export function PickRow({
  label, sub, selected, showCheck, showInitial, onPress,
}: {
  label: string; sub?: string; selected?: boolean;
  showCheck?: boolean; showInitial?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      style={[u.pickRow, currentSettings().bigTouch && { paddingVertical: 19 }, selected && u.pickRowSelected]}
      onPress={onPress}
    >
      {showInitial && (
        <View style={u.initial}><Text style={u.initialText}>{initials(label)}</Text></View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={u.pickName}>{label}</Text>
        {!!sub && <Text style={u.blockTag}>{sub}</Text>}
      </View>
      {showCheck && (
        <View style={[u.check, selected && u.checkOn]}>
          {selected && <Feather name="check" size={13} color={C.onInk} />}
        </View>
      )}
    </Pressable>
  );
}

/* .filter-select - a native <select> stands in as a tap-to-open sheet */
export function Select({
  value, options, onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <>
      <Pressable style={[u.input, u.select]} onPress={() => setOpen(true)}>
        <Text style={u.selectText} numberOfLines={1}>{current?.label ?? ""}</Text>
        <Feather name="chevron-down" size={16} color={C.inkMute} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={u.overlay} onPress={() => setOpen(false)}>
          <View style={u.sheet}>
            <ScrollView>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  style={u.sheetRow}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[u.sheetText, o.value === value && { color: C.ink, fontFamily: F.semibold }]}>
                    {o.label}
                  </Text>
                  {o.value === value && <Feather name="check" size={16} color={C.ink} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export const u = StyleSheet.create({
  card: {
    backgroundColor: C.surface2, borderRadius: 24, paddingVertical: 18,
    paddingHorizontal: 20, marginBottom: 14, ...shadowCard,
  },
  cardH3: { fontFamily: F.semibold, fontSize: 16, color: C.ink, marginBottom: 4 },
  meta: { fontFamily: F.regular, fontSize: 12, color: C.inkMute, marginBottom: 12 },
  inputLabel: { fontFamily: F.regular, fontSize: 13, color: C.ink4, marginTop: 6 },

  btnBig: {
    width: "100%", paddingVertical: 16, paddingHorizontal: 12, borderRadius: 14,
    marginTop: 8, alignItems: "center", justifyContent: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontFamily: F.semibold, fontSize: 15, textAlign: "center" },

  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontFamily: F.semibold, fontSize: 11 },

  input: {
    width: "100%", paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
    fontFamily: F.regular, borderWidth: 1, borderColor: C.hairline,
    backgroundColor: C.surface2, borderRadius: 12, marginVertical: 8, color: C.ink,
  },

  spinner: { paddingVertical: 34, alignItems: "center", gap: 10 },
  spinnerText: { fontFamily: F.regular, fontSize: 13, color: C.inkMute },
  empty: {
    textAlign: "center", color: C.inkMute, paddingVertical: 34,
    fontSize: 13, fontFamily: F.regular, lineHeight: 19,
  },
  backLink: {
    fontFamily: F.semibold, fontSize: 13, color: C.ink4, marginBottom: 14, marginTop: 2,
  },

  sectionGroup: { marginBottom: 14 },
  sectionHead: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 12, paddingHorizontal: 16, backgroundColor: C.surface2,
    borderRadius: 16, ...shadowCard,
  },
  sectionHeadTitle: { fontFamily: F.semibold, fontSize: 14, color: C.ink },
  count: { fontFamily: F.regular, fontSize: 12, color: C.inkMute, marginTop: 2 },
  chevron: { color: C.inkMute, fontSize: 20, lineHeight: 22 },
  sectionBody: { paddingTop: 10 },

  select: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 12 },
  selectText: { fontFamily: F.regular, fontSize: 14, color: C.ink, flex: 1 },
  overlay: { flex: 1, backgroundColor: "rgba(10,10,10,0.4)", justifyContent: "center", padding: 28 },
  sheet: { backgroundColor: C.surface2, borderRadius: 20, maxHeight: "70%", paddingVertical: 8, ...shadowCard },
  sheetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 14, paddingHorizontal: 20 },
  sheetText: { fontFamily: F.regular, fontSize: 15, color: C.ink3, flex: 1 },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14,
    backgroundColor: C.surface2, marginBottom: 10, ...shadowCard,
  },
  pickRowSelected: { borderWidth: 2, borderColor: C.ink },
  initial: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.gradInk,
    alignItems: "center", justifyContent: "center",
  },
  initialText: { fontFamily: F.semibold, fontSize: 13, color: C.onInk },
  pickName: { fontFamily: F.semibold, fontSize: 14, color: C.ink },
  blockTag: { fontFamily: F.regular, fontSize: 11, color: C.inkMute, marginTop: 2 },
  check: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    borderColor: C.hairline, alignItems: "center", justifyContent: "center",
  },
  checkOn: { backgroundColor: C.good, borderColor: C.good },
});
