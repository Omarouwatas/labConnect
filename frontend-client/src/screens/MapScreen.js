import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import LabMapView from "../components/LabMapView";
import { C, R, SHADOW } from "../theme";

export default function MapScreen({ route, navigation }) {
  const labs = route.params?.labs || [];
  const userLoc = route.params?.userLoc || null;

  const goToDetail = (uuid) => {
    const lab = labs.find((l) => l.uuid === uuid);
    if (lab) navigation.navigate("LabDetail", { lab, userLoc });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Carte des labos</Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={styles.mapWrap}>
        <LabMapView
          labs={labs}
          userLocation={userLoc}
          height={undefined /* fills parent */}
          onLabPress={goToDetail}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          Tappez un point turquoise pour ouvrir les détails du laboratoire.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomColor: C.line, borderBottomWidth: 1, backgroundColor: C.bg,
  },
  backBtn: { paddingVertical: 6 },
  backText: { color: C.o, fontWeight: "600" },
  title: { fontSize: 16, fontWeight: "600", color: C.ink },
  mapWrap: { flex: 1, margin: 12, borderRadius: R.md, overflow: "hidden", ...SHADOW.sm },
  footer: { padding: 14, backgroundColor: C.bg },
  footerHint: { textAlign: "center", color: C.ink3, fontSize: 12 },
});
