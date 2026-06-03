import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
import { fetchStats } from "../api";
import { CURRENCY, CATEGORIES, initials, avatarClassFor } from "../constants";

const PERIODS = [
  { id: 7,  label: "7j"  },
  { id: 30, label: "30j" },
  { id: 90, label: "90j" },
];

const STATUS_LABEL = {
  pending:     { label: "En attente", color: "var(--ink-3)" },
  in_progress: { label: "En cours",   color: "#3b82f6"      },
  completed:   { label: "À valider",  color: "var(--amber)" },
  validated:   { label: "Validés",    color: "var(--green)" },
  rejected:    { label: "Rejetés",    color: "var(--rose)"  },
};

// Mini bar chart générique — chaque barre = max((value/max)*100, 4)% pour
// que les barres ultra-petites restent visibles. Pas de dépendance externe.
function HBar({ value, max, color }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{
      height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden",
    }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color || "var(--o)" }} />
    </div>
  );
}

function DayBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.orders || 0));
  return (
    <div className="bar-chart" style={{ minHeight: 140 }}>
      {rows.map((d) => {
        const h = Math.max(2, Math.round(((d.orders || 0) / max) * 100));
        const day = d.date ? new Date(d.date).toLocaleDateString("fr-FR", { weekday: "short" }) : "—";
        return (
          <div key={d.date} className="bar" title={`${d.orders} ordres · ${d.validated} validés`}>
            <div className="fill" style={{ height: `${h}%` }} />
            <div className="lbl">{day}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Stats({ permissions }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const canSeeFinance = !!permissions.viewFinance;

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await fetchStats(days));
    } catch (e) {
      setErr(e?.detail || "Statistiques indisponibles.");
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { reload(); }, [reload]);

  const k = data?.kpis || {};
  const byCat = useMemo(() => {
    const m = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));
    return (data?.by_category || []).map((c) => ({ ...c, label: m[c.category] || c.category || "—" }));
  }, [data]);
  const maxCatCount = Math.max(1, ...byCat.map((c) => c.count || 0));

  const byStatus = useMemo(() => {
    const known = data?.by_status || [];
    return known.map((s) => ({ ...s, label: STATUS_LABEL[s.status] }));
  }, [data]);
  const maxStatus = Math.max(1, ...byStatus.map((s) => s.count || 0));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Statistiques du <em>laboratoire</em></h1>
          <p className="page-sub">
            Activité agrégée sur la fenêtre sélectionnée — volume, statuts,
            catégories, throughput technicien
            {canSeeFinance ? ", revenu et couverture CNAM" : ""}.
          </p>
        </div>
        <div className="page-actions">
          {!canSeeFinance && <PermRibbon>Vue activité (sans finance)</PermRibbon>}
          <div className="segmented">
            {PERIODS.map((p) => (
              <button key={p.id} className={days === p.id ? "active" : ""} onClick={() => setDays(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="auth-error" style={{ marginBottom: 14 }}>{err}</div>}

      <div className="grid-4" style={{ marginBottom: 22 }}>
        <div className="kpi feature">
          <span className="kpi-label">Ordres total</span>
          <div className="kpi-val">{loading ? "—" : (k.total_orders ?? 0)}<span className="unit">ordres</span></div>
          <span className="kpi-delta">
            {k.all_time_total ? `${k.all_time_total} historique` : "—"}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Validés</span>
          <div className="kpi-val">{loading ? "—" : (k.validated_orders ?? 0)}<span className="unit">tests</span></div>
          <span className="kpi-delta">
            {k.completed_orders ? `${k.completed_orders} en attente de validation` : "tout traité"}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Délai moyen</span>
          <div className="kpi-val">
            {loading ? "—" : (k.avg_tat_hours ?? "—")}
            <span className="unit">h</span>
          </div>
          <span className="kpi-delta">technicien → biologiste</span>
        </div>
        {canSeeFinance ? (
          <div className="kpi">
            <span className="kpi-label">Revenu facturable</span>
            <div className="kpi-val">
              {loading ? "—" : Math.round((k.revenue_mru || 0) / 1000)}
              <span className="unit">k MRU</span>
            </div>
            <span className="kpi-delta">
              CNAM {Math.round((k.cnam_share_mru || 0) / 1000)}k · patient {Math.round((k.patient_share_mru || 0) / 1000)}k
            </span>
          </div>
        ) : (
          <div className="kpi">
            <span className="kpi-label">Rejets</span>
            <div className="kpi-val">{loading ? "—" : (k.rejected_orders ?? 0)}<span className="unit">tests</span></div>
            <span className="kpi-delta">échantillons écartés</span>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Volume d'analyses</h3>
              <div className="sub">Ordres par jour sur la fenêtre · barres pleines = total, info-bulle = validés</div>
            </div>
            <I.Sparkle size={16} style={{ color: "var(--o)" }} />
          </div>
          <div className="card-pad" style={{ paddingTop: 28, paddingBottom: 36 }}>
            {loading && <div className="empty"><span className="spinner" /> Calcul…</div>}
            {!loading && (data?.by_day?.length ? <DayBars rows={data.by_day} /> : <div className="empty">Aucune activité sur la fenêtre.</div>)}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Répartition par statut</h3>
              <div className="sub">Sur la fenêtre sélectionnée</div>
            </div>
          </div>
          <div style={{ padding: "12px 22px 22px" }}>
            {loading && <div className="empty"><span className="spinner" /> Calcul…</div>}
            {!loading && byStatus.length === 0 && <div className="empty">Pas de données.</div>}
            {!loading && byStatus.map((s) => (
              <div key={s.status} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12.5 }}>
                  <span style={{ color: "var(--ink-2)" }}>{s.label?.label || s.status}</span>
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{s.count}</span>
                </div>
                <HBar value={s.count} max={maxStatus} color={s.label?.color} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Par catégorie d'échantillon</h3>
              <div className="sub">Volume {canSeeFinance && "et revenu validé"} sur la fenêtre</div>
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th className="num">Ordres</th>
                {canSeeFinance && <th className="num">Revenu</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (<tr><td colSpan={canSeeFinance ? 3 : 2} className="empty"><span className="spinner" /> Calcul…</td></tr>)}
              {!loading && byCat.length === 0 && (<tr><td colSpan={canSeeFinance ? 3 : 2} className="empty">Aucune activité.</td></tr>)}
              {!loading && byCat.map((c) => (
                <tr key={c.category || "none"}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <CatBadge catId={c.category || "other"} withDot={false} />
                      <span style={{ fontWeight: 500 }}>{c.label}</span>
                    </div>
                    <div style={{ marginTop: 6, width: 200 }}>
                      <HBar value={c.count || 0} max={maxCatCount} />
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{c.count || 0}</td>
                  {canSeeFinance && (
                    <td className="num" style={{ color: "var(--ink-2)" }}>
                      {c.revenue_mru ? CURRENCY.format(c.revenue_mru) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Throughput technicien</h3>
              <div className="sub">Ordres saisis ou validés par personne sur la fenêtre</div>
            </div>
          </div>
          <div style={{ padding: "8px 0" }}>
            {loading && <div className="empty"><span className="spinner" /> Calcul…</div>}
            {!loading && (data?.by_technician || []).length === 0 && <div className="empty">Aucune activité sur la fenêtre.</div>}
            {!loading && (data?.by_technician || []).map((t) => (
              <div key={t.uuid} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px" }}>
                <div className={`avatar ${avatarClassFor(t.uuid)}`}>{initials(t.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{t.results_entered} ordre{t.results_entered > 1 ? "s" : ""}</div>
                </div>
                <span className="badge"><span className="dot" />{t.results_entered}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(data?.low_stock_items || []).length > 0 && (
        <div className="card" style={{ borderColor: "var(--amber)" }}>
          <div className="card-head">
            <div>
              <h3>Stock bas</h3>
              <div className="sub">Réactifs / consommables sous le seuil d'alerte</div>
            </div>
            <span className="badge amber">
              <span className="dot" />{data.low_stock_items.length} item{data.low_stock_items.length > 1 ? "s" : ""}
            </span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Article</th>
                <th className="num">Stock</th>
                <th className="num">Seuil</th>
                <th>Unité</th>
              </tr>
            </thead>
            <tbody>
              {data.low_stock_items.map((it) => (
                <tr key={it.uuid}>
                  <td style={{ fontWeight: 500 }}>{it.name}</td>
                  <td className="num" style={{ color: "var(--rose)", fontWeight: 600 }}>{it.current_stock}</td>
                  <td className="num" style={{ color: "var(--ink-3)" }}>{it.min_stock}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{it.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
