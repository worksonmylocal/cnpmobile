import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { call, writeCall } from "../api";
import { C, F, FS, R, SP, shadowCard } from "../theme";
import { BtnBig, Card, CardH3, Empty, FieldInput, InputLabel, Meta, PickRow, Spinner, Text } from "../ui";

/**
 * Build a crew, then add it.
 *
 * Before this, adding was one person per visit: tap +, wait for the roster,
 * find a name, and land back on the team screen - then do all of it again for
 * the next person. Putting a six-person crew on a block meant six passes over
 * a list that took seconds to arrive and twelve requests to the server.
 *
 * Now the search and the chosen crew share one screen. Names are searched on
 * the server, so what arrives is the handful that match rather than the whole
 * roster, and the crew is sent in a single call at the end.
 */

type Employee = { name: string; employee_name: string; designation?: string };

export default function AddApplicators({
  block, onDone, toast,
}: {
  block?: string;
  onDone: () => void;
  toast: (m: string) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Employee[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Employee[]>([]);
  const [busy, setBusy] = useState(false);

  // One request per pause in typing, not per keystroke.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearching(true);
      call<Employee[]>("get_available_employees_for_team", { search: q })
        .then((d) => { setRows(d || []); setError(null); })
        .catch((e) => setError((e as Error).message))
        .finally(() => setSearching(false));
    }, 280);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  const isPicked = (e: Employee) => picked.some((p) => p.name === e.name);

  function toggle(e: Employee) {
    setPicked((cur) =>
      cur.some((p) => p.name === e.name)
        ? cur.filter((p) => p.name !== e.name)
        : [...cur, e]);
  }

  async function submit() {
    if (busy || !picked.length) return;
    setBusy(true);
    try {
      const res = await writeCall<{ added: string[]; failed: { employee: string; reason: string }[] }>(
        "add_applicators",
        { employees: picked.map((p) => p.name), block: block ?? null },
      );
      const n = res?.added?.length ?? picked.length;
      // Say what did not work as well as what did - a crew of six with one
      // person already on another team should add five and tell you why.
      if (res?.failed?.length) {
        toast(`${n} added. ${res.failed.length} skipped: ${res.failed[0].reason}.`);
      } else {
        toast(`${n} applicator${n === 1 ? "" : "s"} added${block ? ` to ${block}` : ""}.`);
      }
      onDone();
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message);
      if (err.queued) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Card>
        <CardH3>{block ? `Add applicators to ${block}` : "Add applicators"}</CardH3>
        <Meta>Search a name or employee number, tap to add them to the list below.</Meta>
        <InputLabel>Search</InputLabel>
        <FieldInput
          placeholder="Name or employee number…"
          value={q} onChangeText={setQ}
          autoCapitalize="none" autoCorrect={false}
        />
      </Card>

      {/* The crew so far, on the same screen as the search. */}
      {picked.length > 0 && (
        <Card>
          <View style={s.pickedHead}>
            <CardH3>Selected · {picked.length}</CardH3>
            <Pressable onPress={() => setPicked([])} hitSlop={8}>
              <Text style={s.clear}>Clear</Text>
            </Pressable>
          </View>
          {picked.map((p) => (
            <View key={p.name} style={s.chipRow}>
              <View style={s.chipDot}>
                <Feather name="user" size={12} color={C.ink3} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.chipName}>{p.employee_name}</Text>
                <Text style={s.chipSub}>{p.name}</Text>
              </View>
              <Pressable onPress={() => toggle(p)} hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${p.employee_name}`}>
                <Feather name="x" size={18} color={C.inkMute} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Card>
        <CardH3>{q.trim() ? "Matches" : "Available"}</CardH3>
        {searching && rows === null
          ? <Spinner text="Searching…" />
          : error
            ? <Empty>{error}</Empty>
            : !rows?.length
              ? <Empty>{q.trim() ? "No one matches that." : "No available employees."}</Empty>
              : rows.map((e) => (
                  <PickRow
                    key={e.name}
                    label={e.employee_name}
                    sub={e.designation ? `${e.name} · ${e.designation}` : e.name}
                    selected={isPicked(e)}
                    showCheck
                    showInitial
                    onPress={() => toggle(e)}
                  />
                ))}
        {rows && rows.length >= 50 && (
          <Meta style={{ marginTop: SP.sm }}>
            Showing the first 50. Type more of the name to narrow it.
          </Meta>
        )}
      </Card>

      <BtnBig
        label={busy
          ? "Adding…"
          : picked.length
            ? `Add ${picked.length} applicator${picked.length === 1 ? "" : "s"}`
            : "Select someone to add"}
        kind={picked.length ? "ink" : "grey"}
        onPress={submit}
        disabled={busy || !picked.length}
      />
    </View>
  );
}

const s = StyleSheet.create({
  pickedHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  clear: { fontFamily: F.medium, fontSize: FS.xs, color: C.inkMute },
  chipRow: {
    flexDirection: "row", alignItems: "center", gap: SP.md,
    paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.hairline,
  },
  chipDot: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.bg,
    alignItems: "center", justifyContent: "center",
  },
  chipName: { fontFamily: F.medium, fontSize: FS.sm, color: C.ink3 },
  chipSub: { fontFamily: F.regular, fontSize: FS.xs, color: C.inkMute, marginTop: 1 },
});
