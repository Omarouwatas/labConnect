// ResultDetailScreen — détail d'un résultat validé avec jauge visuelle
// (Bas / Réf / Haut) et commentaire du biologiste.
import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C, R, SHADOW, F } from "../theme";
import { Btn, IconBtn, Tag, Avatar, Card, hexA } from "../components/UI";
import { Icon } from "../icons";
import { downloadAndOpenResultPdf } from "../pdfDownload";

export default function ResultDetailScreen({ route, navigation }) {
  const { result: r } = route.params;
  const [downloading, setDownloading] = useState(false);
  const flag = (r.flag || "normal").toLowerCase();
  const meta = flag === "normal"
    ? { c: C.leaf,  t: "Dans la norme",  pos: 50 }
    : flag === "high"
      ? { c: C.coral, t: "Au-dessus de la norme", pos: 84 }
      : flag === "low"
        ? { c: C.sun, t: "En dessous", pos: 16 }
        : { c: C.grape, t: "Critique", pos: 92 };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={["top"]} style={{ backgroundColor: "#fff" }}>
        <View style={styles.header}>
          <IconBtn name="chevronL" glyph={24} bg={C.bg} shadow={false} onPress={() => navigation.goBack()} />
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text numberOfLines={1} style={styles.headTitle}>{r.test_name || r.test_code}</Text>
            <Text numberOfLines={1} style={styles.headSub}>
              {r.lab_name || r.laboratory_name || ""}{r.validated_at ? " · " + fmtShort(r.validated_at) : ""}
            </Text>
          </View>
          <IconBtn name="document" glyph={20} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 30 }}>
        {/* Hero valeur */}
        <Card pad={22} style={{ alignItems: "center", marginBottom: 16 }}>
          <Tag color={meta.c} solid icon="check" style={{ marginBottom: 14 }}>Résultat validé</Tag>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}>
            <Text style={styles.bigValue}>{r.value || "—"}</Text>
            <Text style={styles.bigUnit}>{r.unit || ""}</Text>
          </View>
          <Text style={[styles.flagLabel, { color: meta.c }]}>{meta.t}</Text>

          {/* Jauge bas/ref/haut */}
          <View style={{ marginTop: 24, alignSelf: "stretch" }}>
            <View style={styles.gaugeBar} />
            <View style={[styles.gaugeKnob, {
              left: `${meta.pos}%`,
              borderColor: meta.c,
              transform: [{ translateX: -10 }],
            }]} />
            <View style={styles.gaugeLabels}>
              <Text style={styles.gaugeEdge}>Bas</Text>
              <Text style={styles.gaugeMid}>Réf. {r.reference_range || "—"} {r.unit || ""}</Text>
              <Text style={styles.gaugeEdge}>Haut</Text>
            </View>
          </View>
        </Card>

        {/* Commentaire biologiste */}
        {(r.biologist_comment || r.biologist_name) ? (
          <Card pad={18} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 12 }}>
              <Avatar name={r.biologist_name || "Biologiste"} color={C.grape} size={42} />
              <View>
                <Text style={styles.bioName}>{r.biologist_name || "Biologiste médical"}</Text>
                <Text style={styles.bioRole}>Biologiste médical</Text>
              </View>
            </View>
            {r.biologist_comment ? (
              <Text style={styles.bioComment}>"{r.biologist_comment}"</Text>
            ) : null}
          </Card>
        ) : null}

        {/* Téléchargement du PDF officiel du résultat. L'order_uuid est
            celui exposé par TestResultSerializer côté backend — c'est
            la clé utilisée par l'endpoint /lab/orders/{uuid}/result/pdf. */}
        <Btn
          full size="lg" variant="dark" icon="download"
          loading={downloading}
          disabled={downloading || !(r.order_uuid || r.order)}
          onPress={async () => {
            const orderUuid = r.order_uuid || r.order?.uuid || r.order;
            if (!orderUuid) return;
            setDownloading(true);
            await downloadAndOpenResultPdf(
              orderUuid,
              r.test_code || r.test_name || "resultat",
            );
            setDownloading(false);
          }}
        >
          {downloading ? "Préparation du PDF…" : "Télécharger le PDF"}
        </Btn>
      </ScrollView>
    </View>
  );
}

function fmtShort(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12,
  },
  headTitle: { fontSize: 19, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  headSub:   { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 2, fontFamily: F.body },

  bigValue: { fontSize: 56, fontWeight: "700", color: C.ink, lineHeight: 60, fontFamily: F.displayBold },
  bigUnit:  { fontSize: 22, fontWeight: "600", color: C.inkSoft, fontFamily: F.display },
  flagLabel: { fontSize: 15, fontWeight: "700", marginTop: 8, fontFamily: F.displayBold },

  gaugeBar: {
    height: 10, borderRadius: 999,
    // Approximation du gradient via 4 segments couleur
    backgroundColor: C.leaf,
    overflow: "hidden",
    flexDirection: "row",
  },
  gaugeKnob: {
    position: "absolute", top: -5,
    width: 20, height: 20, borderRadius: 999,
    backgroundColor: "#fff", borderWidth: 4,
    ...SHADOW.sm,
  },
  gaugeLabels: {
    flexDirection: "row", justifyContent: "space-between",
    marginTop: 10,
  },
  gaugeEdge: { fontSize: 12, fontWeight: "700", color: C.inkSoft },
  gaugeMid:  { fontSize: 12, fontWeight: "800", color: C.ink },

  bioName:    { fontSize: 14.5, fontWeight: "700", color: C.ink, fontFamily: F.displayBold },
  bioRole:    { fontSize: 12, fontWeight: "700", color: C.inkSoft, marginTop: 1, fontFamily: F.body },
  bioComment: { fontSize: 14, fontWeight: "600", color: C.ink, fontStyle: "italic", lineHeight: 21, fontFamily: F.body },
});
