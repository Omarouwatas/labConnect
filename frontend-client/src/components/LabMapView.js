/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useMemo, useRef, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { C, DEFAULT_LOCATION } from "../theme";

/**
 * Carte Leaflet embarquée dans une WebView.
 *
 * Props :
 *   labs            : [{ uuid, name, latitude, longitude, address, distance? }]
 *   userLocation    : { lat, lng } | null
 *   center          : { lat, lng }  ← centre initial
 *   onLabPress(uuid): callback exécuté quand l'utilisateur tappe un marqueur
 *   height          : nombre (défaut 320)
 *
 * Le HTML est construit UNE seule fois (state initial figé). Les
 * changements de `labs` / `userLocation` sont propagés via
 * `injectJavaScript`, ce qui évite de recharger Leaflet, les tuiles OSM
 * et tous les marqueurs à chaque re-render du parent.
 */
export default function LabMapView({
  labs = [],
  userLocation = null,
  center = DEFAULT_LOCATION,
  onLabPress,
  height = 320,
}) {
  const webRef = useRef(null);
  const initialReady = useRef(false);

  // Snapshot des props au premier rendu — utilisé uniquement pour amorcer
  // la WebView. Les MAJ suivantes passent par injectJavaScript.
  const initialHtml = useMemo(
    () => buildHtml({ labs, userLocation, center }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLoadEnd = useCallback(() => {
    initialReady.current = true;
  }, []);

  // Sync labs → WebView dès qu'elle est prête (ou plus tard si elle ne l'est
  // pas encore — le premier rendu HTML couvre déjà la valeur courante).
  useEffect(() => {
    if (!initialReady.current || !webRef.current) return;
    webRef.current.injectJavaScript(
      `window.__updateLabs && window.__updateLabs(${JSON.stringify(labs)}); true;`,
    );
  }, [labs]);

  useEffect(() => {
    if (!initialReady.current || !webRef.current) return;
    webRef.current.injectJavaScript(
      `window.__updateUser && window.__updateUser(${JSON.stringify(userLocation)}); true;`,
    );
  }, [userLocation]);

  const handleMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "lab_press" && data.uuid && onLabPress) onLabPress(data.uuid);
    } catch { /* ignore */ }
  }, [onLabPress]);

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        ref={webRef}
        source={{ html: initialHtml }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        onMessage={handleMessage}
        onLoadEnd={onLoadEnd}
        style={styles.web}
      />
    </View>
  );
}

function buildHtml({ labs, userLocation, center }) {
  const labsJson = JSON.stringify(labs);
  const userJson = JSON.stringify(userLocation);
  const centerJson = JSON.stringify(center);

  // Couleurs synchronisées avec `theme.js` : impossible de lire les vars JS
  // depuis le HTML inline, on les interpole à la construction.
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #E8F1F0; }
  /* Marqueur labo : pin "goutte" turquoise médical avec ombre douce. */
  .lab-marker {
    width: 34px; height: 34px;
    background: ${C.brand};
    border: 4px solid #fff;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 4px 12px rgba(8,196,178,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .lab-marker::after {
    content: '';
    width: 10px; height: 10px;
    background: #fff;
    border-radius: 50%;
  }
  .user-marker {
    background: ${C.grape};
    border: 4px solid #fff;
    border-radius: 50%;
    width: 22px; height: 22px;
    box-shadow: 0 4px 12px rgba(124,107,255,0.5);
  }
  .leaflet-container { background: #E8F1F0 !important; }
  .leaflet-popup-content { font-family: -apple-system, system-ui, sans-serif; }
  .leaflet-popup-content h4 { margin: 0 0 4px; font-size: 14px; color: ${C.ink}; }
  .leaflet-popup-content p { margin: 0 0 8px; font-size: 12px; color: ${C.ink2}; }
  .leaflet-popup-content button {
    background: ${C.brand}; color: white; border: none;
    padding: 8px 14px; border-radius: 999px; font-weight: 700;
    font-size: 13px; cursor: pointer; width: 100%;
  }
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const center = ${centerJson};
  const labIcon  = L.divIcon({ className: 'lab-marker',  iconSize: [28, 28] });
  const userIcon = L.divIcon({ className: 'user-marker', iconSize: [18, 18] });

  const map = L.map('map', { zoomControl: true }).setView([center.lat, center.lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OSM'
  }).addTo(map);

  function notifyRN(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  let labMarkers = [];
  let userMarker = null;

  function renderLabs(labs) {
    labMarkers.forEach((m) => map.removeLayer(m));
    labMarkers = [];
    const bounds = [];
    labs.forEach((l) => {
      if (typeof l.latitude !== 'number' || typeof l.longitude !== 'number') return;
      const m = L.marker([l.latitude, l.longitude], { icon: labIcon }).addTo(map);
      const html = '<h4>' + (l.name || 'Labo') + '</h4>'
                 + '<p>' + (l.address || '') + (l.distance ? ' · ' + l.distance : '') + '</p>'
                 + '<button onclick="notifyRN({type:\\'lab_press\\', uuid:\\'' + l.uuid + '\\'})">Voir les tests</button>';
      m.bindPopup(html);
      labMarkers.push(m);
      bounds.push([l.latitude, l.longitude]);
    });
    if (userMarker) bounds.push(userMarker.getLatLng());
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    }
  }

  function renderUser(user) {
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (user) {
      userMarker = L.marker([user.lat, user.lng], { icon: userIcon })
        .addTo(map).bindPopup('Vous êtes ici');
    }
  }

  // Exposés pour injectJavaScript (cf. RN side).
  window.__updateLabs = renderLabs;
  window.__updateUser = renderUser;

  // Hydratation initiale.
  renderUser(${userJson});
  renderLabs(${labsJson});
</script>
</body></html>`;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: "hidden", backgroundColor: C.bgElev },
  web: { flex: 1, backgroundColor: "transparent" },
});
