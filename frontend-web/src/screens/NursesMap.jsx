// Écran « Tournées » — refonte de l'ancienne NursesMap.
//
// Un seul écran, deux profils d'utilisation différents :
//
//   • Pour la SECRÉTAIRE / le CHEF (permissions.manageHomeVisits) :
//      - section « À affecter » (visites home sans infirmière)
//      - section « Toutes les tournées » du labo, scope=all
//      - modal d'affectation par sélection dans la liste des nurses
//
//   • Pour l'INFIRMIÈRE (rôle nurse seul) :
//      - section « Ma tournée du jour », scope=mine
//      - boutons « Démarrer la visite » / « Visite terminée »
//
// La carte Leaflet à droite reste partagée et affiche les marqueurs
// avec un code couleur lié au statut. Cliquer sur un marqueur ouvre
// la fiche de la visite à gauche.
//
// Le backend gère le scope automatiquement (mine si nurse pure, all si
// staff manager), donc on n'envoie scope explicite que quand l'écran
// doit forcer une vue particulière.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "../icons";
import Modal from "../components/Modal";
import {
  fetchHomeVisits, fetchNurses, assignNurse, changeApptStatus,
} from "../api";
import { useAuth } from "../auth";
import { DEFAULT_LOCATION, ROLES, initials, avatarClassFor } from "../constants";

// ── Constantes UI ────────────────────────────────────────────────────────
const STATUS_META = {
  pending:     { label: "À affecter",  cls: "",        color: "#8C857D", dotKind: "•" },
  confirmed:   { label: "Programmée",  cls: "blue",    color: "#4A6FA5", dotKind: "•" },
  in_progress: { label: "En cours",    cls: "amber",   color: "#E8633A", dotKind: "●" },
  completed:   { label: "Terminée",    cls: "green",   color: "#3A8C5A", dotKind: "✓" },
  cancelled:   { label: "Annulée",     cls: "rose",    color: "#B23A48", dotKind: "✕" },
  no_show:     { label: "Absent",      cls: "rose",    color: "#B23A48", dotKind: "?" },
};

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Aujourd'hui · ${hm}`;
  if (isTomorrow) return `Demain · ${hm}`;
  return d.toLocaleString("fr-FR", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
};

// ── Modal d'affectation ──────────────────────────────────────────────────

function AssignNurseModal({ appt, nurses, onClose, onAssigned }) {
  const [selected, setSelected] = useState(() => appt.nurse_uuid || null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (uuid) => {
    setErr(null); setSaving(true);
    try {
      const updated = await assignNurse(appt.uuid, uuid);
      onAssigned(updated);
    } catch (e) {
      setErr(e?.detail || "Impossible d'affecter l'infirmière.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={<>Affecter une <em>infirmière</em></>}
      subtitle={`Visite chez ${appt.patient_name || "—"} · ${fmtWhen(appt.scheduled_for)}`}
      onClose={onClose}
      footer={
        <>
          <div className="hint">
            La visite passera automatiquement de « En attente » à « Programmée » à l'affectation.
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
            {appt.nurse_uuid && (
              <button
                className="btn btn-secondary"
                onClick={() => submit(null)}
                disabled={saving}
                title="Retirer l'infirmière de cette visite"
              >
                {saving ? <span className="spinner" /> : <I.X size={14} sw={2} />} Désaffecter
              </button>
            )}
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      {nurses.length === 0 ? (
        <div className="empty">
          Aucune infirmière enregistrée dans ce laboratoire.
          Invitez d'abord un·e infirmier·e depuis l'écran Personnel.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {nurses.map((n) => {
            const name = `${n.first_name || ""} ${n.last_name || ""}`.trim() || n.phone || n.email || "—";
            const isCurrent = appt.nurse_uuid === n.uuid;
            const isSelected = selected === n.uuid;
            return (
              <button
                key={n.uuid}
                onClick={() => { setSelected(n.uuid); submit(n.uuid); }}
                disabled={saving}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px", borderRadius: "var(--radius)",
                  border: isSelected || isCurrent
                    ? "1.5px solid var(--o)"
                    : "1px solid var(--line)",
                  background: isSelected || isCurrent ? "var(--o-glow)" : "var(--surface)",
                  textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                  transition: "border-color 120ms, background 120ms",
                }}
              >
                <div className={`avatar lg ${avatarClassFor(n.uuid)}`}>{initials(name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {n.phone || n.email || "—"}
                    {n.employee_id && <span style={{ fontFamily: "var(--mono)" }}> · {n.employee_id}</span>}
                  </div>
                </div>
                {n.is_on_duty
                  ? <span className="badge green"><span className="dot" />En poste</span>
                  : <span className="badge"><span className="dot" />Hors poste</span>}
                {isCurrent && <span className="badge orange" style={{ marginLeft: 6 }}><span className="dot" />Actuelle</span>}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ── Carte d'une visite (item de liste) ──────────────────────────────────

function VisitItem({ visit, active, onClick, onStart, onComplete, onAssignClick, canManage, currentUserUuid }) {
  const meta = STATUS_META[visit.status] || STATUS_META.pending;
  const nurseName = visit.nurse_name || "Non affectée";
  const isMine = visit.nurse_uuid && visit.nurse_uuid === currentUserUuid;
  const canStart = visit.status === "confirmed" && (canManage || isMine);
  const canComplete = visit.status === "in_progress" && (canManage || isMine);

  return (
    <div
      style={{
        padding: "12px 18px",
        borderBottom: "1px solid var(--line)",
        background: active ? "var(--o-glow)" : "transparent",
        borderLeft: active ? "3px solid var(--o)" : "3px solid transparent",
        transition: "background 120ms, border-color 120ms",
      }}
    >
      <button
        onClick={onClick}
        style={{
          display: "flex", gap: 12, width: "100%",
          border: "none", background: "transparent",
          textAlign: "left", cursor: "pointer", padding: 0,
          fontFamily: "inherit",
        }}
      >
        <div className={`avatar lg ${avatarClassFor(visit.patient_uuid)}`}>
          {initials(visit.patient_name || "?")}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13.5 }}>
            {visit.patient_name || "—"}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            <I.Building size={11} sw={1.8} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {visit.home_address?.slice(0, 50) || "Adresse manquante"}
            {(visit.home_address || "").length > 50 ? "…" : ""}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11.5, color: "var(--ink-3)" }}>
            <span style={{ fontFamily: "var(--mono)" }}>{fmtWhen(visit.scheduled_for)}</span>
            <span>·</span>
            <span>{nurseName}</span>
          </div>
        </div>
        <span className={`badge ${meta.cls}`}><span className="dot" />{meta.label}</span>
      </button>

      {/* Actions contextuelles — uniquement quand la fiche est active */}
      {active && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {canManage && (
            <button
              className="btn btn-secondary"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={onAssignClick}
              title="Affecter ou changer l'infirmière"
            >
              <I.Users size={12} sw={1.8} /> {visit.nurse_uuid ? "Réaffecter" : "Affecter"}
            </button>
          )}
          {canStart && (
            <button
              className="btn btn-orange"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={onStart}
            >
              <I.Sparkle size={12} sw={1.8} /> Démarrer la visite
            </button>
          )}
          {canComplete && (
            <button
              className="btn btn-orange"
              style={{ padding: "6px 10px", fontSize: 12 }}
              onClick={onComplete}
            >
              <I.Check size={12} sw={1.8} /> Marquer terminée
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Écran principal ───────────────────────────────────────────────────────

export default function NursesMap({ lab, permissions }) {
  const { user, roles } = useAuth();
  // Une nurse SANS autre rôle manager voit son propre planning.
  const canManage = !!permissions?.manageHomeVisits;
  const isNurse = (roles || []).includes(ROLES.NURSE);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const [visits, setVisits] = useState([]);
  const [nurses, setNurses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  // Si manager → "all" par défaut ; sinon "mine".
  const [scope, setScope] = useState(canManage ? "all" : "mine");
  const [showDone, setShowDone] = useState(false);

  // ── Chargement ────────────────────────────────────────────────────────
  const reload = useCallback(async () => {
    setError(null); setLoading(true);
    const params = new URLSearchParams();
    params.set("scope", scope);
    if (showDone) params.set("include_done", "1");
    try {
      const [v, n] = await Promise.allSettled([
        fetchHomeVisits(`?${params.toString()}`),
        canManage ? fetchNurses() : Promise.resolve([]),
      ]);
      if (v.status === "fulfilled") setVisits(v.value);
      else throw v.reason;
      if (n.status === "fulfilled") setNurses(n.value);
    } catch (e) {
      setError(e?.detail || "Impossible de charger les tournées.");
    } finally { setLoading(false); }
  }, [scope, showDone, canManage]);

  useEffect(() => { reload(); }, [reload, lab?.uuid]);

  // ── Init Leaflet ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const start = lab?.latitude && lab?.longitude
      ? [lab.latitude, lab.longitude]
      : [DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng];
    const map = window.L.map(containerRef.current, { center: start, zoom: 12 });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = window.L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 80);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render des markers à chaque changement de visits ou active
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
      const meta = STATUS_META[v.status] || STATUS_META.pending;
      const isActive = active?.uuid === v.uuid;
      const size = isActive ? 38 : 32;
      const html = `
        <div style="
          background:${meta.color};
          color:white;border-radius:50%;
          width:${size}px;height:${size}px;
          display:grid;place-items:center;
          font-weight:600;font-size:11px;
          box-shadow:0 ${isActive ? 4 : 2}px ${isActive ? 14 : 8}px rgba(0,0,0,0.28);
          border:${isActive ? 3 : 2}px solid white;
          font-family:var(--sans);
        ">${initials(v.patient_name || "?")}</div>`;
      const icon = window.L.divIcon({ html, className: "", iconSize: [size, size] });
      const marker = window.L.marker([v.lat, v.lng], { icon }).addTo(layerRef.current);
      marker.on("click", () => {
        setActive(v);
        mapRef.current.flyTo([v.lat, v.lng], Math.max(mapRef.current.getZoom(), 14));
      });
    }

    if (points.length > 0 && !active) {
      const group = window.L.featureGroup(layerRef.current.getLayers());
      mapRef.current.fitBounds(group.getBounds().pad(0.2));
    }
  }, [visits, active]);

  // ── Sections de la liste (à affecter / programmées / en cours) ──────
  const sections = useMemo(() => {
    const unassigned = [];
    const inProgress = [];
    const planned = [];
    const done = [];
    for (const v of visits) {
      if (v.status === "in_progress") inProgress.push(v);
      else if (v.status === "completed") done.push(v);
      else if (!v.nurse_uuid) unassigned.push(v);
      else planned.push(v);
    }
    // Tri par date croissante dans chaque section.
    const byDate = (a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for);
    return {
      unassigned: unassigned.sort(byDate),
      inProgress: inProgress.sort(byDate),
      planned: planned.sort(byDate),
      done: done.sort(byDate),
    };
  }, [visits]);

  const counters = {
    total: visits.length,
    unassigned: sections.unassigned.length,
    inProgress: sections.inProgress.length,
    planned: sections.planned.length,
    done: sections.done.length,
  };

  // ── Actions sur une visite ─────────────────────────────────────────
  const startVisit = async (visit) => {
    try {
      await changeApptStatus(visit.uuid, "in_progress");
      await reload();
    } catch (e) {
      alert(e?.detail || "Impossible de démarrer la visite.");
    }
  };
  const completeVisit = async (visit) => {
    try {
      await changeApptStatus(visit.uuid, "completed");
      await reload();
    } catch (e) {
      alert(e?.detail || "Impossible de clôturer la visite.");
    }
  };
  const onAssigned = (updated) => {
    setAssignTarget(null);
    // On remplace localement plutôt que de tout recharger.
    setVisits((prev) => prev.map((v) => v.uuid === updated.uuid ? updated : v));
    setActive(updated);
  };

  // ── Rendu ──────────────────────────────────────────────────────────
  const titleLabel = canManage ? "Tournées du laboratoire" : "Ma tournée du jour";
  const subtitle = canManage
    ? "Affectez les visites à domicile et suivez vos infirmier·es sur le terrain."
    : "Vos prélèvements à domicile programmés. Démarrez la visite à votre arrivée chez le patient.";

  const Section = ({ title, color, list, emptyText }) => (
    list.length === 0 ? (
      emptyText ? <div className="empty" style={{ padding: 18 }}>{emptyText}</div> : null
    ) : (
      <>
        <div style={{
          padding: "10px 18px 8px", fontSize: 11.5, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: ".06em",
          color: color || "var(--ink-3)",
          background: "var(--bg)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}>
          {title} · {list.length}
        </div>
        {list.map((v) => (
          <VisitItem
            key={v.uuid}
            visit={v}
            active={active?.uuid === v.uuid}
            onClick={() => setActive(v)}
            onStart={() => startVisit(v)}
            onComplete={() => completeVisit(v)}
            onAssignClick={() => setAssignTarget(v)}
            canManage={canManage}
            currentUserUuid={user?.uuid}
          />
        ))}
      </>
    )
  );

  return (
    <div className="page" style={{ maxWidth: 1700 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">{titleLabel.split(" ")[0]}{" "}<em>{titleLabel.split(" ").slice(1).join(" ")}</em></h1>
          <p className="page-sub">{subtitle}</p>
        </div>
        <div className="page-actions">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {canManage && counters.unassigned > 0 && (
              <span className="badge orange">
                <span className="dot" />{counters.unassigned} à affecter
              </span>
            )}
            <span className="badge blue"><span className="dot" />Programmées {counters.planned}</span>
            <span className="badge amber"><span className="dot" />En cours {counters.inProgress}</span>
            {showDone && <span className="badge green"><span className="dot" />Terminées {counters.done}</span>}
          </div>
          <button
            className="btn btn-secondary"
            onClick={reload}
            title="Rafraîchir"
            style={{ marginLeft: 6 }}
          >
            {loading ? <span className="spinner" /> : <I.Sparkle size={14} sw={1.7} />} Rafraîchir
          </button>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}

      {/* Filtres : scope (chef vs nurse seulement utile au manager qui a aussi le rôle nurse) + include_done */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {canManage && isNurse && (
          <div className="segmented">
            <button className={scope === "all"  ? "active" : ""} onClick={() => setScope("all")}>Toutes</button>
            <button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>Mes visites</button>
          </div>
        )}
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          fontSize: 13, color: "var(--ink-2)", cursor: "pointer",
        }}>
          <input
            type="checkbox" checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Inclure les visites terminées
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        {/* Carte */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div ref={containerRef} style={{ height: 620 }} />
        </div>

        {/* Liste sectionnée */}
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <div>
              <h3>{canManage ? "Visites à organiser" : "Mes visites"}</h3>
              <div className="sub">
                {counters.total} visite{counters.total > 1 ? "s" : ""} chargée{counters.total > 1 ? "s" : ""}
              </div>
            </div>
            <I.Sparkle size={16} style={{ color: "var(--o)" }} />
          </div>

          <div style={{ flex: 1, overflow: "auto", maxHeight: 560 }}>
            {loading && (
              <div className="empty" style={{ padding: 24 }}>
                <span className="spinner" /> Chargement…
              </div>
            )}
            {!loading && counters.total === 0 && (
              <div className="empty" style={{ padding: 24 }}>
                {canManage
                  ? "Aucune visite à domicile en cours pour ce laboratoire."
                  : "Aucune visite ne vous est assignée pour le moment."}
              </div>
            )}

            {!loading && (
              <>
                {canManage && (
                  <Section title="À affecter" color="var(--rose)" list={sections.unassigned} />
                )}
                <Section title="En cours"    color="var(--amber)" list={sections.inProgress} />
                <Section title="Programmées" color="var(--blue)"  list={sections.planned} />
                {showDone && (
                  <Section title="Terminées" color="var(--green)" list={sections.done} />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal d'affectation */}
      {assignTarget && (
        <AssignNurseModal
          appt={assignTarget}
          nurses={nurses}
          onClose={() => setAssignTarget(null)}
          onAssigned={onAssigned}
        />
      )}
    </div>
  );
}
