// Téléchargement + ouverture d'un PDF d'analyse côté mobile.
//
// Pourquoi un helper dédié ?
//   - l'endpoint backend exige `Authorization: Bearer …` → pas de
//     `Linking.openURL` direct, on doit faire un fetch authentifié,
//     enregistrer dans le cache local, puis ouvrir/partager.
//   - on isole les imports `expo-file-system` + `expo-sharing` ici
//     pour que le code appelant n'ait à connaître qu'une fonction
//     simple `downloadAndOpenResultPdf(orderUuid, label)`.
//
// Dépendances ajoutées dans package.json :
//   - expo-file-system  (~19.0.16) → cache & écriture binaire
//   - expo-sharing      (~14.0.7)  → feuille de partage native
//
// Si l'utilisateur n'a pas encore lancé `npx expo install`, le
// `require` lazy ci-dessous lève une erreur claire — c'est volontaire,
// on préfère un message lisible qu'un crash JS opaque.
import { Alert, Platform } from "react-native";
import { tokens, resultPdfUrl } from "./api";

// Encode un ArrayBuffer en base64 sans dépendance externe (Buffer n'est
// pas dispo en RN). On parcourt par chunks pour éviter de saturer la
// stack avec String.fromCharCode(...) sur un gros buffer.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  // `btoa` est dispo dans Hermes (RN). Sinon polyfill global.
  return globalThis.btoa(binary);
}

/**
 * Télécharge le PDF d'un résultat et l'ouvre via la feuille de partage
 * native (Mail / Files / Imprimer / WhatsApp / …). Renvoie `true` si
 * tout s'est bien passé, sinon affiche un Alert et renvoie `false`.
 */
export async function downloadAndOpenResultPdf(orderUuid, label = "resultat") {
  let FS;
  let Sharing;
  try {
    // Imports lazy — n'échoue que si les deps n'ont pas été installées.
    FS = require("expo-file-system/legacy");
    Sharing = require("expo-sharing");
  } catch (e) {
    Alert.alert(
      "Module manquant",
      "Lancez `npx expo install expo-file-system expo-sharing` puis recompilez l'app.",
    );
    return false;
  }

  try {
    // 1) Fetch authentifié → arrayBuffer
    const access = await tokens.getAccess();
    const res = await fetch(resultPdfUrl(orderUuid), {
      headers: access ? { Authorization: `Bearer ${access}` } : {},
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      Alert.alert("PDF indisponible", text || `HTTP ${res.status}`);
      return false;
    }
    const buf = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);

    // 2) Écrit dans le cache local. On utilise un nom de fichier
    //    relativement unique pour éviter de réutiliser une vieille
    //    version en cache (sauf si le navigateur de fichiers natifs
    //    dédup par nom).
    const safe = String(label).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
    const filename = `${safe || "resultat"}_${orderUuid.slice(0, 8)}.pdf`;
    const fileUri = `${FS.cacheDirectory}${filename}`;
    await FS.writeAsStringAsync(fileUri, base64, {
      encoding: FS.EncodingType.Base64,
    });

    // 3) Partage / ouverture native. Si Sharing n'est pas disponible
    //    (web par ex.), on retombe sur un message d'info.
    const can = await Sharing.isAvailableAsync();
    if (!can) {
      Alert.alert(
        "PDF enregistré",
        `Fichier ${filename} enregistré dans le cache de l'app.`,
      );
      return true;
    }
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/pdf",
      dialogTitle: "Votre résultat d'analyse",
      UTI: "com.adobe.pdf",   // iOS — type clair pour l'aperçu
    });
    return true;
  } catch (e) {
    Alert.alert(
      "Téléchargement impossible",
      Platform.OS === "ios"
        ? "Vérifiez votre connexion et réessayez."
        : e?.message || "Réessayez dans un instant.",
    );
    return false;
  }
}
