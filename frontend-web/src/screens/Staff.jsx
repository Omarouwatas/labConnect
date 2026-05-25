import { useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
import Modal from "../components/Modal";
import Switch from "../components/Switch";
import {
  fetchEmployees, inviteEmployee, updateEmployee, deactivateEmployee,
} from "../api";
import {
  ASSIGNABLE_ROLES, ROLES, ROLE_LABELS, ROLE_AVATARS, initials, avatarClassFor,
} from "../constants";

const EMPTY = {
  email: "", phone: "", first_name: "", last_name: "",
  roles: ["technician"], employee_id: "", license_number: "", password: "",
};

function StaffModal({ initial, onClose, onSave, saving }) {
  const isEdit = !!initial?.uuid;
  const [form, setForm] = useState(() => {
    if (initial) {
      return {
        ...EMPTY,
        ...initial,
        roles: (initial.roles || []).filter((r) => ASSIGNABLE_ROLES.includes(r)),
      };
    }
    return EMPTY;
  });
  const [err, setErr] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleRole = (r) => {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));
  };

  const submit = async () => {
    setErr(null);
    if (!isEdit && !form.email) return setErr("Email requis.");
    if (form.roles.length === 0) return setErr("Au moins un rôle est requis.");
    try {
      await onSave(form);
    } catch (e) {
      setErr(e.detail || "Impossible d'enregistrer.");
    }
  };

  return (
    <Modal
      wide
      title={isEdit ? <>Modifier <em>{form.first_name || "le membre"}</em></> : <>Inviter un <em>membre</em></>}
      subtitle={isEdit
        ? "Mettez à jour les rôles, identifiants et état de service."
        : "Créez un compte pour un membre de votre équipe. Plusieurs rôles peuvent être cumulés."}
      onClose={onClose}
      footer={
        <>
          <div className="hint">Les rôles peuvent être cumulés.</div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              {isEdit ? "Enregistrer" : "Inviter"}
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Prénom</label>
          <input className="input" value={form.first_name || ""} onChange={(e) => set("first_name", e.target.value)} />
        </div>
        <div className="field">
          <label>Nom</label>
          <input className="input" value={form.last_name || ""} onChange={(e) => set("last_name", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>E-mail professionnel</label>
          <input
            className="input"
            type="email"
            disabled={isEdit}
            value={form.email || ""}
            onChange={(e) => set("email", e.target.value)}
            placeholder="prenom.nom@labconnect.mr"
          />
        </div>
        <div className="field">
          <label>Téléphone (facultatif)</label>
          <input
            className="input"
            value={form.phone || ""}
            disabled={isEdit}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="+222 …"
            style={{ fontFamily: "var(--mono)" }}
          />
        </div>
      </div>

      {!isEdit && (
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Mot de passe provisoire (laisser vide pour générer)</label>
          <input
            className="input"
            type="text"
            value={form.password || ""}
            onChange={(e) => set("password", e.target.value)}
            placeholder="Auto-généré si vide"
          />
        </div>
      )}

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Rôles attribués</label>
        <div className="chips">
          {ASSIGNABLE_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip ${form.roles.includes(r) ? "on" : ""}`}
              onClick={() => toggleRole(r)}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        <span className="hint">Un membre peut cumuler plusieurs rôles (ex. biologiste + technicien).</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Matricule interne</label>
          <input className="input" value={form.employee_id || ""} onChange={(e) => set("employee_id", e.target.value)} />
        </div>
        <div className="field">
          <label>Numéro de licence (si applicable)</label>
          <input className="input" value={form.license_number || ""} onChange={(e) => set("license_number", e.target.value)} />
        </div>
      </div>

      {isEdit && (
        <div style={{ background: "var(--bg)", padding: 16, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 2 }}>En service actuellement</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Active la disponibilité pour les affectations et la file d'attente.
            </div>
          </div>
          <Switch on={!!form.is_on_duty} onChange={(v) => set("is_on_duty", v)} />
        </div>
      )}
    </Modal>
  );
}

export default function Staff({ permissions }) {
  const canEdit = permissions.editStaff;
  const [staff, setStaff] = useState([]);
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStaff(await fetchEmployees());
    } catch (e) {
      console.error("[Staff] fetchEmployees a échoué :", e);
      setLoadError(e?.detail || e?.message || "Impossible de charger l'équipe.");
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const roleCounts = useMemo(() => {
    const counts = { all: staff.length };
    for (const r of ASSIGNABLE_ROLES) counts[r] = 0;
    for (const s of staff) {
      for (const r of s.roles || []) {
        if (ASSIGNABLE_ROLES.includes(r)) counts[r] = (counts[r] || 0) + 1;
      }
    }
    return counts;
  }, [staff]);

  const filtered = filter === "all"
    ? staff
    : staff.filter((s) => (s.roles || []).includes(filter));

  const onDuty = staff.filter((s) => s.is_on_duty).length;

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing) {
        const patch = {
          first_name: form.first_name, last_name: form.last_name,
          employee_id: form.employee_id, license_number: form.license_number,
          is_on_duty: !!form.is_on_duty,
          roles: form.roles,
        };
        await updateEmployee(editing.uuid, patch);
      } else {
        await inviteEmployee({
          email: form.email,
          phone: form.phone || undefined,
          first_name: form.first_name,
          last_name: form.last_name,
          roles: form.roles,
          employee_id: form.employee_id || undefined,
          license_number: form.license_number || undefined,
          password: form.password || undefined,
        });
      }
      await reload();
      setEditing(null); setAdding(false);
    } finally { setSaving(false); }
  };

  const onDeactivate = async (uuid) => {
    if (!confirm("Désactiver ce membre ? Son compte sera bloqué.")) return;
    await deactivateEmployee(uuid);
    await reload();
  };

  const ROLE_TILES = [
    { role: "biologist",  desc: "Analyse & validation" },
    { role: "technician", desc: "Saisie des résultats" },
    { role: "nurse",      desc: "Prélèvement à domicile" },
    { role: "secretary",  desc: "Accueil & administratif" },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">L'équipe du <em>laboratoire</em></h1>
          <p className="page-sub">
            {staff.length} membre{staff.length > 1 ? "s" : ""} au total · {onDuty} en service maintenant · gérez les rôles, accès et plannings de votre équipe.
          </p>
        </div>
        <div className="page-actions">
          {!canEdit && <PermRibbon>Lecture seule</PermRibbon>}
          <button className="btn btn-secondary" onClick={reload} title="Rafraîchir">
            {loading ? <span className="spinner" /> : <I.Sparkle size={14} sw={1.8} />} Rafraîchir
          </button>
          {canEdit && (
            <button className="btn btn-orange" onClick={() => setAdding(true)}>
              <I.Plus size={14} sw={2} /> Inviter un membre
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="auth-error" style={{ marginBottom: 14 }}>
          ⚠️ {loadError}
        </div>
      )}

      <div className="grid-4" style={{ marginBottom: 22 }}>
        {ROLE_TILES.map((r) => (
          <button
            key={r.role}
            onClick={() => setFilter(filter === r.role ? "all" : r.role)}
            style={{
              border: filter === r.role ? "1px solid var(--o)" : "1px solid var(--line)",
              background: filter === r.role ? "var(--o-glow)" : "var(--surface)",
              borderRadius: "var(--radius)",
              padding: "16px 18px",
              cursor: "pointer",
              textAlign: "left",
              boxShadow: "var(--shadow-sm)",
              transition: "border-color 120ms, background 120ms",
              fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div className={`avatar ${ROLE_AVATARS[r.role]}`} style={{ width: 28, height: 28, fontSize: 11 }}>
                {ROLE_LABELS[r.role].split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <span className="kpi-label" style={{ padding: 0 }}>{ROLE_LABELS[r.role]}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 32, lineHeight: 1, letterSpacing: "-0.02em" }}>
                {roleCounts[r.role] || 0}
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.desc}</span>
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div className="segmented">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            Tous ({roleCounts.all})
          </button>
          {ASSIGNABLE_ROLES.map((r) => (
            <button key={r} className={filter === r ? "active" : ""} onClick={() => setFilter(r)}>
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", color: "var(--ink-3)", fontSize: 13 }}>
          {filtered.length} {filtered.length > 1 ? "membres" : "membre"}
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Membre</th>
              <th>Rôles</th>
              <th>Contact</th>
              <th>État</th>
              {canEdit && <th style={{ width: 80 }}></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canEdit ? 5 : 4} className="empty"><span className="spinner" /> Chargement…</td></tr>
            )}
            {!loading && filtered.map((s) => {
              const name = `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.email || s.phone;
              return (
                <tr key={s.uuid}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className={`avatar lg ${avatarClassFor(s.uuid)}`}>{initials(name)}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>{s.employee_id || s.uuid?.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(s.roles || []).filter((r) => ASSIGNABLE_ROLES.includes(r) || r === ROLES.LAB_CHIEF).map((r) => (
                        <span key={r} className={`badge ${r === ROLES.LAB_CHIEF ? "orange" : ""}`}>
                          <span className="dot" />{ROLE_LABELS[r] || r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-2)" }}>
                        <I.Mail size={12} sw={1.8} />{s.email || "—"}
                      </span>
                      {s.phone && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                          <I.Phone size={12} sw={1.8} />{s.phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {s.is_on_duty
                      ? <span className="badge green"><span className="dot" />en service</span>
                      : <span className="badge amber"><span className="dot" />hors service</span>}
                  </td>
                  {canEdit && (
                    <td>
                      <div className="row-actions">
                        <button className="row-act-btn" title="Modifier" onClick={() => setEditing(s)}><I.Edit /></button>
                        <button className="row-act-btn danger" title="Désactiver" onClick={() => onDeactivate(s.uuid)}><I.Trash /></button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 4} className="empty">Aucun membre dans ce filtre.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <StaffModal
          initial={editing}
          saving={saving}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={onSave}
        />
      )}
    </div>
  );
}
