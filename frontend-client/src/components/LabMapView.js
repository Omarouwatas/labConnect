/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useMemo, useRef, useCallback } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
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
 *   height          : nombre — boîte fixe (mode mini-carte).
 *                     Si OMIS / undefined → mode plein écran : le composant
 *                     mesure window.width × window.height et fait remplir
 *                     ces dimensions explicites au wrap. C'est nécessaire
 *                     parce que `flex: 1` sur une WebView est intermittent
 *                     sur iOS quand elle est imbriquée dans plusieurs vues.
 *
 * ⚠️ Ne JAMAIS mettre de valeur par défaut sur `height` sinon
 *    `height !== undefined` reste toujours vrai et on a une boîte fixe.
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
  height,
}) {
  // Dimensions de la fenêtre — utilisées UNIQUEMENT en mode plein écran.
  // Le hook est réactif aux rotations.
  const { width: winW, height: winH } = useWindowDimensions();
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
    // Au moment où la WebView signale `load`, le natif vient juste de
    // lui donner ses dimensions finales. On force Leaflet à les re-lire.
    if (webRef.current) {
      webRef.current.injectJavaScript(
        "window.__invalidateSize && window.__invalidateSize(); true;",
      );
    }
  }, []);

  // Re-déclenche aussi un invalidateSize quand la WebView est mesurée
  // après coup (animation de transition de stack, rotation, etc.).
  const onLayout = useCallback(() => {
    if (initialReady.current && webRef.current) {
      webRef.current.injectJavaScript(
        "window.__invalidateSize && window.__invalidateSize(); true;",
      );
    }
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

  // Deux modes :
  //   - `height` défini   → boîte fixe (mini-carte HomeScreen) avec
  //                         coins arrondis.
  //   - `height` undefined → mode plein écran (MapScreen). On donne
  //                          des dimensions EXPLICITES en pixels via
  //                          useWindowDimensions, pas de flex/absolute,
  //                          parce que les deux sont peu fiables avec
  //                          react-native-webview sur iOS quand on
  //                          imbrique plusieurs vues.
  const fullscreen = height === undefined;
  const wrapStyle = fullscreen
    ? { width: winW, height: winH, backgroundColor: C.bgElev }
    : [styles.wrap, { height }];

  return (
    <View style={wrapStyle} onLayout={onLayout}>
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
  /* On force 100% partout dans la chaîne html → body → #map, et
     position:absolute sur #map en backup au cas où la box du body
     serait mal mesurée par WebKit/Android lors du premier layout. */
  html, body {
    margin: 0; padding: 0;
    height: 100%; width: 100%;
    overflow: hidden;
    background: #E8F1F0;
  }
  #map {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    height: 100%; width: 100%;
    background: #E8F1F0;
  }
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
  /* Position de l'utilisateur : pastille bleue pulsante façon GPS, avec
     halo doux pour suggérer la précision de la mesure. */
  .user-marker {
    position: relative;
    width: 22px; height: 22px;
  }
  .user-marker::before {
    content: '';
    position: absolute; inset: -14px;
    background: rgba(74,111,165,0.18);
    border-radius: 50%;
    animation: pulse 2.4s ease-out infinite;
  }
  .user-marker::after {
    content: '';
    position: absolute; inset: 0;
    background: #4A6FA5;
    border: 4px solid #fff;
    border-radius: 50%;
    box-shadow: 0 4px 12px rgba(74,111,165,0.5);
  }
  @keyframes pulse {
    0%   { transform: scale(0.6); opacity: 0.85; }
    100% { transform: scale(2.4); opacity: 0;    }
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

  // Hack classique Leaflet dans une WebView : la première mesure est
  // faite avant que le natif n'ait fini son layout, donc la carte ne
  // remplit que la fraction visible au moment du L.map(). On force
  // des recalculs :
  //   - dès que tout le DOM est prêt (load)
  //   - une fois après un tick (raf)
  //   - et à chaque resize de la fenêtre (rotation, switch home/map…)
  function invalidate() { try { map.invalidateSize(true); } catch (e) {} }
  window.addEventListener('load', invalidate);
  window.addEventListener('resize', invalidate);
  requestAnimationFrame(invalidate);
  setTimeout(invalidate, 80);
  setTimeout(invalidate, 400);

  // Exposé pour qu'on puisse le déclencher depuis RN via injectJavaScript.
  window.__invalidateSize = invalidate;

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
  // Mode mini-carte : hauteur fixe + coins arrondis.
  wrap: { borderRadius: 14, overflow: "hidden", backgroundColor: C.bgElev },
  // Le WebView remplit son parent — qui a soit une hauteur fixe (mini)
  // soit des dimensions en pixels via useWindowDimensions (fullscreen).
  // Dans les deux cas, le parent a une hauteur concrète → flex:1 marche.
  web: { flex: 1, backgroundColor: "transparent" },
});
