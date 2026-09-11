import { Feather } from "@expo/vector-icons";
import {
  Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, useFonts,
} from "@expo-google-fonts/poppins";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Image, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { call, flushQueue, getQueue, login, writeCall } from "./src/api";
import { clearSession, loadSession, Session } from "./src/auth";
import { DRAWER, NavState, Plan, PlanMode, TITLES, View as ViewName } from "./src/nav";
import ApplicatorDetail from "./src/screens/ApplicatorDetail";
import Blocks from "./src/screens/Blocks";
import Correction from "./src/screens/Correction";
import Home from "./src/screens/Home";
import PlanAction from "./src/screens/PlanAction";
import {
  AddEmployee, PickBlock, PickSection, RecordBlock, RecordPlans, RecordSection,
} from "./src/screens/Pickers";
import SectionPlans from "./src/screens/SectionPlans";
import StoreRequests from "./src/screens/StoreRequests";
import Team, { Applicator } from "./src/screens/Team";
import Upcoming from "./src/screens/Upcoming";
import { APP_TITLE, C, F, shadowCard } from "./src/theme";
import { BackLink, BtnBig, FieldInput, Pill } from "./src/ui";

const LOGO = require("./assets/upande-logo.png");

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold,
  });
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => { loadSession().then((s) => { setSession(s); setBooting(false); }); }, []);

  if (!fontsLoaded || booting) {
    return <View style={s.boot}><ActivityIndicator size="large" color={C.ink} /></View>;
  }
  return session
    ? <Shell session={session} onLogout={async () => { await clearSession(); setSession(null); }} />
    : <Login onDone={setSession} />;
}

/* ---------------------------------------------------------------- Login */

function Login({ onDone }: { onDone: (s: Session) => void }) {
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    try { onDone(await login(usr.trim(), pwd)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.loginScroll} keyboardShouldPersistTaps="handled">
        <Image source={LOGO} style={s.loginLogo} resizeMode="contain" />
        <Text style={s.loginTitle}>{APP_TITLE}</Text>
        <Text style={s.loginSub}>Sign in to continue.</Text>

        <FieldInput placeholder="Email" autoCapitalize="none" autoCorrect={false}
          keyboardType="email-address" value={usr} onChangeText={setUsr} />

        <View style={s.pwdWrap}>
          <FieldInput placeholder="Password" autoCapitalize="none" autoCorrect={false}
            secureTextEntry={!reveal} value={pwd} onChangeText={setPwd}
            onSubmitEditing={submit} returnKeyType="go" style={s.pwdInput} />
          <Pressable style={s.eye} onPress={() => setReveal((v) => !v)} hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={reveal ? "Hide password" : "Show password"}>
            <Feather name={reveal ? "eye-off" : "eye"} size={20} color={C.inkMute} />
          </Pressable>
        </View>

        {error && <Text style={s.error}>{error}</Text>}

        <BtnBig label={busy ? "Signing in…" : "Log in"} kind="ink" onPress={submit} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------------------------------------------------------------- Shell */

function Shell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [nav, setNav] = useState<NavState>({ view: "home" });
  const [drawer, setDrawer] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const roster = useRef<Record<string, Applicator>>({});

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const go = useCallback((patch: Partial<NavState> & { view: ViewName }) => {
    setDrawer(false);
    setNav((cur) => ({ ...cur, ...patch }));
  }, []);

  const bump = useCallback(() => setReloadKey((k) => k + 1), []);

  const syncPending = useCallback(async () => setPending((await getQueue()).length), []);
  useEffect(() => { syncPending(); }, [syncPending, reloadKey, nav.view]);

  // The web page's "online" listener plus its 30s interval.
  useEffect(() => {
    const tick = async () => {
      const n = await flushQueue();
      if (n) { toast(`${n} pending item${n > 1 ? "s" : ""} synced`); bump(); }
      syncPending();
    };
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [toast, bump, syncPending]);

  const headerSub =
    nav.view === "section-plans" ? nav.section ?? "Section"
      : nav.view === "pick-block" ? nav.pickedSection ?? "Choose Block"
        : nav.view === "record-block" ? nav.recordSection ?? "Choose Block"
          : nav.view === "add-employee" ? `Assign to ${nav.pickedBlock ?? "block"}`
            : TITLES[nav.view];

  async function onRefresh() {
    setRefreshing(true);
    await flushQueue();
    bump();
    await syncPending();
    setRefreshing(false);
  }

  /* Record Application: a block with one issued plan skips the product step. */
  async function selectRecordBlock(block: string) {
    try {
      const plans = await call<Plan[]>("get_pending_plans_for_block", { block });
      const issued = (plans ?? []).filter((p) => p.status === "Issued");
      if (issued.length === 1) {
        go({ view: "plan-action", plan: issued[0], planMode: "record", planReturn: "record-block" });
      } else if (issued.length > 1) {
        go({ view: "record-plans", recordPlans: issued });
      } else {
        toast("Nothing ready to record on this block.");
      }
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function doAddApplicator(employee: string) {
    try {
      await writeCall("add_applicator", { employee });
      if (nav.pickedBlock) await writeCall("assign_block", { employee, block: nav.pickedBlock });
      toast("Applicator added");
      go({ view: "team" }); bump();
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message);
      if (err.queued) go({ view: "team" });
    }
  }

  async function doReassign(block: string) {
    try {
      await writeCall("assign_block", { employee: nav.reassignEmployee, block });
      toast("Block reassigned");
      go({ view: "team" }); bump();
    } catch (e) {
      const err = e as Error & { queued?: boolean };
      toast(err.message);
      if (err.queued) go({ view: "team" });
    }
  }

  const planBack = () => {
    const back = nav.planReturn;
    if (back) go({ view: back });
    else if (nav.section) go({ view: "section-plans" });
    else go({ view: "upcoming" });
    bump();
  };

  function body() {
    switch (nav.view) {
      case "home":
        return <Home user={session.user} reloadKey={reloadKey}
          onGo={(v) => go({ view: v })} />;
      case "blocks":
        return <Blocks key={reloadKey} />;
      case "upcoming":
        return <Upcoming key={reloadKey}
          onOpen={(section) => go({ view: "section-plans", section })} />;
      case "section-plans":
        return (
          <>
            <BackLink label="Back to sections" onPress={() => go({ view: "upcoming" })} />
            <SectionPlans key={`${nav.section}-${reloadKey}`} section={nav.section!}
              onOpenPlan={(plan, mode) =>
                go({ view: "plan-action", plan, planMode: mode, planReturn: "section-plans" })} />
          </>
        );
      case "plan-action":
        return (
          <>
            <BackLink label="Back" onPress={planBack} />
            <PlanAction plan={nav.plan!} mode={nav.planMode as PlanMode}
              onBack={planBack} toast={toast} />
          </>
        );
      case "store-requests":
        return <StoreRequests key={reloadKey} />;
      case "team":
        return (
          <Team
            key={reloadKey}
            toast={toast}
            registerRoster={(m) => { roster.current = m; }}
            onAdd={() => go({ view: "pick-section", pickPurpose: "add", pickedBlock: null,
              addEmployeeReturn: "pick-block" })}
            onQuickAdd={(block) => go({ view: "add-employee", pickPurpose: "add",
              pickedBlock: block, addEmployeeReturn: "team" })}
            onOpenApplicator={(a) => go({ view: "applicator-detail", applicator: a.name })}
          />
        );
      case "applicator-detail": {
        const a = roster.current[nav.applicator!] ??
          { name: nav.applicator!, employee_name: nav.applicator! };
        return (
          <>
            <BackLink label="Back to team" onPress={() => go({ view: "team" })} />
            <ApplicatorDetail applicator={a} toast={toast}
              onReassign={(employee) => go({ view: "pick-section", pickPurpose: "reassign",
                reassignEmployee: employee })}
              onDone={() => { go({ view: "team" }); bump(); }} />
          </>
        );
      }
      case "pick-section":
        return (
          <>
            <BackLink label="Cancel" onPress={() => go({ view: "team" })} />
            <PickSection onSelect={(pickedSection) => go({ view: "pick-block", pickedSection })} />
          </>
        );
      case "pick-block":
        return (
          <>
            <BackLink label="Back" onPress={() => go({ view: "pick-section" })} />
            <PickBlock section={nav.pickedSection!} onSelect={(block) => {
              if (nav.pickPurpose === "add") go({ view: "add-employee", pickedBlock: block });
              else doReassign(block);
            }} />
          </>
        );
      case "add-employee":
        return (
          <>
            <BackLink label="Back"
              onPress={() => go({ view: nav.addEmployeeReturn ?? "pick-block" })} />
            <AddEmployee onSelect={doAddApplicator} />
          </>
        );
      case "record-section":
        return <RecordSection onSelect={(recordSection) =>
          go({ view: "record-block", recordSection })} />;
      case "record-block":
        return (
          <>
            <BackLink label="Back" onPress={() => go({ view: "record-section" })} />
            <RecordBlock section={nav.recordSection!} onSelect={selectRecordBlock} />
          </>
        );
      case "record-plans":
        return (
          <>
            <BackLink label="Back" onPress={() => go({ view: "record-block" })} />
            <RecordPlans plans={nav.recordPlans ?? []} onSelect={(plan) =>
              go({ view: "plan-action", plan, planMode: "record", planReturn: "record-plans" })} />
          </>
        );
      case "correction":
        return <Correction />;
    }
  }

  return (
    <View style={s.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={s.app}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.ink} />}
      >
        <View style={s.header}>
          <Pressable style={s.hamburger} onPress={() => setDrawer(true)} hitSlop={8}
            accessibilityRole="button" accessibilityLabel="Open menu">
            <Feather name="menu" size={18} color={C.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>{APP_TITLE}</Text>
            <Text style={s.headerSub} numberOfLines={1}>{headerSub}</Text>
          </View>
          {pending > 0 && <Pill kind="warn">{pending} pending sync</Pill>}
          {nav.view !== "home" && (
            <Pressable style={s.homeBtn} onPress={() => go({ view: "home" })} hitSlop={8}
              accessibilityRole="button" accessibilityLabel="Back to home">
              <Feather name="home" size={17} color={C.ink3} />
            </Pressable>
          )}
        </View>

        {body()}
      </ScrollView>

      <Drawer
        open={drawer}
        current={nav.view}
        user={session.user}
        onClose={() => setDrawer(false)}
        onGo={(v) => go({ view: v })}
        onLogout={onLogout}
      />

      {toastMsg && (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText}>{toastMsg}</Text>
        </View>
      )}
    </View>
  );
}

/* --------------------------------------------------------------- Drawer */

function Drawer({
  open, current, user, onClose, onGo, onLogout,
}: {
  open: boolean; current: ViewName; user: string;
  onClose: () => void; onGo: (v: ViewName) => void; onLogout: () => void;
}) {
  const x = useRef(new Animated.Value(-300)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: open ? 0 : -300, duration: 250, useNativeDriver: true }).start();
  }, [open, x]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Animated.View style={[s.drawer, { transform: [{ translateX: x }] }]}>
          <Pressable onPress={() => {}}>
            <View style={s.drawerBrand}>
              <Image source={LOGO} style={s.drawerLogo} resizeMode="contain" />
              <Text style={s.drawerBrandText}>{APP_TITLE}</Text>
            </View>
            {DRAWER.map((item) => {
              const on = item.view === current;
              return (
                <Pressable key={item.view}
                  style={[s.drawerItem, on && s.drawerItemOn]}
                  onPress={() => onGo(item.view)}>
                  <Text style={s.drawerIcon}>{item.icon}</Text>
                  <Text style={[s.drawerItemText, on && { color: C.onInk }]}>{item.label}</Text>
                </Pressable>
              );
            })}
            <Pressable style={s.drawerItem} onPress={onLogout}>
              <Text style={s.drawerIcon}>🚪</Text>
              <Text style={s.drawerItemText}>Log out</Text>
            </Pressable>
            <Text style={s.drawerFooter}>Signed in as {user}</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/* --------------------------------------------------------------- Styles */

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  boot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  app: { maxWidth: 480, width: "100%", alignSelf: "center", padding: 16, paddingBottom: 40 },

  loginScroll: {
    flexGrow: 1, justifyContent: "center", maxWidth: 480, width: "100%",
    alignSelf: "center", padding: 24, paddingBottom: 40,
  },
  loginLogo: { height: 64, width: 72, marginBottom: 20 },
  loginTitle: { fontFamily: F.semibold, fontSize: 24, color: C.ink, letterSpacing: -0.4 },
  loginSub: { fontFamily: F.regular, fontSize: 13, color: C.inkMute, marginBottom: 18 },
  pwdWrap: { position: "relative", justifyContent: "center" },
  pwdInput: { paddingRight: 52 },
  eye: { position: "absolute", right: 14, height: 40, width: 34, alignItems: "center", justifyContent: "center" },
  error: { fontFamily: F.medium, fontSize: 13, color: C.bad, marginTop: 6, lineHeight: 19 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 4, marginBottom: 8, marginTop: 44,
  },
  hamburger: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface2,
    alignItems: "center", justifyContent: "center", ...shadowCard,
  },
  homeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2,
    alignItems: "center", justifyContent: "center", ...shadowCard,
  },
  headerTitle: { fontFamily: F.semibold, fontSize: 17, color: C.ink, letterSpacing: -0.2 },
  headerSub: { fontFamily: F.regular, fontSize: 12, color: C.inkMute },

  overlay: { flex: 1, backgroundColor: "rgba(10,10,10,0.4)" },
  drawer: {
    position: "absolute", top: 0, left: 0, bottom: 0, width: 280,
    backgroundColor: C.surface2, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 24,
    borderTopRightRadius: 24, borderBottomRightRadius: 24,
  },
  drawerBrand: { flexDirection: "row", alignItems: "center", gap: 10, padding: 8, paddingBottom: 20 },
  drawerLogo: { height: 24, width: 27 },
  drawerBrandText: { fontFamily: F.semibold, fontSize: 14, color: C.ink },
  drawerItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14,
  },
  drawerItemOn: { backgroundColor: C.gradInk },
  drawerIcon: { fontSize: 15 },
  drawerItemText: { fontFamily: F.semibold, fontSize: 14, color: C.ink3, flex: 1 },
  drawerFooter: { marginTop: 24, paddingHorizontal: 8, fontFamily: F.regular, fontSize: 11, color: C.inkMute },

  toast: {
    position: "absolute", bottom: 28, alignSelf: "center", maxWidth: "90%",
    backgroundColor: C.ink, paddingVertical: 13, paddingHorizontal: 22, borderRadius: 12,
  },
  toastText: { fontFamily: F.medium, fontSize: 14, color: C.onInk, textAlign: "center" },
});
