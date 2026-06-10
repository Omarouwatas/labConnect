// NotificationsScreen — centre des notifications côté patient ET nurse.
//
// Source de vérité côté backend : GET /notifications/mine/. Liste simple
// avec icône/couleur par sévérité + deep-link au tap. On marque comme
// lu côté serveur ET en local au tap, et on offre un "Tout marquer lu".
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as api from "../api";
import { C, R, SHADOW, F } from "../theme";
import { Btn, IconBtn, hexA } from "../components/UI";
import { Icon } from "../icons";

// Mapping kind → icône + intent.
const KIND_META = {
  appt_created:       { icon: "calendar",   color: C.brand },
  appt_confirmed:     { icon: "checkCircle", color: C.leaf },
  appt_checked_in:    { icon: "userFill",   color: C.grape },
  appt_in_progress:   { icon: "vial",       color: C.grape },
  appt_completed:     { icon: "check",      color: C.leaf },
  appt_cancelled:     { icon: "close",      color: C.coral },
  appt_nurse_assigned:{ icon: "user",       color: C.brand },
  sample_received:    { icon: "vial",       color: C.brand },
  result_entered:     { icon: "edit",       color: C.sun },
  result_validated:   { icon: "shieldFill", color: C.leaf },
  result_available:   { icon: "document",   color: C.leaf },
  sample_rejected:    { icon: "alert",      color: C.coral },
  info:               { icon: "info",       color: C.inkSoft },
};
const SEVERITY_COLOR = {
  success:  C.leaf,
  info:     C.brand,
  warning:  C.sun,
  critical: C.coral,
};

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `il y a ${days} j`;
  try {
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch { return ""; }
}

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.fetchNotifications();
      setItems(data?.results || []);
      setUnread(data?.unread || 0);
    } catch {
      setItems([]); setUnread(0);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [navigation, load]);

  // Tap d'une notif : on la marque lue + on tente un deep-link vers
  // l'écran le plus pertinent en fonction du payload.
  const openNotif = async (n) => {
    if (!n.read_at) {
      // Optimistic update — on retire la pastille tout de suite.
      setItems((arr) => arr.map((x) => x.uuid === n.uuid
        ? { ...x, read_at: new Date().toISOString() } : x));
      setUnread((u) => Math.max(0, u - 1));
      api.markNotificationRead(n.uuid).catch(() => {});
    }
    // Routing :
    //   - tout ce qui concerne un appointment → BookingsTab (patient)
    //     ou Tournée (nurse). On ne sait pas où on est, on tente les
    //     deux routes silencieusement.
    //   - result_available → idem, l'écran BookingsScreen onglet
    //     « Résultats » fait l'affaire.
    try {
      if (n.payload?.appointment_uuid) {
        // Patient : retour aux RDV. Nurse : retour à la tournée.
        navigation.navigate("Main", { screen: "BookingsTab" });
      } else {
        navigation.goBack();
      }
    } catch {
      navigation.goBack();
    }
  };

  const onMarkAll = async () => {
    setItems((arr) => arr.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnread(0);
    try { await api.markAllNotificationsRead(); } catch { /* ignore */ }
  };

  const renderItem = ({ item }) => {
    const meta = KIND_META[item.kind] || KIND_META.info;
    const sev = SEVERITY_COLOR[item.severity] || meta.color;
    const isUnread = !item.read_at;
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => openNotif(item)}
        style={[
          styles.row,
          isUnread && { borderColor: hexA(sev, 0.32) },
        ]}
      >
        <View style={[styles.iconBubble, { backgroundColor: hexA(sev, 0.15) }]}>
          <Icon name={meta.icon} size={20} color={sev} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.rowHead}>
            <Text
              style={[styles.title, { fontFamily: F.displayBold || F.display }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {isUnread && <View style={[styles.unreadDot, { backgroundColor: sev }]} />}
          </View>
          {item.body ? (
            <Text
              style={[styles.body, { fontFamily: F.body || F.bodyBold }]}
              numberOfLines={2}
            >
              {item.body}
            </Text>
          ) : null}
          <Text style={[styles.when, { fontFamily: F.body || F.bodyBold }]}>
            {timeAgo(item.created_at)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <IconBtn name="chevronL" glyph={22} onPress={() => navigation.goBack()} />
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={[styles.headerTitle, { fontFamily: F.displayBold || F.display }]}>
              Notifications
            </Text>
            <Text style={[styles.headerSub, { fontFamily: F.body || F.bodyBold }]}>
              {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est à jour"}
            </Text>
          </View>
          {unread > 0 && (
            <TouchableOpacity onPress={onMarkAll} hitSlop={8} style={styles.markAll}>
              <Text style={[styles.markAllText, { fontFamily: F.bodyBold || F.body }]}>
                Tout lire
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.uuid}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={C.brand}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="bell" size={42} color={C.inkSoft} />
              <Text style={[styles.emptyTitle, { fontFamily: F.displayBold || F.display }]}>
                Pas encore de notification
              </Text>
              <Text style={[styles.emptySub, { fontFamily: F.body || F.bodyBold }]}>
                Vous recevrez ici les confirmations de RDV, les résultats validés et les messages du laboratoire.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 6,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: C.ink },
  headerSub:   { fontSize: 12, color: C.inkSoft, marginTop: 2 },
  markAll:     { paddingHorizontal: 12, paddingVertical: 6 },
  markAllText: { fontSize: 12.5, fontWeight: "700", color: C.brand },

  row: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    padding: 14, marginTop: 10, borderRadius: R.lg,
    backgroundColor: "#fff", borderWidth: 1.5, borderColor: C.hair,
    ...SHADOW.sm,
  },
  iconBubble: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  title:   { flex: 1, fontSize: 15, fontWeight: "700", color: C.ink },
  body:    { fontSize: 13, color: C.inkSoft, marginTop: 3, lineHeight: 18 },
  when:    { fontSize: 11.5, color: C.inkSoft, marginTop: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 999 },

  empty: {
    alignItems: "center", padding: 32, marginTop: 24,
    backgroundColor: "#fff", borderRadius: R.lg, marginHorizontal: 4,
    ...SHADOW.sm,
  },
  emptyTitle: { fontSize: 18, color: C.ink, marginTop: 10, fontWeight: "700" },
  emptySub:   { fontSize: 13, color: C.inkSoft, marginTop: 6, textAlign: "center", lineHeight: 18 },
});
