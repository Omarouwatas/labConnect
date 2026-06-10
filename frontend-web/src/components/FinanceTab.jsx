import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge } from "./Misc";
import { fetchStats } from "../api";
import { CURRENCY, initials, avatarClassFor } from "../constants";

// ──────────────────────────────────────────────────────────────────────────
// FinanceTab — onglet « Finances » du Dashboard chef de labo.
//
// Source de données : GET /lab/stats/?days=N (enrichi backend avec
// revenue_mru par jour, top_tests par revenu, avg_basket_mru). Les
// montants ne remontent que si l'utilisateur a `viewFinance` côté
// backend (biologiste / chef) — sinon ils valent null et on n'affiche
// pas le tab du tout (gating fait dans Dashboard).
//
// La liste « Facturation récente » est construite à partir des
// rendez-vous déjà chargés par le Dashboard (prop `appts`), pour
// éviter un appel réseau de plus. On garde ceux qui ont au moins un
// test, triés du plus récent au plus ancien.
//
// Props :
//   appts          — rendez-vous du labo (depuis Dashboard).
//   onOpenInvoice  — (apptUuid) => void ; ouvre l'InvoiceModal côté parent.
// ──────────────────────────────────────────────────────────────────────────

const PERIODS = [
  { id: 7,  label: "7j"  },
  { id: 30, label: "30j" },
  { id: 90, label: "90j" },
];

// Format compact « 12,4k » pour les gros montants dans les KPI.
function kfmt(n) {
  const v = Number(n || 0);
  if (v >= 1000) return `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString("fr-FR");
}

export default function FinanceTab({ appts = [], onOpenInvoice }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      setData(await fetchStats(days));
    } catch (e) {
      setErr(e?.detail || "Données financières indisponibles.");
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { reload(); }, [reload]);

  const k = data?.kpis || {};
  const revenue = k.revenue_mru || 0;
  const cnam = k.cnam_share_mru || 0;
  const patient = k.patient_share_mru || 0;
  // Part CNAM en % du revenu total (pour la barre de répartition).
  const cnamPct = revenue > 0 ? Math.round((cnam / revenue) * 100) : 0;
  const patientPct = revenue > 0 ? 100 - cnamPct : 0;

  // Courbe CA : on prend le revenu validé par jour. Max pour normaliser
  // les hauteurs de barres.
  const byDay = data?.by_day || [];
  const maxRevenue = Math.max(1, ...byDay.map((d) => d.revenue_mru || 0));

  const topTests = data?.top_tests || [];
  const maxTestRevenue = Math.max(1, ...topTests.map((t) => t.revenue_mru || 0));

  // Factures récentes — RDV avec au moins un test, triés récents d'abord.
  const recentInvoices = useMemo(() => {
    return [...appts]
      .filter((a) => (a.items?.length || 0) > 0)
      .sort((a, b) => new Date(b.scheduled_for) - new Date(a.scheduled_for))
      .slice(0, 10);
  }, [appts]);

  return (
    <>
      {/* Sélecteur de période */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <div className="segmented">
          {PERIODS.map((p) => (
            <button key={p.id} className={days === p.id ? "active" : ""} onClick={() => setDays(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="auth-error" style={{ marginBottom: 14 }}>{err}</div>}

      {/* KPI financiers */}
      <div className="grid-4" style={{ marginBottom: 22 }}>
        <div className="kpi feature">
          <span className="kpi-label">Chiffre d'affaires</span>
          <div className="kpi-val">
            {loading ? "—" : kfmt(revenue)}<span className="unit">MRU</span>
          </div>
          <span className="kpi-delta">
            sur {days} jours · {k.validated_orders ?? 0} analyses facturées
          </span>
          <svg className="kpi-spark" width="120" height="80" viewBox="0 0 120 80" fill="none">
            <path d="M0 60 Q20 50, 30 55 T60 40 T90 30 T120 10" stroke="white" strokeWidth="2" />
            <circle cx="120" cy="10" r="3" fill="white" />
          </svg>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pris en charge CNAM</span>
          <div className="kpi-val">
            {loading ? "—" : kfmt(cnam)}<span className="unit">MRU</span>
          </div>
          <span className="kpi-delta">{cnamPct}% du CA</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">À charge patient</span>
          <div className="kpi-val">
            {loading ? "—" : kfmt(patient)}<span className="unit">MRU</span>
          </div>
          <span className="kpi-delta">{patientPct}% du CA</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Panier moyen</span>
          <div className="kpi-val">
            {loading ? "—" : (k.avg_basket_mru != null ? kfmt(k.avg_basket_mru) : "—")}
            <span className="unit">MRU</span>
          </div>
          <span className="kpi-delta">par analyse validée</span>
        </div>
      </div>

      {/* CA par jour + répartition CNAM/patient */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Chiffre d'affaires par jour</h3>
              <div className="sub">Revenu validé sur la fenêtre · survol pour le détail</div>
            </div>
            <I.BarChart size={16} style={{ color: "var(--o)" }} />
          </div>
          <div className="card-pad" style={{ paddingTop: 28, paddingBottom: 36 }}>
            {loading && <div className="empty"><span className="spinner" /> Calcul…</div>}
            {!loading && byDay.length === 0 && <div className="empty">Aucun revenu sur la fenêtre.</div>}
            {!loading && byDay.length > 0 && (
              <div className="bar-chart" style={{ minHeight: 160 }}>
                {byDay.map((d) => {
                  const h = Math.max(2, Math.round(((d.revenue_mru || 0) / maxRevenue) * 100));
                  const lbl = d.date ? new Date(d.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "—";
                  return (
                    <div
                      key={d.date}
                      className="bar"
                      title={`${CURRENCY.format(d.revenue_mru || 0)} · ${d.validated} validés`}
                    >
                      <div className="fill" style={{ height: `${h}%` }} />
                      <div className="lbl">{lbl}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Répartition CNAM / patient</h3>
              <div className="sub">Qui paie le chiffre d'affaires</div>
            </div>
          </div>
          <div style={{ padding: "20px 22px" }}>
            {/* Barre empilée */}
            <div style={{
              display: "flex", height: 22, borderRadius: 999, overflow: "hidden",
              border: "1px solid var(--line)", marginBottom: 16, background: "var(--bg)",
            }}>
              {cnamPct > 0 && (
                <div style={{ width: `${cnamPct}%`, background: "var(--blue)" }} title={`CNAM ${cnamPct}%`} />
              )}
              {patientPct > 0 && (
                <div style={{ width: `${patientPct}%`, background: "var(--o)" }} title={`Patient ${patientPct}%`} />
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--blue)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Caisse CNAM</div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{CURRENCY.format(cnam)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--o)", flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Reste à charge patient</div>
                </div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{CURRENCY.format(patient)}</div>
              </div>
              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", alignItems: "center" }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Total facturable</div>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--o-deep)", fontSize: 16 }}>
                  {CURRENCY.format(revenue)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top tests par revenu + facturation récente */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Top analyses par revenu</h3>
              <div className="sub">Les examens qui rapportent le plus</div>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Analyse</th>
                <th className="num">Volume</th>
                <th className="num">Revenu</th>
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={3} className="empty"><span className="spinner" /> Calcul…</td></tr>)}
              {!loading && topTests.length === 0 && (
                <tr><td colSpan={3} className="empty">Aucune analyse validée sur la fenêtre.</td></tr>
              )}
              {!loading && topTests.map((t) => (
                <tr key={t.test_code}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CatBadge catId={t.sample_type || "blood"} withDot={false} />
                      <div>
                        <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13 }}>{t.test_code}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t.test_name}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 6, height: 6, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        width: `${Math.max(4, Math.round((t.revenue_mru / maxTestRevenue) * 100))}%`,
                        height: "100%", background: "var(--o)",
                      }} />
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{t.count}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{CURRENCY.format(t.revenue_mru)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Facturation récente</h3>
              <div className="sub">Cliquez une ligne pour voir / imprimer la facture</div>
            </div>
            <span className="badge orange"><span className="dot" />{recentInvoices.length}</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Date</th>
                <th className="num">CNAM</th>
                <th className="num">Patient</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {recentInvoices.length === 0 && (
                <tr><td colSpan={5} className="empty">Aucune facture pour la période.</td></tr>
              )}
              {recentInvoices.map((a) => (
                <tr
                  key={a.uuid}
                  onClick={() => onOpenInvoice?.(a.uuid)}
                  style={{ cursor: "pointer" }}
                  title="Voir la facture détaillée"
                >
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className={`avatar ${avatarClassFor(a.patient_uuid)}`} style={{ width: 28, height: 28, fontSize: 11 }}>
                        {initials(a.patient_name || a.patient_phone || "?")}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{a.patient_name || "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {a.items?.length || 0} test{(a.items?.length || 0) > 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                    {a.scheduled_for ? new Date(a.scheduled_for).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—"}
                  </td>
                  <td className="num" style={{ color: "var(--ink-3)" }}>
                    {a.cnam_covered_mru ? CURRENCY.format(a.cnam_covered_mru) : "—"}
                  </td>
                  <td className="num">{a.patient_due_mru ? CURRENCY.format(a.patient_due_mru) : "—"}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {a.items_total_mru ? CURRENCY.format(a.items_total_mru) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
