import { useMemo, useState } from "react";
import { I } from "../icons";
import Modal from "./Modal";
import { CatBadge } from "./Misc";
import { changeApptStatus } from "../api";
import { CURRENCY, initials, avatarClassFor } from "../constants";

// ──────────────────────────────────────────────────────────────────────────
// Lifecycle d'un RDV — source de vérité visuelle pour la timeline.
// On garde les mêmes IDs que le backend (AppointmentStatus) :
//   pending → confirmed → checked_in → in_progress → completed
//             ↘ cancelled / no_show (terminaux)
//
// L'ordre dans le tableau STEPS définit la timeline visible. Les statuts
// terminaux (cancelled / no_show) ne sont pas dans STEPS : on les
// affiche séparément en badge si on tombe dessus.
// ──────────────────────────────────────────────────────────────────────────

const STEPS = [
  { id: "pending",     label: "Demandé",     desc: "Le patient a pris RDV. Validez le créneau." },
  { id: "confirmed",   label: "Confirmé",    desc: "Créneau validé. En attente de l'arrivée." },
  { id: "checked_in",  label: "Patient arrivé", desc: "Le patient est au labo, prêt à être prélevé." },
  { id: "in_progress", label: "Prélèvement", desc: "Échantillon réceptionné — analyses lancées." },
  { id: "completed",   label: "Terminé",     desc: "Visite clôturée. Les résultats suivent leur cycle." },
];

const TERMINAL = {
  cancelled: { label: "Annulé",  cls: "rose",  desc: "Ce rendez-vous a été annulé." },
  no_show:   { label: "Absent",  cls: "rose",  desc: "Le patient ne s'est pas présenté." },
};

// Pour chaque étape, on liste les transitions valides depuis cette étape.
// On reste tolérant : un staff peut sauter checked_in et passer direct
// à in_progress si le prélèvement a déjà été fait (rare mais possible).
const TRANSITIONS = {
  pending:     [
    { to: "confirmed",   label: "Confirmer le RDV",   variant: "primary" },
    { to: "cancelled",   label: "Annuler",            variant: "ghost"   },
  ],
  confirmed:   [
    { to: "checked_in",  label: "Patient arrivé",     variant: "primary" },
    { to: "in_progress", label: "Démarrer prélèvement", variant: "secondary" },
    { to: "no_show",     label: "Patient absent",     variant: "ghost"   },
    { to: "cancelled",   label: "Annuler",            variant: "ghost"   },
  ],
  checked_in:  [
    { to: "in_progress", label: "Démarrer prélèvement", variant: "primary" },
    { to: "cancelled",   label: "Annuler",            variant: "ghost"   },
  ],
  in_progress: [
    { to: "completed",   label: "Clôturer la visite", variant: "primary" },
  ],
  completed:   [],
  cancelled:   [],
  no_show:     [],
};

const VISIT_LABEL = {
  in_lab: "Au laboratoire",
  home: "À domicile",
  emergency: "Urgence",
};

const ORDER_STATUS = {
  pending:     { label: "En attente",  cls: ""      },
  in_progress: { label: "En cours",    cls: "amber" },
  completed:   { label: "À valider",   cls: "blue"  },
  validated:   { label: "Validé",      cls: "green" },
  rejected:    { label: "Rejeté",      cls: "rose"  },
};

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      weekday: "short", day: "2-digit", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

/**
 * Modal de gestion d'un rendez-vous.
 *
 * Props :
 *   appt            — objet RDV complet (AppointmentSerializer côté backend).
 *                     Doit contenir : status, scheduled_for, visit_type,
 *                     patient_name/phone, items[], items_total_mru,
 *                     patient_due_mru, cnam_covered_mru, home_address.
 *   permissions     — `permissions` calculé via permissionsFor(roles).
 *                     L'avancement RDV est gated sur `createSample`
 *                     (secrétaire/nurse/chef/tech — même critère que
 *                     pour réceptionner un échantillon).
 *   onClose()       — ferme le modal.
 *   onUpdated(appt) — appelé avec le RDV mis à jour après changement
 *                     de statut. Le parent peut rafraîchir sa liste.
 *
 * UX : timeline horizontale en haut (étape courante mise en valeur),
 * détail patient / RDV / lignes de tests / totaux ensuite, et en bas
 * les actions de transition autorisées depuis le statut actuel.
 */
export default function AppointmentDetailModal({
  appt: initialAppt, permissions, onClose, onUpdated,
}) {
  const [appt, setAppt] = useState(initialAppt);
  const [saving, setSaving] = useState(null);  // status en cours de POST
  const [err, setErr] = useState(null);

  // Le staff non-2FA n'a même pas atteint ce modal (la sidebar et l'API
  // sont déjà gated). On reste défensif : on désactive si on n'a pas
  // au moins la permission `createSample` (secrétaire/nurse/chef/tech).
  const canAct = !!permissions?.createSample;

  const stepIndex = STEPS.findIndex((s) => s.id === appt.status);
  const isTerminal = !!TERMINAL[appt.status];
  const transitions = TRANSITIONS[appt.status] || [];

  const totalDue = Number(appt.patient_due_mru || 0);
  const totalCnam = Number(appt.cnam_covered_mru || 0);
  const totalItems = Number(appt.items_total_mru || 0);

  const items = useMemo(() => appt.items || [], [appt.items]);

  const submit = async (newStatus) => {
    setErr(null);
    setSaving(newStatus);
    try {
      const updated = await changeApptStatus(appt.uuid, newStatus);
      setAppt(updated);
      onUpdated?.(updated);
    } catch (e) {
      setErr(e?.detail || "Transition refusée par le serveur.");
    } finally { setSaving(null); }
  };

  return (
    <Modal
      wide
      title={<>Rendez-vous <em>{appt.patient_name || appt.patient_phone || "—"}</em></>}
      subtitle={`${VISIT_LABEL[appt.visit_type] || appt.visit_type} · ${fmtWhen(appt.scheduled_for)}`}
      onClose={onClose}
      footer={
        <>
          <div className="hint">
            {!canAct
              ? "Vous n'avez pas la permission d'avancer ce rendez-vous."
              : isTerminal
                ? "Rendez-vous clos — plus de transitions possibles."
                : appt.status === "completed"
                  ? "Visite clôturée — les analyses suivent leur propre cycle dans l'onglet Analyses."
                  : "Cliquez sur la prochaine étape pour avancer le rendez-vous."}
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
            {canAct && transitions.map((t) => (
              <button
                key={t.to}
                className={
                  t.variant === "primary"   ? "btn btn-orange" :
                  t.variant === "secondary" ? "btn btn-secondary" :
                                              "btn btn-ghost"
                }
                onClick={() => submit(t.to)}
                disabled={!!saving}
              >
                {saving === t.to && <span className="spinner" />}
                {t.label}
              </button>
            ))}
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        {isTerminal ? (
          <div style={{
            padding: 14, background: "var(--bg)", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span className={`badge ${TERMINAL[appt.status].cls}`}>
              <span className="dot" />{TERMINAL[appt.status].label}
            </span>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {TERMINAL[appt.status].desc}
            </span>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`,
            gap: 6, padding: 14, background: "var(--bg)", borderRadius: 10,
          }}>
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const here = i === stepIndex;
              return (
                <div key={s.id} style={{ textAlign: "center" }}>
                  <div style={{
                    height: 6, borderRadius: 999,
                    background: done ? "var(--o-deep)" : here ? "var(--o)" : "var(--line-2)",
                    marginBottom: 8,
                  }} />
                  <div style={{
                    fontSize: 11.5, fontWeight: here ? 700 : 600,
                    color: here ? "var(--o-deep)" : done ? "var(--ink-1)" : "var(--ink-3)",
                  }}>
                    {s.label}
                  </div>
                </div>
              );
            })}
            {stepIndex >= 0 && (
              <div style={{
                gridColumn: `1 / -1`,
                fontSize: 12, color: "var(--ink-2)", marginTop: 4, textAlign: "center",
              }}>
                {STEPS[stepIndex].desc}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Patient + RDV ────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
        marginBottom: 18,
      }}>
        <div className="card" style={{ background: "var(--bg)", padding: 14 }}>
          <div className="kpi-label" style={{ marginBottom: 8 }}>Patient</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className={`avatar lg ${avatarClassFor(appt.patient_uuid)}`}>
              {initials(appt.patient_name || appt.patient_phone)}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{appt.patient_name || "—"}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                {appt.patient_phone || "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ background: "var(--bg)", padding: 14 }}>
          <div className="kpi-label" style={{ marginBottom: 8 }}>Rendez-vous</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <I.Calendar size={14} sw={1.8} style={{ color: "var(--ink-3)" }} />
            <span style={{ fontSize: 13 }}>{fmtWhen(appt.scheduled_for)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <I.Building size={14} sw={1.8} style={{ color: "var(--ink-3)" }} />
            <span style={{ fontSize: 13 }}>
              {VISIT_LABEL[appt.visit_type] || appt.visit_type}
              {appt.home_address ? ` · ${appt.home_address}` : ""}
            </span>
          </div>
          {appt.nurse_name && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <I.Users size={14} sw={1.8} style={{ color: "var(--ink-3)" }} />
              <span style={{ fontSize: 13 }}>Infirmier·e : {appt.nurse_name}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Tests demandés ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 14 }}>
        <div className="kpi-label" style={{ marginBottom: 8 }}>
          Tests demandés · {items.length}
        </div>
        {items.length === 0 ? (
          <div className="empty" style={{
            padding: 18, background: "var(--bg)", borderRadius: 10,
          }}>
            Aucun test rattaché à ce RDV. (RDV créé avant le câblage Sample+Orders.)
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="tbl" style={{ margin: 0 }}>
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
                {items.map((it, i) => {
                  const st = ORDER_STATUS[it.status] || { label: it.status, cls: "" };
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13 }}>
                          {it.test_code}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                          {it.test_name}
                        </div>
                      </td>
                      <td><CatBadge catId={it.sample_type || "blood"} withDot={false} /></td>
                      <td className="num">{CURRENCY.format(it.price_mru)}</td>
                      <td className="num" style={{ color: "var(--ink-3)" }}>
                        {Number(it.cnam_covered_mru) > 0 ? CURRENCY.format(it.cnam_covered_mru) : "—"}
                      </td>
                      <td className="num" style={{ fontWeight: 500 }}>
                        {CURRENCY.format(it.patient_due_mru)}
                      </td>
                      <td>
                        <span className={`badge ${st.cls}`}>
                          <span className="dot" />{st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Totaux ───────────────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14,
        padding: 14, background: "var(--bg)", borderRadius: 10,
      }}>
        <div>
          <div className="kpi-label">Sous-total tests</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 600, marginTop: 4 }}>
            {CURRENCY.format(totalItems)}
          </div>
        </div>
        <div>
          <div className="kpi-label">Pris en charge CNAM</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 600, marginTop: 4, color: "var(--ink-2)" }}>
            {CURRENCY.format(totalCnam)}
          </div>
        </div>
        <div>
          <div className="kpi-label">À charge patient</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, marginTop: 4, color: "var(--o-deep)" }}>
            {CURRENCY.format(totalDue)}
          </div>
        </div>
      </div>

      {appt.notes && (
        <div style={{
          marginTop: 14, padding: 12, background: "var(--bg)", borderRadius: 8,
          borderLeft: "3px solid var(--o)",
        }}>
          <div className="kpi-label" style={{ marginBottom: 4 }}>Notes</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{appt.notes}</div>
        </div>
      )}
    </Modal>
  );
}
