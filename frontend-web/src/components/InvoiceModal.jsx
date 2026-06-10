import { useEffect, useState } from "react";
import { I } from "../icons";
import Modal from "./Modal";
import { fetchInvoice } from "../api";
import { CURRENCY } from "../constants";

// Composant facture autonome — extrait de Analyses.jsx pour être
// réutilisable depuis le tab Finances du Dashboard. Il fetch la facture
// détaillée d'un RDV (`fetchInvoice(apptUuid)`) : lignes par test, split
// CNAM / patient, totaux. Bouton « Imprimer » → fenêtre d'impression
// navigateur (le rendu modal sert de mise en page).
//
// Props :
//   apptUuid — uuid du rendez-vous à facturer.
//   onClose() — ferme le modal.

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("fr-FR", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function StatusBadge({ status }) {
  if (status === "validated")  return <span className="badge green"><span className="dot" />Validé</span>;
  if (status === "completed")  return <span className="badge amber"><span className="dot" />À valider</span>;
  if (status === "in_progress")return <span className="badge blue"><span className="dot" />En cours</span>;
  if (status === "rejected")   return <span className="badge rose"><span className="dot" />Rejeté</span>;
  return <span className="badge"><span className="dot" />En attente</span>;
}

export default function InvoiceModal({ apptUuid, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inv = await fetchInvoice(apptUuid);
        if (!cancelled) setData(inv);
      } catch (e) {
        if (!cancelled) setErr(e?.detail || "Facture indisponible.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [apptUuid]);

  return (
    <Modal
      wide
      title={<>Facture du <em>rendez-vous</em></>}
      subtitle={data ? `${data.laboratory?.name || "—"} · ${data.patient?.name || "—"}` : "Chargement…"}
      onClose={onClose}
      footer={
        <>
          <div className="hint">
            {data?.patient?.cnam_coverage_pct
              ? `Patient couvert CNAM à ${data.patient.cnam_coverage_pct}%.`
              : "Pas de couverture CNAM enregistrée pour ce patient."}
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
            <button className="btn btn-orange" onClick={() => window.print()} disabled={!data}>
              <I.Export size={14} sw={1.8} /> Imprimer
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading && <div className="empty"><span className="spinner" /> Chargement de la facture…</div>}
      {!loading && data && (
        <>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
            padding: 14, background: "var(--bg)", borderRadius: 10, marginBottom: 14,
          }}>
            <div>
              <div className="kpi-label">Patient</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>{data.patient.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                {data.patient.phone}
              </div>
              {data.patient.cnam_number && (
                <div style={{ marginTop: 6, fontSize: 12 }}>
                  CNAM <span style={{ fontFamily: "var(--mono)" }}>{data.patient.cnam_number}</span>
                  {" "}· couverture <strong>{data.patient.cnam_coverage_pct}%</strong>
                </div>
              )}
            </div>
            <div>
              <div className="kpi-label">Rendez-vous</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{fmtDateTime(data.scheduled_for)}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{data.visit_type === "in_lab" ? "Au comptoir" : "Visite à domicile"}</div>
            </div>
          </div>

          <table className="tbl" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>Test</th>
                <th>Échantillon</th>
                <th className="num">Prix</th>
                <th className="num">CNAM</th>
                <th className="num">Patient</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr><td colSpan={6} className="empty">Aucun test sur ce RDV.</td></tr>
              )}
              {data.items.map((it) => (
                <tr key={it.order_uuid}>
                  <td>
                    <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13 }}>{it.test_code}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{it.test_name}</div>
                  </td>
                  <td className="num" style={{ color: "var(--ink-3)", fontSize: 12 }}>{it.sample_barcode}</td>
                  <td className="num">{CURRENCY.format(it.price_mru)}</td>
                  <td className="num" style={{ color: "var(--ink-3)" }}>
                    {it.cnam_covered_mru > 0 ? CURRENCY.format(it.cnam_covered_mru) : "—"}
                  </td>
                  <td className="num" style={{ fontWeight: 500 }}>{CURRENCY.format(it.patient_due_mru || it.price_mru)}</td>
                  <td><StatusBadge status={it.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14,
            padding: 14, background: "var(--bg)", borderRadius: 10,
          }}>
            <div>
              <div className="kpi-label">Sous-total tests</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                {CURRENCY.format(data.subtotal_mru)}
              </div>
            </div>
            <div>
              <div className="kpi-label">Pris en charge CNAM</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600, marginTop: 4, color: "var(--ink-2)" }}>
                {CURRENCY.format(data.cnam_covered_total_mru)}
              </div>
            </div>
            <div>
              <div className="kpi-label">À charge patient</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, marginTop: 4, color: "var(--o-deep)" }}>
                {CURRENCY.format(data.patient_due_total_mru)}
              </div>
              {data.appointment_fees_mru > 0 && (
                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  dont {CURRENCY.format(data.appointment_fees_mru)} de frais RDV
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
