import { useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
import Modal from "../components/Modal";
import {
  fetchOrders, fetchOrderResult, enterResult, validateResult,
} from "../api";
import { CURRENCY, initials, avatarClassFor } from "../constants";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const FLAG_LABEL = {
  normal:   { label: "Normal",   color: "green"  },
  low:      { label: "Bas",      color: "blue"   },
  high:     { label: "Haut",     color: "amber"  },
  critical: { label: "Critique", color: "rose"   },
};

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

// ──────────────────────────────────────────────────────────────────────────
// Modal — saisie résultat (technicien)
// ──────────────────────────────────────────────────────────────────────────

const EMPTY_RESULT = {
  value: "", unit: "", reference_range: "", flag: "normal", technician_notes: "",
};

function ResultEntryModal({ order, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_RESULT);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (!form.value.trim()) return setErr("La valeur mesurée est requise.");
    setSaving(true);
    try {
      await enterResult(order.uuid, form);
      onSaved();
    } catch (e) {
      setErr(e.detail || "Erreur lors de l'enregistrement.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={<>Saisir le résultat <em>{order.test_code}</em></>}
      subtitle={`${order.test_name} · échantillon ${order.sample_barcode}`}
      onClose={onClose}
      footer={
        <>
          <div className="hint">L'ordre passera en « à valider » après la saisie.</div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              Enregistrer le résultat
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="card" style={{ background: "var(--bg)", padding: 14, marginBottom: 14, display: "flex", gap: 14, alignItems: "center" }}>
        <div className={`avatar lg ${avatarClassFor(order.uuid)}`}>{initials(order.patient_name)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 14 }}>{order.patient_name}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
            {order.sample_barcode} · démarré {fmtDateTime(order.started_at)}
          </div>
        </div>
        <span className="price-pill">{CURRENCY.format(order.price_mru)}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Valeur mesurée *</label>
          <input className="input" placeholder="2.3" value={form.value}
            onChange={(e) => set("value", e.target.value)}
            style={{ fontFamily: "var(--mono)" }} autoFocus />
        </div>
        <div className="field">
          <label>Unité</label>
          <input className="input" placeholder="mUI/L" value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
            style={{ fontFamily: "var(--mono)" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Plage de référence</label>
          <input className="input" placeholder="0.4 – 4.0" value={form.reference_range}
            onChange={(e) => set("reference_range", e.target.value)} />
        </div>
        <div className="field">
          <label>Drapeau</label>
          <select className="select" value={form.flag} onChange={(e) => set("flag", e.target.value)}>
            {Object.entries(FLAG_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Notes techniques (facultatif)</label>
        <textarea className="textarea"
          placeholder="Observations sur la qualité de l'échantillon, conditions de mesure…"
          value={form.technician_notes}
          onChange={(e) => set("technician_notes", e.target.value)} />
      </div>
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal — validation biologiste
// ──────────────────────────────────────────────────────────────────────────

function ValidationModal({ order, onClose, onValidated }) {
  const [result, setResult] = useState(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try { setResult(await fetchOrderResult(order.uuid)); }
      catch (e) { setErr(e.detail || "Résultat introuvable."); }
      finally { setLoading(false); }
    })();
  }, [order.uuid]);

  const submit = async () => {
    setErr(null);
    setSaving(true);
    try {
      await validateResult(order.uuid, { biologist_comment: comment });
      onValidated();
    } catch (e) {
      setErr(e.detail || "Erreur lors de la validation.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={<>Valider <em>{order.test_code}</em></>}
      subtitle={`${order.test_name} · ${order.patient_name}`}
      onClose={onClose}
      footer={
        <>
          <div className="hint">La validation est définitive et signée par votre nom.</div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving || loading || !result}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              Valider le résultat
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      {loading && (
        <div className="empty"><span className="spinner" /> Chargement du résultat…</div>
      )}

      {!loading && result && (
        <>
          <div className="card" style={{ background: "var(--bg)", padding: 14, marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <div>
                <div className="kpi-label">Valeur</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 600, marginTop: 4 }}>
                  {result.value} <span style={{ color: "var(--ink-3)", fontSize: 13, fontWeight: 400 }}>{result.unit}</span>
                </div>
              </div>
              <div>
                <div className="kpi-label">Référence</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 13, marginTop: 8, color: "var(--ink-2)" }}>
                  {result.reference_range || "—"}
                </div>
              </div>
              <div>
                <div className="kpi-label">Drapeau</div>
                <div style={{ marginTop: 8 }}>
                  <span className={`badge ${FLAG_LABEL[result.flag]?.color || ""}`}>
                    <span className="dot" /> {FLAG_LABEL[result.flag]?.label || result.flag}
                  </span>
                </div>
              </div>
            </div>
            {result.technician_notes && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                <div className="kpi-label" style={{ marginBottom: 4 }}>Notes technicien</div>
                <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{result.technician_notes}</div>
                <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--ink-3)" }}>
                  Saisi par <strong>{result.technician_name || "—"}</strong> · {fmtDateTime(result.technician_signed_at)}
                </div>
              </div>
            )}
          </div>

          <div className="field">
            <label>Commentaire biologiste (facultatif)</label>
            <textarea className="textarea"
              placeholder="Interprétation, recommandation au médecin traitant…"
              value={comment}
              onChange={(e) => setComment(e.target.value)} />
          </div>
        </>
      )}
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main screen
// ──────────────────────────────────────────────────────────────────────────

const TAB_DEFS = [
  { id: "in_progress", label: "À saisir",   needs: "enterResult" },
  { id: "completed",   label: "À valider",  needs: "validate"    },
  { id: "validated",   label: "Validés",    needs: null          },
  { id: "rejected",    label: "Rejetés",    needs: null          },
];

export default function Analyses({ permissions }) {
  // Choix du tab par défaut basé sur l'UNION des permissions cumulées :
  // - si l'user peut saisir ET valider, on l'oriente vers la file la plus
  //   prioritaire (validation) — il pourra basculer d'un clic.
  const defaultTab = permissions.validate ? "completed"
                   : permissions.enterResult ? "in_progress"
                   : "validated";

  const [tab, setTab] = useState(defaultTab);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [acting, setActing] = useState(null); // { mode: "enter"|"validate", order }

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await fetchOrders(`?status=${tab}`));
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [tab]);

  // Un tab actionnable n'est visible que si l'user a la permission.
  // Les tabs "validés"/"rejetés" (consultation) sont visibles à tout staff.
  const visibleTabs = TAB_DEFS.filter((t) => !t.needs || permissions[t.needs]);

  const filtered = useMemo(() => items.filter((o) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return [o.test_code, o.test_name, o.patient_name, o.sample_barcode]
      .filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
  }), [items, query]);

  const counts = useMemo(() => ({
    in_progress: items.filter((o) => o.status === "in_progress").length,
    completed:   items.filter((o) => o.status === "completed").length,
  }), [items]);

  const titleByTab = {
    in_progress: <>Ordres <em>à saisir</em></>,
    completed:   <>Résultats <em>à valider</em></>,
    validated:   <>Résultats <em>validés</em></>,
    rejected:    <>Échantillons <em>rejetés</em></>,
  };

  const subByTab = {
    in_progress: "Sélectionnez un ordre pour saisir la valeur mesurée. L'ordre passera ensuite en file d'attente du biologiste.",
    completed:   "Vérifiez les valeurs saisies par le technicien et signez la validation. Le résultat sera publié au patient.",
    validated:   "Historique des résultats signés et publiés. Aucune action — lecture seule.",
    rejected:    "Échantillons rejetés (qualité insuffisante, identification erronée, hémolyse…).",
  };

  const canActOn = (o) => {
    if (o.status === "in_progress" && permissions.enterResult) return "enter";
    if (o.status === "completed"  && permissions.validate)    return "validate";
    return null;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{titleByTab[tab]}</h1>
          <p className="page-sub">{subByTab[tab]}</p>
        </div>
        <div className="page-actions">
          {!permissions.enterResult && !permissions.validate && (
            <PermRibbon>Consultation seule</PermRibbon>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, flexWrap: "wrap" }}>
          <div className="segmented">
            {visibleTabs.map((t) => (
              <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
                {t.label}
                {counts[t.id] > 0 && t.id !== tab && (
                  <span style={{ marginLeft: 6, fontFamily: "var(--mono)", fontSize: 10, color: "var(--o-deep)" }}>
                    {counts[t.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="search" style={{ flex: 1, minWidth: 200 }}>
            <I.Search size={15} />
            <input
              placeholder="Patient, test, code-barre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Test</th>
              <th>Échantillon</th>
              <th>Statut</th>
              <th>Mis à jour</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="empty"><span className="spinner" /> Chargement…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="empty">
                {tab === "in_progress" && "Aucun ordre en attente de saisie. Bon travail 👏"}
                {tab === "completed"   && "Aucun résultat à valider pour le moment."}
                {tab === "validated"   && "Aucun résultat validé pour la période."}
                {tab === "rejected"    && "Aucun échantillon rejeté."}
              </td></tr>
            )}
            {!loading && filtered.map((o) => {
              const action = canActOn(o);
              return (
                <tr key={o.uuid}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div className={`avatar ${avatarClassFor(o.uuid)}`}>{initials(o.patient_name)}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{o.patient_name || "—"}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                          ordre {o.uuid?.slice(0, 8)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CatBadge catId="blood" withDot={false} />
                      <div>
                        <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13 }}>{o.test_code}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{o.test_name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num" style={{ color: "var(--ink-2)" }}>{o.sample_barcode || "—"}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    {fmtDateTime(o.completed_at || o.started_at || o.created_at)}
                  </td>
                  <td>
                    {action === "enter" && (
                      <button className="btn btn-orange" style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={() => setActing({ mode: "enter", order: o })}>
                        <I.Edit size={12} /> Saisir
                      </button>
                    )}
                    {action === "validate" && (
                      <button className="btn btn-orange" style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={() => setActing({ mode: "validate", order: o })}>
                        <I.Check size={12} sw={2} /> Valider
                      </button>
                    )}
                    {!action && o.status === "validated" && (
                      <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }}
                        onClick={() => setActing({ mode: "view", order: o })}>
                        Voir
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {acting?.mode === "enter" && (
        <ResultEntryModal
          order={acting.order}
          onClose={() => setActing(null)}
          onSaved={() => { setActing(null); reload(); }}
        />
      )}
      {(acting?.mode === "validate" || acting?.mode === "view") && (
        <ValidationModal
          order={acting.order}
          onClose={() => setActing(null)}
          onValidated={() => { setActing(null); reload(); }}
        />
      )}
    </div>
  );
}
