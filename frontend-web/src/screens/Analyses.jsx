import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
import Modal from "../components/Modal";
import WalkInModal from "../components/WalkInModal";
import {
  fetchOrders, fetchOrderResult, enterResult, validateResult, fetchInvoice,
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

function ValidationModal({ order, onClose, onValidated, readOnly = false }) {
  const [result, setResult] = useState(null);
  // Valeurs éditables — initialisées une fois le résultat chargé. Le
  // biologiste peut corriger avant de valider ; le backend conserve la
  // valeur d'origine du technicien dans `original_value` si modifiée.
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [refRange, setRefRange] = useState("");
  const [flag, setFlag] = useState("normal");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchOrderResult(order.uuid);
        setResult(r);
        setValue(r.value || "");
        setUnit(r.unit || "");
        setRefRange(r.reference_range || "");
        setFlag(r.flag || "normal");
        setComment(r.biologist_comment || "");
      } catch (e) { setErr(e.detail || "Résultat introuvable."); }
      finally { setLoading(false); }
    })();
  }, [order.uuid]);

  // Indique si le biologiste a déjà touché à au moins un champ (par
  // rapport à ce qu'a saisi le technicien). Sert juste à l'avertir
  // visuellement qu'il y a correction.
  const edited = !!result && (
    value !== result.value || unit !== result.unit
    || refRange !== result.reference_range || flag !== result.flag
  );

  const submit = async () => {
    if (!value.trim()) return setErr("La valeur ne peut pas être vide.");
    setErr(null);
    setSaving(true);
    try {
      await validateResult(order.uuid, {
        biologist_comment: comment,
        value, unit, reference_range: refRange, flag,
      });
      onValidated();
    } catch (e) {
      setErr(e.detail || "Erreur lors de la validation.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={readOnly
        ? <>Résultat <em>{order.test_code}</em></>
        : <>Valider <em>{order.test_code}</em></>}
      subtitle={`${order.test_name} · ${order.patient_name}`}
      onClose={onClose}
      footer={
        <>
          <div className="hint">
            {readOnly
              ? "Lecture seule — résultat déjà validé et publié."
              : edited
                ? "Vous avez corrigé le résultat du technicien — la valeur d'origine sera archivée."
                : "La validation est définitive et signée par votre nom."}
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
            {!readOnly && (
              <button className="btn btn-orange" onClick={submit} disabled={saving || loading || !result}>
                {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
                Valider le résultat
              </button>
            )}
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
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
            padding: "8px 12px", background: "var(--bg)", borderRadius: 8,
            fontSize: 12, color: "var(--ink-2)",
          }}>
            <span style={{ color: "var(--o)" }}>•</span>
            Saisi par <strong>{result.technician_name || "—"}</strong> · {fmtDateTime(result.technician_signed_at)}
            {result.original_value && (
              <span style={{ marginLeft: "auto", color: "var(--ink-3)" }}>
                Valeur d'origine archivée : <span style={{ fontFamily: "var(--mono)" }}>{result.original_value}</span>
              </span>
            )}
          </div>

          {/* Contexte clinique : réponses au questionnaire pré-test
              snapshottées à la création de l'ordre. Affiché seulement
              s'il y a au moins une question dans le snapshot. */}
          {(order.prerequisite_questions_snapshot || []).length > 0 && (
            <div style={{
              padding: 12, background: "var(--bg)", borderRadius: 8,
              marginBottom: 14, borderLeft: "3px solid var(--o)",
            }}>
              <div className="kpi-label" style={{ marginBottom: 8 }}>Contexte clinique (questionnaire pré-test)</div>
              {order.prerequisite_questions_snapshot.map((q, i) => (
                <div key={i} style={{ marginBottom: 4, fontSize: 12.5 }}>
                  <span style={{ color: "var(--ink-3)" }}>{q}</span>
                  {" — "}
                  <strong style={{ color: "var(--ink-1)" }}>
                    {(order.prerequisite_answers || [])[i] || <em style={{ color: "var(--ink-3)", fontWeight: 400 }}>non renseigné</em>}
                  </strong>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label>Valeur mesurée *</label>
              <input className="input" value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={readOnly}
                style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600 }} />
            </div>
            <div className="field">
              <label>Unité</label>
              <input className="input" value={unit}
                onChange={(e) => setUnit(e.target.value)}
                disabled={readOnly}
                style={{ fontFamily: "var(--mono)" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label>Plage de référence</label>
              <input className="input" value={refRange}
                onChange={(e) => setRefRange(e.target.value)}
                disabled={readOnly} />
            </div>
            <div className="field">
              <label>Drapeau</label>
              <select className="select" value={flag}
                onChange={(e) => setFlag(e.target.value)}
                disabled={readOnly}>
                {Object.entries(FLAG_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          {result.technician_notes && (
            <div style={{ padding: 12, background: "var(--bg)", borderRadius: 8, marginBottom: 14 }}>
              <div className="kpi-label" style={{ marginBottom: 4 }}>Notes technicien</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{result.technician_notes}</div>
            </div>
          )}

          <div className="field">
            <label>Commentaire biologiste {readOnly ? "" : "(facultatif)"}</label>
            <textarea className="textarea"
              placeholder="Interprétation, recommandation au médecin traitant…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={readOnly} />
          </div>
        </>
      )}
    </Modal>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal — facture du rendez-vous
// ──────────────────────────────────────────────────────────────────────────

function InvoiceModal({ apptUuid, onClose }) {
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
  const [walkInOpen, setWalkInOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchOrders(`?status=${tab}`));
    } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { reload(); }, [reload]);

  const onWalkInCreated = useCallback((result) => {
    const newPatient = result?.patient_created ? " · nouveau patient enregistré" : "";
    // eslint-disable-next-line no-alert
    alert(`Analyse créée ✓ ${result?.tests_count || ""} test${(result?.tests_count || 0) > 1 ? "s" : ""}${newPatient}.`);
    // On bascule sur la file « À saisir » et on reload — le nouvel ordre
    // y apparaîtra (status = pending → in_progress après réception sample).
    if (tab !== "in_progress") setTab("in_progress");
    else reload();
  }, [tab, reload]);

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
          {permissions.createSample && (
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

      {walkInOpen && (
        <WalkInModal
          onClose={() => setWalkInOpen(false)}
          onCreated={onWalkInCreated}
        />
      )}

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
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }}
                          onClick={() => setActing({ mode: "view", order: o })}>
                          Voir
                        </button>
                        {permissions.viewFinance && o.appointment_uuid && (
                          <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }}
                            onClick={() => setActing({ mode: "invoice", order: o })}
                            title="Facture du rendez-vous (CNAM + à payer)">
                            Facture
                          </button>
                        )}
                      </div>
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
          readOnly={acting.mode === "view"}
          onClose={() => setActing(null)}
          onValidated={() => { setActing(null); reload(); }}
        />
      )}
      {acting?.mode === "invoice" && (
        <InvoiceModal
          apptUuid={acting.order.appointment_uuid}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}
