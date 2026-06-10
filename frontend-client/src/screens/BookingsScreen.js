// BookingsScreen — onglet "Mes RDV & résultats".
// Segmented tab Rendez-vous / Résultats + cartes selon le design Anthropic.
import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as api from "../api";
import { useAuth } from "../auth";
import { C, R, SHADOW, F, CURRENCY, labColor, STATUS_STYLE } from "../theme";
import { Card, Tag, StatusBadge, hexA } from "../components/UI";
import { Icon } from "../icons";

export default function BookingsScreen({ navigation }) {
  const { logout } = useAuth();
  const [tab, setTab] = useState("rdv");
  const [appts, setAppts] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.allSettled([
        api.fetchMyAppointments(),
        api.fetchMyResults(),
      ]);
      if (a.status === "fulfilled") setAppts(a.value);
      if (r.status === "fulfilled") setResults(r.value);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const data = tab === "rdv" ? appts : results;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>Mes RDV & résultats</Text>
          <TouchableOpacity onPress={logout} style={styles.logout}>
            <Text style={styles.logoutText}>Déconnexion</Text>
          </TouchableOpacity>
        </View>

        {/* Segmented control */}
        <View style={styles.segWrap}>
          {[
            { id: "rdv", label: "Rendez-vous", n: appts.length },
            { id: "res", label: "Résultats", n: results.length },
          ].map((s) => {
            const on = tab === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                onPress={() => setTab(s.id)}
                activeOpacity={0.85}
                style={[styles.segBtn, on && { backgroundColor: C.brand }]}
              >
                <Text style={[styles.segLabel, on && { color: "#fff" }]}>{s.label}</Text>
                <View style={[
                  styles.segCount,
                  { backgroundColor: on ? "rgba(255,255,255,0.25)" : C.bg },
                ]}>
                  <Text style={[styles.segCountText, { color: on ? "#fff" : C.inkSoft }]}>
                    {s.n}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </SafeAreaView>

      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(it) => it.uuid}
          contentContainerStyle={{ padding: 20, paddingTop: 18, gap: 13 }}
          ItemSeparatorComponent={() => <View style={{ height: 13 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={C.brand}
            />
          }
          renderItem={({ item }) =>
            tab === "rdv"
              ? <ApptCard a={item} />
              : <ResultCard r={item} onPress={() => navigation.navigate("ResultDetail", { result: item })} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name={tab === "rdv" ? "calendar" : "flask"} size={56} color={C.inkSoft} />
              <Text style={styles.emptyTitle}>
                {tab === "rdv" ? "Aucun rendez-vous" : "Aucun résultat"}
              </Text>
              <Text style={styles.emptySub}>
                Allez sur l'accueil pour réserver vos premiers tests.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function ApptCard({ a }) {
  const color = labColor(a.laboratory_uuid || a.lab || "");
  const isHome = a.visit_type === "home";
  const [open, setOpen] = React.useState(false);

  const items = a.items || [];
  // Total à charge patient prioritaire ; fallback au total brut si pas
  // d'items (RDV legacy sans test_uuids).
  const due = a.patient_due_mru ?? a.total_fee_mru;
  const itemsTotal = a.items_total_mru;
  const covered = a.cnam_covered_mru ? Number(a.cnam_covered_mru) : 0;

  return (
    <Card pad={16}>
      <View style={styles.row}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 11, flex: 1, minWidth: 0 }}>
          <View style={[styles.apptIcon, { backgroundColor: hexA(color, 0.16) }]}>
            <Icon name={isHome ? "house2" : "pin"} size={22} color={color} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.apptLab}>
              {a.laboratory_name || a.lab || "—"}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
              <Icon name={isHome ? "house2" : "hospital"} size={13} color={C.inkSoft} />
              <Text style={styles.apptSub}>
                {isHome ? "À domicile" : "Au laboratoire"}
                {items.length > 0 ? ` · ${items.length} analyse${items.length > 1 ? "s" : ""}` : ""}
              </Text>
            </View>
          </View>
        </View>
        <StatusBadge status={a.status || "pending"} />
      </View>

      {/* Date & total à charge patient */}
      <View style={styles.dateRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name="calendar" size={17} color={C.brand} />
          <Text style={styles.dateText}>{fmtDateLong(a.scheduled_for)}</Text>
        </View>
        {due !== undefined && due !== null && Number(due) > 0 ? (
          <View style={{ marginLeft: "auto", alignItems: "flex-end" }}>
            <Text style={styles.totalText}>{CURRENCY.format(due)}</Text>
            {covered > 0 && (
              <Text style={styles.totalSubText}>CNAM −{CURRENCY.format(covered)}</Text>
            )}
          </View>
        ) : null}
      </View>

      {/* Liste détaillée des analyses — dépliable */}
      {items.length > 0 && (
        <>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setOpen((v) => !v)}
            style={styles.itemsToggle}
          >
            <Icon name="flask" size={16} color={C.brand} />
            <Text style={styles.itemsToggleText}>
              {open ? "Masquer le détail" : "Voir le détail des analyses"}
            </Text>
            <Icon name={open ? "chevronU" : "chevronD"} size={16} color={C.inkSoft} />
          </TouchableOpacity>
          {open && (
            <View style={styles.itemsList}>
              {items.map((it, i) => (
                <View key={`${it.test_code}-${i}`} style={styles.itemRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.itemCode} numberOfLines={1}>
                      {it.test_code}
                      <Text style={styles.itemName}> · {it.test_name}</Text>
                    </Text>
                    {Number(it.cnam_covered_mru) > 0 && (
                      <Text style={styles.itemCnam}>
                        CNAM −{CURRENCY.format(it.cnam_covered_mru)}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.itemPrice}>{CURRENCY.format(it.patient_due_mru || it.price_mru)}</Text>
                    {Number(it.cnam_covered_mru) > 0 && (
                      <Text style={styles.itemPriceStrike}>{CURRENCY.format(it.price_mru)}</Text>
                    )}
                  </View>
                </View>
              ))}
              {itemsTotal && Number(itemsTotal) > 0 && (
                <View style={styles.itemsTotal}>
                  <Text style={styles.itemsTotalLabel}>Sous-total analyses</Text>
                  <Text style={styles.itemsTotalValue}>{CURRENCY.format(itemsTotal)}</Text>
                </View>
              )}
              {a.surcharge_mru && Number(a.surcharge_mru) > 0 ? (
                <View style={styles.itemsTotal}>
                  <Text style={styles.itemsTotalLabel}>
                    {isHome ? "Frais de visite à domicile" : "Supplément"}
                  </Text>
                  <Text style={styles.itemsTotalValue}>{CURRENCY.format(a.surcharge_mru)}</Text>
                </View>
              ) : null}
            </View>
          )}
        </>
      )}

      {a.notes ? (
        <View style={styles.noteBlock}>
          <Icon name="info" size={17} color={C.sun} style={{ marginTop: 1 }} />
          <Text style={styles.noteText}>{a.notes}</Text>
        </View>
      ) : null}
    </Card>
  );
}

function ResultCard({ r, onPress }) {
  const flag = (r.flag || "normal").toLowerCase();
  const meta = flag === "normal"
    ? { c: C.leaf,  t: "Normal" }
    : flag === "high"
      ? { c: C.coral, t: "À surveiller" }
      : flag === "low"
        ? { c: C.sun, t: "À surveiller" }
        : { c: C.grape, t: "Critique" };
  return (
    <Card onPress={onPress} pad={16} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <View style={[styles.resIcon, { backgroundColor: hexA(meta.c, 0.14) }]}>
        <Icon name="document" size={26} color={meta.c} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={styles.resName}>{r.test_name || r.test_code}</Text>
          <Tag color={C.brand} solid icon="check">Validé</Tag>
        </View>
        <Text style={styles.resSub} numberOfLines={1}>
          {r.lab_name || r.laboratory_name || ""}
          {r.validated_at ? ` · ${fmtDateShort(r.validated_at)}` : ""}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 5 }}>
          <Text style={styles.resValue}>{r.value || "—"}</Text>
          <Text style={styles.resUnit}>{r.unit || ""}</Text>
          <Text style={[styles.resFlag, { color: meta.c }]}>· {meta.t}</Text>
        </View>
      </View>
      <Icon name="chevronR" size={22} color={C.inkSoft} />
    </Card>
  );
}

// ── helpers dates ──────────────────────────────────────────────────────
function fmtDateLong(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}
function fmtDateShort(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 10,
  },
  title: { flex: 1, fontSize: 28, fontWeight: "700", color: C.ink, letterSpacing: -0.4, fontFamily: F.displayBold },
  logout: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, backgroundColor: hexA(C.coral, 0.12),
  },
  logoutText: { fontSize: 12, fontWeight: "800", color: C.coral },

  segWrap: {
    flexDirection: "row", gap: 4,
    backgroundColor: "#fff", borderRadius: 999, padding: 5,
    marginHorizontal: 20, marginTop: 16,
    borderWidth: 1.5, borderColor: C.hair,
  },
  segBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
  },
  segLabel: { fontSize: 14.5, fontWeight: "700", color: C.inkSoft, fontFamily: F.displayBold },
  segCount: {
    minWidth: 22, height: 22, paddingHorizontal: 6,
    borderRadius: 999, alignItems: "center", justifyContent: "center",
  },
  segCountText: { fontSize: 11, fontWeight: "800" },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  apptIcon: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  apptLab:  { fontSize: 16, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  apptSub:  { fontSize: 12.5, fontWeight: "700", color: C.inkSoft, fontFamily: F.body },

  dateRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 11, paddingHorizontal: 14,
    backgroundColor: C.bg, borderRadius: 14,
  },
  dateText:  { fontSize: 13.5, fontWeight: "700", color: C.ink },
  totalText: { fontSize: 15, fontWeight: "800", color: C.ink, fontFamily: F.displayBold },
  totalSubText: { fontSize: 11, fontWeight: "700", color: C.leaf, marginTop: 1 },

  itemsToggle: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingVertical: 11, paddingHorizontal: 4, marginTop: 8,
    borderTopWidth: 1, borderTopColor: C.hair,
  },
  itemsToggleText: { flex: 1, fontSize: 13, fontWeight: "800", color: C.brandDeep || C.brand },
  itemsList: { marginTop: 2 },
  itemRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: C.hairSoft || C.hair,
  },
  itemCode:  { fontSize: 13, fontWeight: "800", color: C.ink },
  itemName:  { fontSize: 12.5, fontWeight: "600", color: C.inkSoft },
  itemCnam:  { fontSize: 11, fontWeight: "700", color: C.leaf, marginTop: 2 },
  itemPrice: { fontSize: 13.5, fontWeight: "800", color: C.ink, fontFamily: F.bodyBold },
  itemPriceStrike: {
    fontSize: 11, fontWeight: "700", color: C.inkSoft,
    textDecorationLine: "line-through", marginTop: 1,
  },
  itemsTotal: {
    flexDirection: "row", alignItems: "center",
    paddingTop: 10, marginTop: 4,
  },
  itemsTotalLabel: { flex: 1, fontSize: 12.5, fontWeight: "700", color: C.inkSoft },
  itemsTotalValue:{ fontSize: 13, fontWeight: "800", color: C.ink, fontFamily: F.bodyBold },

  noteBlock: {
    flexDirection: "row", gap: 8, alignItems: "flex-start",
    marginTop: 11, paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: hexA(C.sun, 0.12), borderRadius: 12,
  },
  noteText: { flex: 1, fontWeight: "700", fontSize: 12.5, color: C.ink, lineHeight: 17 },

  resIcon:  { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  resName:  { flex: 1, fontSize: 15.5, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  resSub:   { fontSize: 12.5, fontWeight: "700", color: C.inkSoft, marginTop: 3 },
  resValue: { fontSize: 18, fontWeight: "700", color: C.ink },
  resUnit:  { fontSize: 12, fontWeight: "700", color: C.inkSoft },
  resFlag:  { marginLeft: 4, fontSize: 11.5, fontWeight: "800" },

  empty:      { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: C.ink, marginTop: 12 },
  emptySub:   { fontSize: 13, color: C.inkSoft, fontWeight: "700", textAlign: "center", paddingHorizontal: 40 },
});
