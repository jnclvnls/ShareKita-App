import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, FlatList, StyleSheet, Alert, Image, Platform, Animated, Easing, ScrollView,
} from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import * as DocumentPicker from 'expo-document-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { useStore, Item } from './store';
import { startSending, receiveFrom, parseOffer, PickedFile } from './engine';
import { formatBytes, formatSpeed } from './utils';

/* ── Theme: white + yellow ── */
export const C = {
  bg: '#FFFFFF',
  yellow: '#FFC400',
  yellowDeep: '#F5A800',
  yellowSoft: '#FFF6D6',
  yellowTint: '#FFFBEA',
  text: '#1C1B1F',
  mute: '#8A8577',
  line: '#F1EBD5',
  ok: '#22A559',
  bad: '#E5484D',
};

/* ── Icons (react-native-svg, no extra deps) ── */
type IconName = 'up' | 'down' | 'clock' | 'home' | 'back' | 'file' | 'trash';
export function Icon({ name, size = 24, color = C.text }: { name: IconName; size?: number; color?: string }) {
  const p = { stroke: color, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'up' && <Path d="M12 19V5M5 12l7-7 7 7" {...p} />}
      {name === 'down' && <Path d="M12 5v14M5 12l7 7 7-7" {...p} />}
      {name === 'back' && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === 'clock' && (<><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5l3 2" {...p} /></>)}
      {name === 'home' && <Path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" {...p} />}
      {name === 'file' && <Path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5" {...p} />}
      {name === 'trash' && <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...p} />}
    </Svg>
  );
}

/* ── Shared UI ── */
const Btn = ({ label, onPress, kind = 'primary' }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [s.btn, kind === 'ghost' && s.btnGhost, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
  >
    <Text style={[s.btnText, kind === 'ghost' && { color: C.text }]}>{label}</Text>
  </Pressable>
);

function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={s.iconBtn} hitSlop={8}><Icon name="back" /></Pressable>
      ) : <View style={s.iconBtn} />}
      <Text style={s.headerTitle}>{title}</Text>
      <View style={s.iconBtn}>{right}</View>
    </View>
  );
}

/** Pulsing radar rings, like the "searching nearby" screen. */
function Radar({ size = 260, children }: { size?: number; children?: React.ReactNode }) {
  const rings = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = rings.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 800),
          Animated.timing(v, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      {rings.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2,
            backgroundColor: C.yellow,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
          }}
        />
      ))}
      {children}
    </View>
  );
}

const isImage = (n: string) => /\.(png|jpe?g|gif|webp|heic)$/i.test(n);

function Row({ item }: { item: Item }) {
  const pct = item.size ? Math.min(item.transferred / item.size, 1) : 0;
  const failed = item.status === 'error' || item.status === 'interrupted';
  const color = item.status === 'done' ? C.ok : failed ? C.bad : C.yellow;
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {item.path && item.status === 'done' && isImage(item.name) ? (
          <Image source={{ uri: 'file://' + item.path }} style={s.thumb} />
        ) : (
          <View style={[s.thumb, s.thumbIcon]}><Icon name="file" size={22} color={C.yellowDeep} /></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.mute}>
            {item.direction === 'send' ? 'Sent' : 'Received'}  •  {formatBytes(item.transferred)} / {formatBytes(item.size)}
            {item.status === 'active' ? `  •  ${formatSpeed(item.speed)}` : `  •  ${item.status}`}
          </Text>
        </View>
        <View style={[s.dirDot, { backgroundColor: item.direction === 'send' ? C.yellow : C.yellowSoft }]}>
          <Icon name={item.direction === 'send' ? 'up' : 'down'} size={16} color={C.text} />
        </View>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

function SessionList() {
  const { order, items, info } = useStore();
  return (
    <>
      {!!info && <Text style={[s.mute, { marginVertical: 8, textAlign: 'center' }]}>{info}</Text>}
      <FlatList data={order} keyExtractor={(i) => i} renderItem={({ item }) => <Row item={items[item]} />} />
    </>
  );
}

/* ── Home ── */
export function Home({ go }: { go: (r: string) => void }) {
  const { history, loadHistory } = useStore();
  useEffect(() => { loadHistory(); }, []);
  return (
    <View style={s.flex}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={s.brandRow}>
            <View style={s.logo}><Icon name="up" size={18} color={C.text} /></View>
            <Text style={s.brand}>ShareKita</Text>
          </View>
          <Text style={s.heroSub}>Fast, private file sharing{'\n'}for your classroom and lab.</Text>

          <View style={s.actionCard}>
            <Pressable style={s.action} onPress={() => go('send')}>
              <View style={[s.actionCircle, { backgroundColor: C.yellow }]}><Icon name="up" size={32} /></View>
              <Text style={s.actionLabel}>Send</Text>
            </Pressable>
            <View style={s.actionDivider} />
            <Pressable style={s.action} onPress={() => go('receive')}>
              <View style={[s.actionCircle, { backgroundColor: C.yellowSoft, borderWidth: 2, borderColor: C.yellow }]}>
                <Icon name="down" size={32} />
              </View>
              <Text style={s.actionLabel}>Receive</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          <View style={s.sectionRow}>
            <Text style={s.section}>Recent</Text>
            {history.length > 0 && <Pressable onPress={() => go('history')}><Text style={s.link}>See all</Text></Pressable>}
          </View>
          {history.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>No transfers yet</Text>
              <Text style={s.mute}>Tap Send or Receive to share your first file. Both devices need the same Wi-Fi.</Text>
            </View>
          ) : (
            history.slice(0, 3).map((h) => <Row key={h.id} item={h} />)
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ── Send ── */
export function Send({ back }: { back: () => void }) {
  const [payload, setPayload] = useState<string | null>(null);
  const stop = useRef<null | (() => void)>(null);
  const reset = useStore((st) => st.resetSession);

  useEffect(() => { reset(); return () => stop.current?.(); }, []);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    const files: PickedFile[] = res.assets.map((a) => ({ name: a.name, size: a.size ?? 0, uri: a.uri }));
    try {
      const sess = await startSending(files);
      stop.current = sess.stop;
      setPayload(sess.payload);
    } catch (e: any) { Alert.alert('Cannot start', e.message); }
  };

  return (
    <View style={s.flex}>
      <Header title="Send" onBack={back} />
      <View style={s.body}>
        {!payload ? (
          <>
            <View style={s.center}>
              <Radar>
                <Pressable onPress={pick} style={s.radarCore}><Icon name="up" size={44} /></Pressable>
              </Radar>
              <Text style={s.bigText}>Pick files to send</Text>
              <Text style={[s.mute, { textAlign: 'center' }]}>A QR code will appear for the receiver to scan.</Text>
            </View>
            <Btn label="Choose files" onPress={pick} />
          </>
        ) : (
          <>
            <View style={s.qrWrap}>
              <View style={s.qr}><QRCode value={payload} size={190} /></View>
              <Text style={s.qrHint}>Ask the receiver to scan this code</Text>
            </View>
            <SessionList />
          </>
        )}
      </View>
    </View>
  );
}

/* ── Receive ── */
export function Receive({ back }: { back: () => void }) {
  const [perm, ask] = useCameraPermissions();
  const [connected, setConnected] = useState(false);
  const locked = useRef(false);
  const stop = useRef<null | (() => void)>(null);
  const reset = useStore((st) => st.resetSession);

  useEffect(() => { reset(); return () => stop.current?.(); }, []);

  const onScan = async ({ data }: { data: string }) => {
    if (locked.current) return;
    const offer = parseOffer(data);
    if (!offer) return;
    locked.current = true;
    setConnected(true);
    try { stop.current = await receiveFrom(offer); }
    catch (e: any) { Alert.alert('Failed', e.message); locked.current = false; setConnected(false); }
  };

  if (!perm) return <View style={s.flex} />;
  if (!perm.granted)
    return (
      <View style={s.flex}>
        <Header title="Receive" onBack={back} />
        <View style={s.body}>
          <View style={s.center}>
            <Radar size={220}><View style={s.radarCore}><Icon name="down" size={44} /></View></Radar>
            <Text style={s.bigText}>Camera access needed</Text>
            <Text style={[s.mute, { textAlign: 'center' }]}>Used only to scan the pairing QR code.</Text>
          </View>
          <Btn label="Allow camera" onPress={ask} />
        </View>
      </View>
    );

  return (
    <View style={s.flex}>
      <Header title="Receive" onBack={back} />
      <View style={s.body}>
        {!connected ? (
          <>
            <View style={s.camera}>
              <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
              <View pointerEvents="none" style={s.frame}>
                <View style={[s.corner, { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 18 }]} />
                <View style={[s.corner, { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 18 }]} />
                <View style={[s.corner, { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 18 }]} />
                <View style={[s.corner, { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 18 }]} />
              </View>
            </View>
            <Text style={s.qrHint}>Point your camera at the sender's QR code</Text>
          </>
        ) : <SessionList />}
      </View>
    </View>
  );
}

/* ── History ── */
export function History({ back }: { back: () => void }) {
  const { history, loadHistory, clearHistory } = useStore();
  useEffect(() => { loadHistory(); }, []);
  return (
    <View style={s.flex}>
      <Header
        title="History"
        onBack={back}
        right={history.length > 0 ? <Pressable onPress={clearHistory} hitSlop={8}><Icon name="trash" size={22} /></Pressable> : undefined}
      />
      <View style={s.body}>
        <FlatList
          data={history}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 16 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyTitle}>No transfers yet</Text>
              <Text style={s.mute}>Files you send or receive will show up here.</Text>
            </View>
          }
          renderItem={({ item }) => <Row item={item} />}
        />
      </View>
    </View>
  );
}

/* ── Bottom tab bar (Home / History) ── */
export function TabBar({ route, go }: { route: string; go: (r: string) => void }) {
  const tab = (key: string, label: string, icon: IconName) => {
    const on = route === key;
    return (
      <Pressable style={s.tab} onPress={() => go(key)}>
        <View style={[s.tabPill, on && { backgroundColor: C.yellow }]}>
          <Icon name={icon} size={22} color={C.text} />
        </View>
        <Text style={[s.tabLabel, on && { color: C.text, fontWeight: '700' }]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={s.tabBar}>
      {tab('home', 'Home', 'home')}
      {tab('history', 'History', 'clock')}
    </View>
  );
}

const top = Platform.OS === 'ios' ? 56 : 40;
const shadow = Platform.select({
  ios: { shadowColor: '#B58900', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  android: { elevation: 6 },
}) as object;

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.bg, paddingTop: 0 },
  body: { flex: 1, paddingHorizontal: 20, paddingBottom: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  /* header */
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: top, paddingBottom: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  /* home hero */
  hero: { backgroundColor: C.yellow, paddingTop: top + 8, paddingHorizontal: 20, paddingBottom: 56, borderBottomLeftRadius: 36, borderBottomRightRadius: 36, marginBottom: 56 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  heroSub: { marginTop: 10, color: '#4A3A00', fontSize: 14, lineHeight: 20 },
  actionCard: { position: 'absolute', left: 20, right: 20, bottom: -48, backgroundColor: '#fff', borderRadius: 28, flexDirection: 'row', paddingVertical: 20, ...shadow },
  action: { flex: 1, alignItems: 'center', gap: 10 },
  actionCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  actionDivider: { width: 1, backgroundColor: C.line, marginVertical: 8 },

  /* sections */
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 12 },
  section: { fontSize: 18, fontWeight: '700', color: C.text },
  link: { color: C.yellowDeep, fontWeight: '700', fontSize: 14 },
  empty: { backgroundColor: C.yellowTint, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },

  /* text */
  mute: { color: C.mute, fontSize: 13 },
  name: { color: C.text, fontSize: 15, fontWeight: '600' },
  bigText: { fontSize: 20, fontWeight: '700', color: C.text, marginTop: 24, marginBottom: 6 },

  /* buttons */
  btn: { backgroundColor: C.yellow, paddingVertical: 16, borderRadius: 999, alignItems: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.line },
  btnText: { color: C.text, fontWeight: '800', fontSize: 16 },

  /* rows */
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.line },
  thumb: { width: 46, height: 46, borderRadius: 12 },
  thumbIcon: { backgroundColor: C.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  dirDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, backgroundColor: C.yellowSoft, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },

  /* radar */
  radarCore: { width: 110, height: 110, borderRadius: 55, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center', ...shadow },

  /* qr */
  qrWrap: { alignItems: 'center', marginVertical: 8 },
  qr: { backgroundColor: '#fff', padding: 16, borderRadius: 24, borderWidth: 3, borderColor: C.yellow, ...shadow },
  qrHint: { color: C.mute, fontSize: 14, textAlign: 'center', marginTop: 14, marginBottom: 6 },

  /* camera */
  camera: { flex: 1, borderRadius: 28, overflow: 'hidden', backgroundColor: C.yellowSoft },
  frame: { position: 'absolute', top: '20%', bottom: '20%', left: '12%', right: '12%' },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: C.yellow },

  /* tab bar */
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 28 : 12 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabPill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 12, color: C.mute },
});
