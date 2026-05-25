import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "../icons";
import { fetchAppointments } from "../api";
import { DEFAULT_LOCATION, initials } from "../constants";

// Carte des infirmiers en visite à domicile.
// Source : appointments?visit_type=home — chaque RDV avec une `home_location`
// est rendu comme un marqueur sur la carte (et listé dans le panneau latéral).

export default function NursesMap({ lab }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

  // Load home-visit appointments
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const arr = await fetchAppointments("?visit_type=home");
        if (!cancelled) setVisits(arr);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [lab?.uuid]);

  // Init Leaflet map
  useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const start = lab?.latitude && lab?.longitude
      ? [lab.latitude, lab.longitude]
      : [DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng];
    const map = window.L.map(containerRef.current, { center: start, zoom: 12 });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = window.L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 80);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render markers when visits change
  useEffect(() => {
    if (!mapRef.current || !layerRef.current || !window.L) return;
    layerRef.current.clearLayers();

    const points = visits
      .map((v) => {
        const lat = v.home_latitude ?? v.home_location?.coordinates?.[1];
        const lng = v.home_longitude ?? v.home_location?.coordinates?.[0];
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        return { ...v, lat, lng };
      })
      .filter(Boolean);

    for (const v of points) {
      const color = v.status === "in_progress" ? "#E8633A"
                  : v.status === "confirmed" ? "#4A6FA5"
                  : "#8C857D";
      const html = `
        <div style="
          background:${color};color:white;border-radius:50%;
          width:32px;height:32px;display:grid;place-items:center;
          font-weight:600;font-size:11px;
          box-shadow:0 2px 8px rgba(0,0,0,0.25);
          border:2px solid white;
          font-family:var(--sans);
        ">${initials(v.nurse_name || v.patient_name || "?")}</div>`;
      const icon = window.L.divIcon({ html, className: "", iconSize: [32, 32] });
      const marker = window.L.marker([v.lat, v.lng], { icon }).addTo(layerRef.current);
      marker.on("click", () => setActive(v));
    }

    if (points.length > 0) {
      const group = window.L.featureGroup(layerRef.current.getLayers());
      mapRef.current.fitBounds(group.getBounds().pad(0.2));
    }
  }, [visits]);

  const stats = useMemo(() => {
    const by = { pending: 0, confirmed: 0, in_progress: 0, completed: 0 };
    for (const v of visits) by[v.status] = (by[v.status] || 0) + 1;
    return by;
  }, [visits]);

  return (
    <div className="page" style={{ maxWidth: 1600 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Infirmiers en <em>terrain</em></h1>
          <p className="page-sub">
            Suivi en temps réel des visites à domicile. Cliquez sur un marqueur pour voir le détail.
          </p>
        </div>
        <div className="page-actions">
          <div className="row" style={{ gap: 6 }}>
            <span className="badge blue"><span className="dot" />Programmé {stats.confirmed || 0}</span>
            <span className="badge orange"><span className="dot" />En cours {stats.in_progress || 0}</span>
            <span className="badge"><span className="dot" />Total {visits.length}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div ref={containerRef} style={{ height: 560 }} />
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Visites du jour</h3>
              <div className="sub">{visits.length} visite{visits.length > 1 ? "s" : ""}</div>
            </div>
            <I.Sparkle size={16} style={{ color: "var(--o)" }} />
          </div>
          <div style={{ maxHeight: 510, overflow: "auto" }}>
            {loading && <div className="empty"><span className="spinner" /> Chargement…</div>}
            {!loading && visits.length === 0 && (
              <div className="empty">Aucune visite à domicile programmée.</div>
            )}
            {!loading && visits.map((v) => {
              const isActive = active?.uuid === v.uuid;
              return (
                <button
                  key={v.uuid}
                  onClick={() => setActive(v)}
                  style={{
                    display: "flex", gap: 12, padding: "14px 22px",
                    borderBottom: "1px solid var(--line)",
                    cursor: "pointer", width: "100%",
                    border: "none", textAlign: "left",
                    background: isActive ? "var(--o-glow)" : "transparent",
                    fontFamily: "inherit",
                  }}
                >
                  <div className="avatar lg a3">{initials(v.nurse_name || "?")}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{v.nurse_name || "Non assigné"}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      → {v.patient_name} · {v.home_address?.slice(0, 40) || "—"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)", marginTop: 2 }}>
                      {new Date(v.scheduled_for).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  {v.status === "in_progress" && <span className="badge orange"><span className="dot" />En cours</span>}
                  {v.status === "confirmed" && <span className="badge blue"><span className="dot" />Programmé</span>}
                  {v.status === "completed" && <span className="badge green"><span className="dot" />Terminé</span>}
                  {v.status === "pending" && <span className="badge"><span className="dot" />En attente</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
