// NurseProfileScreen — onglet « Moi » du parcours infirmier·e.
//
// Volontairement épuré : identifiants, biométrie, logout. Si l'utilisateur
// a aussi le rôle patient (cas test), on lui propose un bouton pour
// basculer vers la vue patient (nécessite un reload manuel — on n'a pas
// de switch d'écran à chaud sans reconnexion).
import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Switch, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../auth";
import { describeBiometric, inspectBiometric, bioStore } from "../../biometric";
import { C, R, SHADOW, F } from "../../theme";
import { Btn, Card, Avatar, hexA } from "../../components/UI";
import { Icon } from "../../icons";

export default function NurseProfileScreen() {
  const { user, logout, enableBiometric, disableBiometric } = useAuth();
  const [bioOn, setBioOn] = useState(false);
  const [bioSupport, setBioSupport] = useState({ supported: false });
  const [bioLabel, setBioLabel] = useState("Biométrie");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [stored, support] = await Promise.all([
        bioStore.get(),
        inspectBiometric(),
      ]);
      setBioOn(!!stored);
      setBioSupport(support);
      // describeBiometric() est synchrone — elle prend les types renvoyés
      // par inspectBiometric et renvoie l'étiquette/icône adaptée
      // (Face ID / Touch ID / Empreinte / Reconnaissance faciale).
      const desc = describeBiometric(support?.types || []);
      setBioLabel(desc?.label || "Biométrie");
    })();
  }, []);

  const toggleBio = async (next) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        await enableBiometric();
        setBioOn(true);
      } else {
        await disableBiometric();
        setBioOn(false);
      }
    } catch (e) {
      Alert.alert("Biométrie", e?.message || "Action impossible.");
    } finally { setBusy(false); }
  };

  const displayName = (() => {
    const n = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
    return n || user?.phone || "—";
  })();

  const isAlsoPatient = (user?.roles || []).includes("patient");

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]}>
        <View style={styles.header}>
          <Text style={[styles.title, { fontFamily: F.displayBold || F.display }]}>
            Mon compte
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {/* Fiche identité */}
        <Card pad={16} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Avatar name={displayName} size={64} color={C.brand} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.name, { fontFamily: F.displayBold || F.display }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.meta, { fontFamily: F.body || F.bodyBold }]} numberOfLines={1}>
              Infirmier·e préleveur·se
            </Text>
            <Text style={[styles.metaSmall, { fontFamily: F.body || F.bodyBold }]} numberOfLines={1}>
              {user?.phone || ""}
            </Text>
          </View>
        </Card>

        {/* Biométrie */}
        <Text style={[styles.sectionTitle, { fontFamily: F.displayBold || F.display }]}>
          Connexion rapide
        </Text>
        <Card pad={14}>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: hexA(C.brand, 0.14) }]}>
              <Icon name="fingerprint" size={22} color={C.brand} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.rowTitle, { fontFamily: F.displayBold || F.display }]}>
                {bioLabel}
              </Text>
              <Text style={[styles.rowSub, { fontFamily: F.body || F.bodyBold }]}>
                {bioSupport.supported
                  ? "Connexion sans mot de passe sur cet appareil."
                  : "Aucune biométrie enrôlée."}
              </Text>
            </View>
            <Switch
              value={bioOn}
              onValueChange={toggleBio}
              disabled={!bioSupport.supported || busy}
              trackColor={{ true: C.brand, false: C.hair }}
              thumbColor="#fff"
            />
          </View>
        </Card>

        {/* Liens informatifs */}
        <Text style={[styles.sectionTitle, { fontFamily: F.displayBold || F.display }]}>
          Sécurité & confidentialité
        </Text>
        <Card pad={14}>
          <InfoRow icon="shield" label="Vos données" sub="Hébergées au laboratoire affilié." />
          <InfoRow icon="phone" label="Support" sub="Contactez votre chef de labo en cas de problème." />
          {isAlsoPatient && (
            <InfoRow
              icon="user"
              label="Vue patient"
              sub="Votre compte est aussi patient. Déconnectez-vous puis reconnectez-vous pour switcher."
            />
          )}
        </Card>

        <View style={{ marginTop: 18 }}>
          <Btn variant="ghost" icon="logout" full onPress={logout}>
            Se déconnecter
          </Btn>
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, label, sub }) {
  return (
    <View style={[styles.row, { paddingVertical: 8 }]}>
      <View style={[styles.rowIcon, { backgroundColor: hexA(C.brand, 0.10) }]}>
        <Icon name={icon} size={18} color={C.brandDeep} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.rowTitle, { fontFamily: F.displayBold || F.display, fontSize: 14 }]}>
          {label}
        </Text>
        <Text style={[styles.rowSub, { fontFamily: F.body || F.bodyBold }]}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
  title:  { fontSize: 24, fontWeight: "700", color: C.ink },

  name:      { fontSize: 18, fontWeight: "700", color: C.ink },
  meta:      { fontSize: 13, color: C.inkSoft, marginTop: 2 },
  metaSmall: { fontSize: 12, color: C.inkSoft, marginTop: 4 },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: C.ink, marginTop: 18, marginBottom: 8, paddingHorizontal: 2 },

  row: { flexDirection: "row", alignItems: "center" },
  rowIcon: {
    width: 38, height: 38, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  rowTitle: { fontSize: 15, fontWeight: "700", color: C.ink },
  rowSub:   { fontSize: 12, color: C.inkSoft, marginTop: 3, lineHeight: 16 },
});
