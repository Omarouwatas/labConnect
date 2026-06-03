// ProfileScreen — header turquoise avec avatar initiales + chip CNAM,
// liste de réglages (CNAM, ordonnances, adresses, notifications),
// bouton déconnexion en rouge soft.
import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import { C, R, SHADOW, F } from "../theme";
import { hexA } from "../components/UI";
import { Icon } from "../icons";

const ROWS = [
  { id: "info",   icon: "user",       label: "Informations personnelles", color: C.brand },
  { id: "cnam",   icon: "shieldFill", label: "Ma carte CNAM",              color: C.leaf },
  { id: "rx",     icon: "document",   label: "Mes ordonnances",            color: C.grape },
  { id: "addr",   icon: "pin",        label: "Adresses enregistrées",      color: C.coral },
  { id: "notif",  icon: "bell",       label: "Notifications",              color: C.sun },
];

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim() || "Utilisateur";
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const onLogout = () => {
    Alert.alert("Déconnexion", "Voulez-vous vraiment vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Déconnexion", style: "destructive", onPress: () => logout() },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        {/* Header gradient (approx avec couleur unie + overlay) */}
        <View style={styles.hero}>
          <SafeAreaView edges={["top"]} style={{ alignItems: "center" }}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroInitials}>{initials || "?"}</Text>
            </View>
            <Text style={styles.heroName}>{fullName}</Text>
            <Text style={styles.heroPhone}>
              {user?.phone || user?.email || ""}
            </Text>
            {user?.cnam_number ? (
              <View style={styles.cnamChip}>
                <Icon name="shieldFill" size={16} color="#fff" />
                <Text style={styles.cnamChipText}>
                  CNAM · n° {user.cnam_number}
                </Text>
              </View>
            ) : null}
          </SafeAreaView>
        </View>

        {/* Liste de réglages */}
        <View style={{ padding: 20, gap: 10 }}>
          {ROWS.map((r) => (
            <TouchableOpacity
              key={r.id}
              activeOpacity={0.85}
              style={styles.row}
            >
              <View style={[styles.rowIcon, { backgroundColor: hexA(r.color, 0.14) }]}>
                <Icon name={r.icon} size={20} color={r.color} />
              </View>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Icon name="chevronR" size={20} color={C.inkSoft} />
            </TouchableOpacity>
          ))}

          {/* Déconnexion */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onLogout}
            style={styles.logoutRow}
          >
            <Icon name="logout" size={19} color={C.coral} />
            <Text style={styles.logoutText}>Déconnexion</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: C.brand,
    paddingBottom: 26,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroAvatar: {
    width: 84, height: 84, borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center", justifyContent: "center",
    marginTop: 14,
  },
  heroInitials: { color: "#fff", fontSize: 32, fontWeight: "700", fontFamily: F.displayBold },
  heroName: { color: "#fff", fontSize: 22, fontWeight: "700", marginTop: 12, fontFamily: F.displayBold },
  heroPhone: { color: "rgba(255,255,255,0.8)", fontSize: 13.5, fontWeight: "700", marginTop: 2, fontFamily: F.body },
  cnamChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 12, paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, backgroundColor: "rgba(255,255,255,0.2)",
  },
  cnamChipText: { color: "#fff", fontWeight: "800", fontSize: 12.5, fontFamily: F.bodyBold },

  row: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: "#fff", borderRadius: 18, padding: 14,
    ...SHADOW.sm,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  rowLabel:   { flex: 1, fontSize: 15, fontWeight: "600", color: C.ink, fontFamily: F.display },

  logoutRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
    marginTop: 8, backgroundColor: hexA(C.coral, 0.12),
    borderRadius: 18, padding: 15,
  },
  logoutText: { fontSize: 15, fontWeight: "700", color: C.coral, fontFamily: F.displayBold },
});
