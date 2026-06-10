import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
import WalkInModal from "../components/WalkInModal";
import AppointmentDetailModal from "../components/AppointmentDetailModal";
import InvoiceModal from "../components/InvoiceModal";
import FinanceTab from "../components/FinanceTab";
import { fetchOrders, fetchSamples, fetchEmployees, fetchAppointments } from "../api";
import { ROLE_LABELS, initials, avatarClassFor } from "../constants";

function StatusBadge({ status }) {
  if (status === "validated") return <span className="badge green"><span className="dot" />Validé</span>;
  if (status === "completed") return <span className="badge blue"><span className="dot" />À valider</span>;
  if (status === "in_progress") return <span className="badge amber"><span className="dot" />En cours</span>;
  if (status === "rejected") return <span className="badge rose"><span className="dot" />Rejeté</span>;
  return <span className="badge"><span className="dot" />En attente</span>;
}

export default function Dashboard({ user, lab, permissions }) {
  const [orders, setOrders] = useState([]);
  const [samples, setSamples] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [appts, setAppts] = useState([]);
  const [walkInOpen, setWalkInOpen] = useState(false);
  // Modal de gestion d'un RDV — null = fermé. On garde l'objet complet
  // (et non juste l'uuid) pour éviter un round-trip à l'ouverture.
  const [activeAppt, setActiveAppt] = useState(null);
  // Onglet actif du dashboard : "overview" (activité) ou "finance" (CA,
  // CNAM, factures). Le tab Finances n'existe que pour qui a viewFinance
  // (chef de labo / biologiste).
  const [tab, setTab] = useState("overview");
  // Facture ouverte depuis le tab Finances — uuid du RDV ou null.
  const [invoiceAppt, setInvoiceAppt] = useState(null);
  const showFinanceTab = !!permissions.viewFinance;
  // Garde-fou : si on perd la permission alors qu'on est sur le tab
  // finance, on rebascule sur overview.
  const effectiveTab = (tab === "finance" && showFinanceTab) ? "finance" : "overview";
  // Un user qui n'a pas accès aux finances voit moins de KPI ;
  // c'est piloté par la permission `viewFinance` (union des rôles).
  const hideFinance = !permissions.viewFinance;
  // « Nouvelle analyse » crée un patient + appointment + sample + orders —
  // c'est de la création d'échantillon, pas de l'édition de catalogue.
  // Le rôle requis côté backend est secretary/nurse/lab_chief.
  const canWalkIn = !!permissions.createSample;

  const reload = useCallback(async () => {
    const [o, s, e, a] = await Promise.allSettled([
      fetchOrders(), fetchSamples(), fetchEmployees(), fetchAppointments(),
    ]);
    if (o.status === "fulfilled") setOrders(o.value);
    if (s.status === "fulfilled") setSamples(s.value);
    if (e.status === "fulfilled") setEmployees(e.value);
    if (a.status === "fulfilled") setAppts(a.value);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const onWalkInCreated = useCallback((result) => {
    // Petit feedback puis reload silencieux des KPI/queue.
    const newPatient = result?.patient_created ? " · nouveau patient enregistré" : "";
    // eslint-disable-next-line no-alert
    //alert(`Analyse créée ✓ ${result?.tests_count || ""} test${(result?.tests_count || 0) > 1 ? "s" : ""}${newPatient}.`);
    reload();
  }, [reload]);

  const kpis = useMemo(() => {
    const totalToday = appts.filter((a) => {
      const d = new Date(a.scheduled_for);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;
    const toValidate = orders.filter((o) => o.status === "completed").length;
    const avgTat = "1.8";
    const revenue = orders
      .filter((o) => o.status === "validated")
      .reduce((sum, o) => sum + (Number(o.price_mru) || 0), 0);
    return [
      { label: "Analyses aujourd'hui", value: String(totalToday).padStart(2, "0"), unit: "tests",   delta: "+12%", feature: true },
      { label: "En attente de validation", value: String(toValidate).padStart(2, "0"), unit: "lots",  delta: toValidate > 5 ? "+2" : "−1", down: toValidate > 5 },
      { label: "Délai moyen",       value: avgTat, unit: "h",     delta: "−14%" },
      { label: "Revenu de la semaine", value: Math.round(revenue / 1000) || "0", unit: "k MRU", delta: "+8%", hideForTech: true },
    ].filter((k) => !(k.hideForTech && hideFinance));
  }, [orders, appts, hideFinance]);

  const recentFeed = useMemo(() => {
    const items = [];
    for (const o of orders.slice(0, 5)) {
      const when = o.completed_at || o.started_at || o.created_at;
      if (o.status === "validated") {
        items.push({ who: "Biologiste", what: "a validé", target: o.test_name || o.test_code, when });
      } else if (o.status === "completed") {
        items.push({ who: "Technicien", what: "a saisi un résultat pour", target: o.test_name || o.test_code, when });
      } else if (o.status === "in_progress") {
        items.push({ who: "Labo", what: "a démarré", target: o.test_name || o.test_code, when });
      }
    }
    return items.slice(0, 5);
  }, [orders]);

  const greetingFirst = user?.first_name || user?.last_name || "vous";

  const inServiceStaff = employees.filter((s) => s.is_on_duty).slice(0, 5);

  const WEEK = [
    { day: "Lun", value: 0.72 },
    { day: "Mar", value: 0.88 },
    { day: "Mer", value: 0.64 },
    { day: "Jeu", value: 0.92 },
    { day: "Ven", value: 0.78 },
    { day: "Sam", value: 0.45, muted: true },
    { day: "Dim", value: 0.20, muted: true },
  ];

  const queue = orders
    .filter((o) => o.status === "in_progress" || o.status === "pending")
    .slice(0, 5);

  // Rendez-vous récents — affichage explicite des RDV pris depuis l'app
  // mobile ou créés en walk-in. On garde les 8 plus récents, triés par
  // `scheduled_for` croissant (les RDV imminents en premier, puis les
  // futurs plus lointains, puis le passé en bas).
  const upcomingAppts = useMemo(() => {
    const now = Date.now();
    const sorted = [...appts].sort((a, b) => {
      const da = new Date(a.scheduled_for).getTime();
      const db = new Date(b.scheduled_for).getTime();
      const aFuture = da >= now ? 0 : 1;
      const bFuture = db >= now ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return aFuture === 0 ? da - db : db - da; // futur asc, passé desc
    });
    return sorted.slice(0, 8);
  }, [appts]);

  const fmtApptWhen = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return `Aujourd'hui · ${hm}`;
    if (isTomorrow) return `Demain · ${hm}`;
    return d.toLocaleString("fr-FR", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  };

  const apptStatusLabel = (s) => ({
    pending: { label: "En attente", cls: "" },
    confirmed: { label: "Confirmé", cls: "blue" },
    in_progress: { label: "En cours", cls: "amber" },
    completed: { label: "Terminé", cls: "green" },
    cancelled: { label: "Annulé", cls: "rose" },
    no_show: { label: "Absent", cls: "rose" },
  }[s] || { label: s, cls: "" });

  const visitTypeLabel = (t) => ({
    in_lab: "Au labo",
    home: "À domicile",
    emergency: "Urgence",
  }[t] || t);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonjour <em>{greetingFirst}</em>, voici votre journée.</h1>
          <p className="page-sub">
            {effectiveTab === "finance"
              ? "Chiffre d'affaires, couverture CNAM et facturation du laboratoire."
              : "Vue d'ensemble des analyses en cours, du staff en poste et de l'activité du laboratoire."}
          </p>
        </div>
        <div className="page-actions">
          {!canWalkIn && <PermRibbon>Vue analyste</PermRibbon>}
          <button className="btn btn-secondary"><I.Export size={14} sw={1.8} /> Exporter</button>
          {canWalkIn && (
            <button
              className="btn btn-orange"
              onClick={() => setWalkInOpen(true)}
              title="Créer une analyse pour un patient présent au comptoir"
            >
              <I.Plus size={14} sw={2} /> Nouvelle analyse
            </button>
          )}
        </div>
      </div>

      {/* Onglets — n'apparaissent que si l'utilisateur a accès aux
          finances. Sinon le dashboard reste mono-vue (overview). */}
      {showFinanceTab && (
        <div className="segmented" style={{ marginBottom: 22 }}>
          <button
            className={effectiveTab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            <I.Home size={13} sw={1.8} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Vue d'ensemble
          </button>
          <button
            className={effectiveTab === "finance" ? "active" : ""}
            onClick={() => setTab("finance")}
          >
            <I.BarChart size={13} sw={1.8} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Finances
          </button>
        </div>
      )}

      {walkInOpen && (
        <WalkInModal
          onClose={() => setWalkInOpen(false)}
          onCreated={onWalkInCreated}
        />
      )}

      {activeAppt && (
        <AppointmentDetailModal
          appt={activeAppt}
          permissions={permissions}
          onClose={() => setActiveAppt(null)}
          onUpdated={(updated) => {
            // Met à jour la ligne dans la table sans tout recharger,
            // puis lance un reload silencieux pour rafraîchir aussi
            // les KPI et la file d'attente impactées par la cascade.
            setAppts((prev) => prev.map((a) => a.uuid === updated.uuid ? updated : a));
            reload();
          }}
        />
      )}

      {/* Facture détaillée — ouverte depuis le tab Finances. */}
      {invoiceAppt && (
        <InvoiceModal
          apptUuid={invoiceAppt}
          onClose={() => setInvoiceAppt(null)}
        />
      )}

      {/* ── Tab Finances ──────────────────────────────────────────── */}
      {effectiveTab === "finance" && (
        <FinanceTab appts={appts} onOpenInvoice={setInvoiceAppt} />
      )}

      {/* ── Tab Vue d'ensemble (contenu existant) ─────────────────── */}
      {effectiveTab === "overview" && (
      <>{/* fragment ouvrant — fermé en fin de page */}

      <div className="grid-4" style={{ marginBottom: 22 }}>
        {kpis.map((k, i) => (
          <div key={i} className={`kpi ${k.feature ? "feature" : ""}`}>
            <span className="kpi-label">{k.label}</span>
            <div className="kpi-val">{k.value}<span className="unit">{k.unit}</span></div>
            <span className={`kpi-delta ${k.down ? "down" : ""}`}>
              {k.down ? <I.Down size={12} sw={2.4} /> : <I.Up size={12} sw={2.4} />}
              {k.delta} vs sem. dernière
            </span>
            {k.feature && (
              <svg className="kpi-spark" width="120" height="80" viewBox="0 0 120 80" fill="none">
                <path d="M0 60 Q20 50, 30 55 T60 40 T90 30 T120 10" stroke="white" strokeWidth="2" />
                <circle cx="120" cy="10" r="3" fill="white" />
              </svg>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Volume d'analyses</h3>
              <div className="sub">7 derniers jours · répartition par catégorie</div>
            </div>
            <div className="segmented">
              <button className="active">Semaine</button>
              <button>Mois</button>
              <button>Année</button>
            </div>
          </div>
          <div className="card-pad" style={{ paddingTop: 28, paddingBottom: 36 }}>
            <div className="bar-chart">
              {WEEK.map((d, i) => (
                <div key={i} className={`bar ${d.muted ? "muted" : ""}`}>
                  <div className="fill" style={{ height: `${d.value * 100}%` }} />
                  <div className="lbl">{d.day}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Staff en poste</h3>
              <div className="sub">Aujourd'hui · {inServiceStaff.length} actif{inServiceStaff.length > 1 ? "s" : ""}</div>
            </div>
            <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }}>Voir tout</button>
          </div>
          <div style={{ padding: "8px 0" }}>
            {inServiceStaff.length === 0 && <div className="empty">Aucun staff en poste.</div>}
            {inServiceStaff.map((s) => {
              const name = `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.email || s.phone;
              return (
                <div key={s.uuid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 22px" }}>
                  <div className={`avatar lg ${avatarClassFor(s.uuid)}`}>{initials(name)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13.5 }}>{name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      {(s.roles || []).map((r) => ROLE_LABELS[r] || r).join(" · ")}
                    </div>
                  </div>
                  <span className="badge green"><span className="dot" />actif</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Rendez-vous récents ─────────────────────────────────────
          Affiche les 8 RDV les plus pertinents (imminents d'abord, puis
          futurs lointains, puis passés) : ceux pris depuis l'app mobile,
          du walk-in comptoir et des consoles staff confondus. C'est la
          source de vérité visible côté web — précédemment seul un KPI
          comptabilisait les RDV du jour. */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <div>
            <h3>Rendez-vous récents</h3>
            <div className="sub">
              {appts.length} RDV au total · les 8 prochains
              {appts.length > 8 ? " — utilisez Analyses pour la liste complète" : ""}
            </div>
          </div>
          <span className="badge orange"><span className="dot" />{appts.length}</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Quand</th>
              <th>Type</th>
              <th>Statut</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {upcomingAppts.length === 0 && (
              <tr><td colSpan={5} className="empty">
                {lab
                  ? `Aucun rendez-vous pour ${lab.name || "ce laboratoire"}.`
                  : "Sélectionnez un laboratoire actif en haut à droite."}
              </td></tr>
            )}
            {upcomingAppts.map((a) => {
              const st = apptStatusLabel(a.status);
              // Toute la ligne est cliquable → ouvre la modal de gestion.
              // On garde un curseur pointer + un léger hover pour signaler
              // que c'est actionnable, sans alourdir le visuel.
              return (
                <tr
                  key={a.uuid}
                  onClick={() => setActiveAppt(a)}
                  style={{ cursor: "pointer" }}
                  title="Voir le détail et avancer le rendez-vous"
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className={`avatar ${avatarClassFor(a.patient_uuid)}`} style={{ width: 28, height: 28, fontSize: 11 }}>
                        {initials(a.patient_name || a.patient_phone || "?")}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {a.patient_name || "—"}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                          {a.patient_phone || "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{fmtApptWhen(a.scheduled_for)}</td>
                  <td>
                    <span className="badge"><span className="dot" />{visitTypeLabel(a.visit_type)}</span>
                  </td>
                  <td>
                    <span className={`badge ${st.cls}`}><span className="dot" />{st.label}</span>
                  </td>
                  <td className="num" style={{ fontFamily: "var(--mono)" }}>
                    {a.patient_due_mru
                      ? `${Number(a.patient_due_mru).toFixed(0)} MRU`
                      : (a.total_fee_mru ? `${Number(a.total_fee_mru).toFixed(0)} MRU` : "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16, marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Activité récente</h3>
              <div className="sub">Audit log du laboratoire</div>
            </div>
            <I.Sparkle size={16} style={{ color: "var(--o)" }} />
          </div>
          <div>
            {recentFeed.length === 0 && <div className="empty">Aucune activité récente.</div>}
            {recentFeed.map((f, i) => (
              <div key={i} className="feed-item">
                <div className="dot-col">
                  <div className="feed-dot" style={{ background: i === 0 ? "var(--o)" : "var(--line-2)" }} />
                  <div className="feed-line" />
                </div>
                <div className="feed-body">
                  <div><strong>{f.who}</strong> {f.what} <span style={{ color: "var(--o-deep)" }}>{f.target}</span></div>
                  <div className="feed-when">{f.when ? new Date(f.when).toLocaleString("fr-FR") : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>File d'attente</h3>
              <div className="sub">Ordres à traiter</div>
            </div>
            <span className="badge orange"><span className="dot" />{queue.length} en file</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Test</th>
                <th>Statut</th>
                <th>Reçu</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 && (
                <tr><td colSpan={4} className="empty">Aucun ordre en attente.</td></tr>
              )}
              {queue.map((r) => (
                <tr key={r.uuid}>
                  <td className="num">{r.sample_barcode?.slice(0, 7) || "—"}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CatBadge catId={r.sample_type || "blood"} withDot={false} />
                      <span style={{ fontWeight: 500 }}>{r.test_code || r.test_name}</span>
                    </div>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num" style={{ color: "var(--ink-3)" }}>
                    {r.started_at ? new Date(r.started_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}{/* ── fin tab Vue d'ensemble ── */}
    </div>
  );
}
