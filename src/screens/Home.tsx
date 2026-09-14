import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { call } from "../api";
import { C, F, shadowCard } from "../theme";
import { Text } from "../ui";

type Metrics = {
  pending_applications: number; ready_to_record: number; progress_pct: number;
  applied: number; total_plans: number; my_applications: number;
  applications_today: number; pending_requests: number;
};

export default function Home({
  user, reloadKey,
}: {
  user: string;
  reloadKey: number;
}) {
  const [m, setM] = useState<Metrics | null>(null);
  const [upcoming, setUpcoming] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Metrics>("get_home_metrics")
      .then((d) => { setM(d); setError(null); })
      .catch((e) => setError((e as Error).message || "Could not load metrics."));
    // As on the web page, a failure here is silent - the tile just stays blank.
    call<{ upcoming?: unknown[] }>("get_upcoming_and_overdue")
      .then((d) => setUpcoming((d?.upcoming ?? []).length))
      .catch(() => {});
  }, [reloadKey]);

  const pct = m?.progress_pct ?? 0;

  return (
    <View>
      <Text style={s.greeting}>Hello, {user.split("@")[0] || "there"}</Text>
      <Text style={s.greetingSub}>Here's what's happening today.</Text>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardH3}>Season progress</Text>
          <Text style={s.cardPct}>{m ? `${pct}%` : "–"}</Text>
        </View>
        <View style={s.bigbar}>
          <View style={[s.bigbarFill, { width: `${Math.max(0, Math.min(pct, 100))}%` }]}>
            {pct >= 12 && <Text style={s.bigbarText}>{pct}%</Text>}
          </View>
        </View>
        <Text style={s.cardMeta}>
          {error
            ? error
            : m
              ? `${m.applied} of ${m.total_plans} applications done across the farm`
              : "–"}
        </Text>
      </View>

      <View style={s.statGrid}>
        <Stat label="PENDING APPLICATIONS" value={m?.pending_applications} />
        <Stat label="READY TO RECORD" value={m?.ready_to_record} />
        <Stat label="PENDING STORE REQUESTS" value={m?.pending_requests} />
        <Stat label="RECORDED BY YOU" value={m?.my_applications} />
        <Stat label="APPLICATIONS TODAY" value={m?.applications_today} />
        <Stat label="UPCOMING BLOCKS" value={upcoming} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value?: number | null }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value ?? "–"}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  greeting: { fontFamily: F.semibold, fontSize: 20, color: C.ink, marginTop: 4, marginBottom: 2 },
  greetingSub: { fontFamily: F.regular, fontSize: 13, color: C.inkMute, marginBottom: 20 },
  card: {
    backgroundColor: C.surface2, borderRadius: 24, paddingVertical: 18,
    paddingHorizontal: 20, marginBottom: 14, ...shadowCard,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  cardH3: { fontFamily: F.semibold, fontSize: 16, color: C.ink, marginBottom: 4 },
  cardPct: { fontFamily: F.semibold, fontSize: 15, color: C.ink },
  cardMeta: { fontFamily: F.regular, fontSize: 12, color: C.inkMute, marginTop: 8 },
  bigbar: { height: 26, borderRadius: 999, backgroundColor: C.track, overflow: "hidden" },
  bigbarFill: {
    height: "100%", borderRadius: 999, backgroundColor: C.gradInk,
    alignItems: "center", justifyContent: "center",
  },
  bigbarText: { fontFamily: F.semibold, fontSize: 11, color: C.onInk },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  statCard: {
    backgroundColor: C.surface2, borderRadius: 20, padding: 20,
    flexGrow: 1, flexBasis: "45%", ...shadowCard,
  },
  statLabel: { fontFamily: F.medium, fontSize: 11, letterSpacing: 1, color: C.inkMute, marginBottom: 8 },
  statValue: { fontFamily: F.semibold, fontSize: 32, color: C.ink, letterSpacing: -1 },
});
