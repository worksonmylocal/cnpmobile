import { Feather } from "@expo/vector-icons";
import {
  Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, useFonts,
} from "@expo-google-fonts/poppins";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, BackHandler, Image, KeyboardAvoidingView, LayoutChangeEvent, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import {
  SafeAreaProvider, useSafeAreaInsets,
} from "react-native-safe-area-context";
import { call, flushQueue, getQueue, login, writeCall } from "./src/api";
import { clearSession, loadSession, Session } from "./src/auth";
import { CONN_LABEL, useConnection } from "./src/connection";
import {
  currentInstanceUrl, loadInstanceUrl, looksLikeUrl, saveInstanceUrl,
} from "./src/instance";
import { loadSettings, useSettings } from "./src/settings";
import { BOTTOM_NAV, DRAWER, NavState, Plan, PlanMode, TITLES, View as ViewName } from "./src/nav";
import ApplicatorDetail from "./src/screens/ApplicatorDetail";
import Attendance from "./src/screens/Attendance";
import Blocks from "./src/screens/Blocks";
import Correction from "./src/screens/Correction";
import Home from "./src/screens/Home";
import PlanAction from "./src/screens/PlanAction";
import AddApplicators from "./src/screens/AddApplicators";
import {
  PickBlock, PickSection, RecordBlock, RecordPlans, RecordSection,
} from "./src/screens/Pickers";
import SectionPlans from "./src/screens/SectionPlans";
import Settings from "./src/screens/Settings";
import StoreRequests from "./src/screens/StoreRequests";
import Team, { Applicator } from "./src/screens/Team";
import Upcoming from "./src/screens/Upcoming";
import { APP_TITLE, C, F, SP, shadowCard } from "./src/theme";
import { BackLink, BtnBig, FieldInput, Pill, StatusDot, Text } from "./src/ui";
import Changelog, { changelogUnseen, changelogVersion } from "./src/components/Changelog";
import Tutorial from "./src/components/Tutorial";

const LOGO = require("./assets/upande-logo.png");

// Hold the Upande splash until the app has something real to show - fonts,
// the stored session and the display settings - so launch never flashes an
// unstyled or default-sized frame on the way in.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold,
  });
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Settings are read before the first paint so the app never renders at
    // the default size and then jumps to the user's chosen one.
    // The instance URL has to be resolved before anything can call the API.
    Promise.all([loadSession(), loadSettings(), loadInstanceUrl()])
      .then(([s]) => { setSession(s); setBooting(false); });
  }, []);

  const ready = fontsLoaded && !booting;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;   // the splash is still up

  return (
    <SafeAreaProvider>
      {session
        ? <Shell session={session} onLogout={async () => { await clearSession(); setSession(null); }} />
        : <Login onDone={setSession} />}
    </SafeAreaProvider>
  );
}

/* ---------------------------------------------------------------- Login */

function Login({ onDone }: { onDone: (s: Session) => void }) {
  const [usr, setUsr] = useState("");
  const [pwd, setPwd] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hidden until the logo is held down. The server is set once per device and
  // then never again, so showing the field on every sign-in only invites
  // someone to edit a URL that was already correct.
  const [showServer, setShowServer] = useState(false);
  const [server, setServer] = useState(currentInstanceUrl());
  const [savedNote, setSavedNote] = useState<string | null>(null);

  async function saveServer() {
    if (!looksLikeUrl(server)) {
      setError("That does not look like a server address. Example: kaitet-group.upande.com");
      return;
    }
    const url = await saveInstanceUrl(server);
    setServer(url);
    setError(null);
    setSavedNote(`Saved. This device will use ${url}.`);
  }

  async function submit() {
    if (busy) return;
    const email = usr.trim();
    // Catch the empty case here rather than letting the server answer it -
    // a blank submit isn't a failed sign-in, it's a form that isn't filled in.
    if (!email || !pwd) {
      setError(!email && !pwd
        ? "Enter your email and password to sign in."
        : !email ? "Enter your email to sign in."
        : "Enter your password to sign in.");
      return;
    }
    setBusy(true); setError(null);
    try { onDone(await login(email, pwd)); }
    catch (e) {
      const err = e as Error & { isNetworkError?: boolean };
      // A wrong server address fails exactly like no signal, so say which
      // server was tried and how to change it.
      setError(err.isNetworkError
        ? `Could not reach ${currentInstanceUrl()}. Check your connection, or hold the logo to change the server.`
        : err.message);
    }
    finally { setBusy(false); }
  }

  // Clear the message as soon as they start fixing it, so a stale error
  // never sits under a field they've already corrected.
  const edit = (set: (v: string) => void) => (v: string) => { set(v); if (error) setError(null); };

  /**
   * Scroll a field clear of the keyboard when it takes focus.
   *
   * Shrinking the view is only half of it: the form is centred, so the field
   * being typed into can still end up behind the keyboard - which is exactly
   * what happened once the server box pushed everything down. Each field
   * records where it sits, and focusing it scrolls that point near the top.
   */
  const scroll = useRef<ScrollView>(null);
  const tops = useRef<Record<string, number>>({});

  const field = (key: string) => ({
    onLayout: (e: LayoutChangeEvent) => { tops.current[key] = e.nativeEvent.layout.y; },
    onFocus: () => {
      const y = tops.current[key];
      if (y === undefined) return;
      // A small margin above, so the field is not flush against the top edge.
      requestAnimationFrame(() =>
        scroll.current?.scrollTo({ y: Math.max(0, y - 28), animated: true }));
    },
  });

  return (
    // "padding" on Android too. It was passed undefined there, which makes the
    // component inert - which is why the keyboard sat on top of the fields
    // instead of the form moving out from under it. RN's own implementation
    // does subscribe to keyboardDidShow on Android; it just needs a behavior.
    <KeyboardAvoidingView style={s.page} behavior="padding">
      <StatusBar style="dark" />
      <ScrollView
        ref={scroll}
        contentContainerStyle={s.loginScroll}
        keyboardShouldPersistTaps="handled"
        // Room to scroll the last field clear of the keyboard; without it
        // there is nothing below the button to scroll into.
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* The logo doubles as the way in to the server field: hold it for two
            seconds. Discoverable to whoever is told, invisible to everyone
            else, and impossible to hit by accident. */}
        <Pressable
          onLongPress={() => { setShowServer((v) => !v); setSavedNote(null); }}
          delayLongPress={2000}
          accessibilityRole="button"
          accessibilityLabel="Upande logo. Hold for two seconds to change the server address."
        >
          <Image source={LOGO} style={s.loginLogo} resizeMode="contain" />
        </Pressable>
        <Text style={s.loginTitle}>{APP_TITLE}</Text>
        <Text style={s.loginSub}>Sign in to continue.</Text>

        {showServer && (
          <View style={s.serverBox} onLayout={field("server").onLayout}>
            <Text style={s.serverLabel}>SERVER ADDRESS</Text>
            <FieldInput
              placeholder="kaitet-group.upande.com"
              autoCapitalize="none" autoCorrect={false} keyboardType="url"
              value={server}
              onChangeText={(v) => { setServer(v); setSavedNote(null); }}
              onFocus={field("server").onFocus}
            />
            <Text style={s.serverHint}>
              Kept on this device and reused after you sign out.
            </Text>
            <BtnBig label="Save server" kind="grey" onPress={saveServer} />
          </View>
        )}

        {savedNote && <Text style={s.savedNote}>{savedNote}</Text>}

        <View onLayout={field("email").onLayout} style={s.fieldWrap}>
          <FieldInput placeholder="Email" autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" value={usr} onChangeText={edit(setUsr)}
            onFocus={field("email").onFocus} returnKeyType="next" />
        </View>

        <View style={s.pwdWrap} onLayout={field("password").onLayout}>
          <FieldInput placeholder="Password" autoCapitalize="none" autoCorrect={false}
            secureTextEntry={!reveal} value={pwd} onChangeText={edit(setPwd)}
            onFocus={field("password").onFocus}
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
  const [settings] = useSettings();
  const insets = useSafeAreaInsets();
  // Clear both the quick bar and whatever the system navigation takes.
  const barHeight = settings.bottomNav ? 78 + insets.bottom : insets.bottom;
  const [drawer, setDrawer] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [conn, recheck] = useConnection();
  const [howTo, setHowTo] = useState(false);
  const [whatsNew, setWhatsNew] = useState(false);
  const [hasNews, setHasNews] = useState(false);

  // Surface the changelog once per release, on the first screen after signing
  // in. Checked rather than assumed, so a reinstall of the same build stays
  // quiet.
  useEffect(() => {
    changelogUnseen().then((unseen) => {
      setHasNews(unseen);
      if (unseen) setWhatsNew(true);
    });
  }, []);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const roster = useRef<Record<string, Applicator>>({});

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), 2800);
  }, []);

  /**
   * Where the hardware back button goes. Android's back is the gesture people
   * actually use, and without a history of its own every press fell through to
   * "close the app" - so opening the menu and pressing back shut the whole
   * thing down mid-shift.
   *
   * Only forward moves are recorded. Going back pops, so walking in and out of
   * a screen cannot build a stack that takes ten presses to escape.
   */
  const history = useRef<NavState[]>([{ view: "home" }]);

  const go = useCallback((patch: Partial<NavState> & { view: ViewName }) => {
    setDrawer(false);
    setNav((cur) => {
      const next = { ...cur, ...patch };
      const top = history.current[history.current.length - 1];
      if (!top || top.view !== next.view) history.current.push(next);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    // Anything covering the screen closes first: back means "undo the last
    // thing that appeared", and a dialog is the last thing that appeared.
    if (confirmLogout) { setConfirmLogout(false); return true; }
    if (drawer) { setDrawer(false); return true; }
    if (history.current.length > 1) {
      history.current.pop();
      setNav(history.current[history.current.length - 1]);
      return true;
    }
    return false;   // on home with nothing open: let Android close the app
  }, [confirmLogout, drawer]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => sub.remove();
  }, [goBack]);

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
        return <Home user={session.user} reloadKey={reloadKey} />;
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
            <AddApplicators
              block={nav.pickedBlock ?? undefined}
              toast={toast}
              onDone={() => { go({ view: "team" }); bump(); }}
            />
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
      case "attendance":
        return <Attendance reloadKey={reloadKey} toast={toast} />;
      case "settings":
        return (
          <Settings
            user={session.user}
            pending={pending}
            onSync={async () => {
              const n = await flushQueue();
              toast(n ? `${n} pending item${n > 1 ? "s" : ""} synced` : "Nothing to sync");
              bump(); syncPending();
            }}
          />
        );
      case "correction":
        return <Correction />;
    }
  }

  return (
    <View style={s.page}>
      <StatusBar style="dark" />
      {/* Wrapping only the scroller: the quick bar and the toast are siblings
          below, so the keyboard lifts the content without dragging the
          furniture up with it. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        contentContainerStyle={[s.app, { paddingBottom: barHeight + 120 }]}
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
          {/* Same corner on every screen, so it is glanced at rather than
              hunted for. */}
          <Pressable onPress={recheck} hitSlop={10} accessibilityRole="button"
            accessibilityLabel={`Connection: ${CONN_LABEL[conn]}. Tap to re-check.`}>
            <StatusDot state={conn} />
          </Pressable>
        </View>

        {body()}
      </ScrollView>
      </KeyboardAvoidingView>

      {settings.bottomNav && (
        <BottomNav current={nav.view} onGo={(v) => go({ view: v })} big={settings.bigTouch} />
      )}

      <Drawer
        open={drawer}
        current={nav.view}
        user={session.user}
        onClose={() => setDrawer(false)}
        onGo={(v) => go({ view: v })}
        version={changelogVersion()}
        hasNews={hasNews}
        onLogout={() => { setDrawer(false); setConfirmLogout(true); }}
        // Let the drawer finish sliding out before a sheet slides in -
        // two animations at once reads as a glitch.
        onHowTo={() => { setDrawer(false); setTimeout(() => setHowTo(true), 250); }}
        onWhatsNew={() => { setDrawer(false); setTimeout(() => setWhatsNew(true), 250); }}
      />

      <Tutorial open={howTo} onClose={() => setHowTo(false)} />
      <Changelog
        open={whatsNew}
        onClose={() => { setWhatsNew(false); setHasNews(false); }}
      />

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        body={`You are signed in as ${session.user}. You'll need your email and password to get back in.`}
        confirmLabel="Log out"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => { setConfirmLogout(false); onLogout(); }}
      />

      {toastMsg && (
        <View style={[s.toast, { bottom: barHeight + 18 }]} pointerEvents="none">
          <Text style={s.toastText}>{toastMsg}</Text>
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------ Confirm */

/**
 * An in-app confirm, deliberately not Alert.alert: the OS dialog is styled
 * by Android, not by us, so it lands in the middle of a Poppins, rounded-card
 * app looking like a different product. Same card, same buttons, same type as
 * everything else.
 */
function ConfirmDialog({
  open, title, body, confirmLabel, onCancel, onConfirm,
}: {
  open: boolean; title: string; body: string; confirmLabel: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      {/* tapping the scrim cancels, the same as the drawer */}
      <Pressable style={s.confirmOverlay} onPress={onCancel}>
        <Pressable style={s.confirmCard} onPress={() => {}}>
          <Text style={s.confirmTitle}>{title}</Text>
          <Text style={s.confirmBody}>{body}</Text>
          <View style={s.confirmRow}>
            <BtnBig label="Cancel" kind="grey" style={s.confirmBtn} onPress={onCancel} />
            <BtnBig label={confirmLabel} kind="ink" style={s.confirmBtn} onPress={onConfirm} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ----------------------------------------------------------- Bottom nav */

function BottomNav({
  current, onGo, big,
}: {
  current: ViewName;
  onGo: (v: ViewName) => void;
  big: boolean;
}) {
  // Android draws edge-to-edge, so without the inset the bar sits underneath
  // the system back/home/recents controls and its right-hand items become
  // unreachable. Gesture-navigation phones report a small inset; three-button
  // navigation reports a tall one.
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        s.bnav,
        big && { paddingTop: 10 },
        { paddingBottom: Math.max(insets.bottom, big ? 14 : 10) },
      ]}
    >
      {BOTTOM_NAV.map((n) => {
        const on = n.view === current;
        return (
          <Pressable
            key={n.view}
            style={[s.bnavItem, on && s.bnavItemOn]}
            onPress={() => onGo(n.view)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n.label}
          >
            <Feather
              name={n.icon as React.ComponentProps<typeof Feather>["name"]}
              size={big ? 23 : 20}
              color={on ? C.ink : C.inkMute}
            />
            <Text style={[s.bnavLabel, on && s.bnavLabelOn]}>{n.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* --------------------------------------------------------------- Drawer */

function Drawer({
  open, current, user, version, hasNews,
  onClose, onGo, onLogout, onHowTo, onWhatsNew,
}: {
  open: boolean; current: ViewName; user: string; version: string;
  hasNews: boolean;
  onClose: () => void; onGo: (v: ViewName) => void; onLogout: () => void;
  onHowTo: () => void; onWhatsNew: () => void;
}) {
  const x = useRef(new Animated.Value(-260)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: open ? 0 : -260, duration: 250, useNativeDriver: true }).start();
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
            {/* Below the rule: things you do, not places you go. */}
            <View style={s.drawerSep} />

            <Pressable style={s.drawerItem} onPress={onHowTo}>
              <View style={[s.drawerBubble, { backgroundColor: C.goodBg }]}>
                <Feather name="help-circle" size={14} color={C.good} />
              </View>
              <Text style={s.drawerItemText}>How to Use</Text>
            </Pressable>

            <Pressable style={s.drawerItem} onPress={onWhatsNew}>
              <View style={[s.drawerBubble, { backgroundColor: C.infoBg }]}>
                <Feather name="gift" size={14} color={C.info} />
              </View>
              <Text style={s.drawerItemText}>What's New</Text>
              {hasNews && <View style={s.newsDot} />}
            </Pressable>

            <Pressable style={s.drawerItem} onPress={onLogout}>
              <View style={[s.drawerBubble, { backgroundColor: C.badBg }]}>
                <Feather name="log-out" size={14} color={C.bad} />
              </View>
              <Text style={s.drawerItemText}>Log out</Text>
            </Pressable>

            <Text style={s.drawerFooter}>
              Signed in as {user}{"\n"}{APP_TITLE} v{version}
            </Text>
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
    flexGrow: 1, justifyContent: "center", alignItems: "center",
    maxWidth: 480, width: "100%",
    alignSelf: "center", padding: 24,
    // Deep enough that focusing the password field can always scroll it clear
    // of the keyboard, even with the server box open above it. Without slack
    // below the button there is nothing to scroll into.
    paddingBottom: 220,
  },
  fieldWrap: { width: "100%" },
  loginLogo: { height: 72, width: 79, marginBottom: 14 },
  serverBox: {
    width: "100%", backgroundColor: C.surface, borderRadius: 18,
    padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.hairline,
  },
  serverLabel: {
    fontFamily: F.semibold, fontSize: 10, letterSpacing: 0.8,
    color: C.inkMute, marginBottom: 8,
  },
  serverHint: {
    fontFamily: F.regular, fontSize: 11, color: C.inkMute,
    marginTop: 6, marginBottom: 10, lineHeight: 16,
  },
  savedNote: {
    fontFamily: F.medium, fontSize: 12, color: C.good,
    marginBottom: 12, lineHeight: 18,
  },
  loginTitle: {
    fontFamily: F.semibold, fontSize: 24, color: C.ink, letterSpacing: -0.4,
    textAlign: "center",
  },
  loginSub: {
    fontFamily: F.regular, fontSize: 13, color: C.inkMute, marginBottom: 18,
    textAlign: "center",
  },
  // width matters here: the centring above would otherwise shrink this
  // wrapper to its content and pull the password field out of line.
  pwdWrap: { position: "relative", justifyContent: "center", width: "100%" },
  pwdInput: { paddingRight: 52 },
  eye: { position: "absolute", right: 14, height: 40, width: 34, alignItems: "center", justifyContent: "center" },
  error: {
    fontFamily: F.medium, fontSize: 13, color: C.bad, marginTop: 6, lineHeight: 19,
    textAlign: "center",
  },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 4, marginBottom: 8, marginTop: 44,
  },
  hamburger: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface2,
    alignItems: "center", justifyContent: "center", ...shadowCard,
  },
  confirmOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center", justifyContent: "center", padding: 28,
  },
  confirmCard: {
    width: "100%", maxWidth: 380, backgroundColor: C.surface2,
    borderRadius: 24, padding: 22, ...shadowCard,
  },
  confirmTitle: { fontFamily: F.semibold, fontSize: 18, color: C.ink, marginBottom: 6 },
  confirmBody: { fontFamily: F.regular, fontSize: 13, color: C.inkMute, lineHeight: 19, marginBottom: 18 },
  confirmRow: { flexDirection: "row", gap: 10 },
  confirmBtn: { flex: 1, marginTop: 0, width: undefined },
  headerTitle: { fontFamily: F.semibold, fontSize: 17, color: C.ink, letterSpacing: -0.2 },
  headerSub: { fontFamily: F.regular, fontSize: 12, color: C.inkMute },

  // A deeper scrim than before: the panel is narrower now, so the contrast
  // between it and the page behind is what makes it read as a layer.
  overlay: { flex: 1, backgroundColor: "rgba(10,10,10,0.52)" },
  drawer: {
    position: "absolute", top: 0, left: 0, bottom: 0, width: 244,
    backgroundColor: C.bg, paddingTop: 44, paddingHorizontal: 12, paddingBottom: 20,
    borderTopRightRadius: 22, borderBottomRightRadius: 22,
    // A hairline along the open edge, so the panel has a defined edge rather
    // than bleeding into the scrim.
    borderRightWidth: 1, borderRightColor: C.hairline,
  },
  drawerBrand: {
    flexDirection: "row", alignItems: "center", gap: 9,
    paddingHorizontal: 10, paddingBottom: 14, marginBottom: 8,
    borderBottomWidth: 1, borderBottomColor: C.hairline,
  },
  drawerLogo: { height: 22, width: 25 },
  drawerBrandText: {
    fontFamily: F.semibold, fontSize: 13, color: C.ink, letterSpacing: -0.1,
  },
  drawerItem: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingVertical: 11, paddingHorizontal: 11, borderRadius: 12,
    marginBottom: 2,
  },
  // The selected row is the one piece of ink in the panel, which is what makes
  // it findable at a glance on an off-white ground.
  drawerItemOn: { backgroundColor: C.ink },
  drawerIcon: { fontSize: 14, width: 20, textAlign: "center" },
  drawerItemText: {
    fontFamily: F.medium, fontSize: 13.5, color: C.ink3, flex: 1,
    letterSpacing: -0.1,
  },
  drawerSep: {
    height: 1, backgroundColor: C.hairline,
    marginVertical: SP.sm, marginHorizontal: 11,
  },
  drawerBubble: {
    width: 24, height: 24, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  // An unread marker, not a count: there is either something new or there
  // isn't, and a number would only invite counting.
  newsDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.info },
  drawerFooter: {
    marginTop: 18, paddingHorizontal: 11, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.hairline,
    fontFamily: F.regular, fontSize: 10.5, color: C.inkMute, lineHeight: 15,
  },

  bnav: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", backgroundColor: C.surface2,
    borderTopWidth: 1, borderTopColor: C.hairline,
    paddingTop: 6, paddingBottom: 10, paddingHorizontal: 4,
    shadowColor: "#0a0a0a", shadowOpacity: 0.06, shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 }, elevation: 12,
  },
  bnavItem: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 3, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 12,
  },
  bnavItemOn: { backgroundColor: C.grey },
  bnavLabel: { fontFamily: F.semibold, fontSize: 10, letterSpacing: 0.2, color: C.inkMute },
  bnavLabelOn: { color: C.ink },
  toast: {
    position: "absolute", bottom: 28, alignSelf: "center", maxWidth: "90%",
    backgroundColor: C.ink, paddingVertical: 13, paddingHorizontal: 22, borderRadius: 12,
  },
  toastText: { fontFamily: F.medium, fontSize: 14, color: C.onInk, textAlign: "center" },
});
