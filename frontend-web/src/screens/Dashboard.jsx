import { useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
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
  // Un user qui n'a pas accès aux finances voit moins de KPI ;
  // c'est piloté par la permission `viewFinance` (union des rôles).
  const hideFinance = !permissions.viewFinance;

  useEffect(() => {
    (async () => {
      const [o, s, e, a] = await Promise.allSettled([
        fetchOrders(), fetchSamples(), fetchEmployees(), fetchAppointments(),
      ]);
      if (o.status === "fulfilled") setOrders(o.value);
      if (s.status === "fulfilled") setSamples(s.value);
      if (e.status === "fulfilled") setEmployees(e.value);
      if (a.status === "fulfilled") setAppts(a.value);
    })();
  }, []);

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonjour <em>{greetingFirst}</em>, voici votre journée.</h1>
          <p className="page-sub">
            Vue d'ensemble des analyses en cours, du staff en poste et de l'activité du laboratoire.
          </p>
        </div>
        <div className="page-actions">
          {!permissions.editTests && <PermRibbon>Vue analyste</PermRibbon>}
          <button className="btn btn-secondary"><I.Export size={14} sw={1.8} /> Exporter</button>
          {permissions.editTests && (
            <button className="btn btn-orange"><I.Plus size={14} sw={2} /> Nouvelle analyse</button>
          )}
        </div>
      </div>

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
    </div>
  );
}
