import { useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { CatBadge, PermRibbon } from "../components/Misc";
import Modal from "../components/Modal";
import Switch from "../components/Switch";
import {
  fetchCatalog, createTest, updateTest, deleteTest,
} from "../api";
import { CATEGORIES, TAT_OPTIONS, CURRENCY, TEST_PRESETS } from "../constants";

const EMPTY_TEST = {
  code: "", name: "", sample_type: "blood",
  price_mru: 0, turnaround_hours: 24,
  description: "", requires_fasting: false, is_active: true,
  prerequisite_questions: [],
};

function PresetPicker({ existingCodes, onPick }) {
  const [query, setQuery] = useState("");
  const filtered = TEST_PRESETS
    .filter((p) => !existingCodes.has(p.code))
    .filter((p) => !query || `${p.code} ${p.name}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  if (filtered.length === 0 && !query) return null;

  return (
    <div className="card" style={{ background: "var(--o-glow)", borderColor: "var(--o-tint)", padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <I.Sparkle size={14} style={{ color: "var(--o)" }} />
        <strong style={{ fontSize: 13 }}>Suggestions courantes</strong>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>cliquez pour pré-remplir</span>
        <div className="search" style={{ marginLeft: "auto" }}>
          <I.Search size={13} />
          <input
            placeholder="Filtrer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 160, padding: "5px 10px 5px 30px", fontSize: 12 }}
          />
        </div>
      </div>
      <div className="chips">
        {filtered.map((p) => (
          <button key={p.code} type="button" className="chip" onClick={() => onPick(p)}>
            <strong style={{ fontFamily: "var(--mono)" }}>{p.code}</strong> · {p.name.split(" ").slice(0, 3).join(" ")}…
          </button>
        ))}
        {filtered.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Aucune suggestion ne correspond.</span>
        )}
      </div>
    </div>
  );
}

function TestModal({ initial, existingCodes, onClose, onSave, saving }) {
  const isEdit = !!initial?.uuid;
  const [form, setForm] = useState(initial || EMPTY_TEST);
  const [err, setErr] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (!form.code.trim() || !form.name.trim()) {
      setErr("Code et nom sont requis.");
      return;
    }
    try {
      await onSave(form);
    } catch (e) {
      setErr(e.detail || "Erreur lors de l'enregistrement.");
    }
  };

  const applyPreset = (p) => setForm({ ...EMPTY_TEST, ...p, is_active: true });

  return (
    <Modal
      wide
      title={isEdit ? <>Modifier <em>{initial.code}</em></> : <>Nouveau <em>test</em></>}
      subtitle={isEdit
        ? "Mettez à jour les détails du test et sa tarification"
        : "Ajoutez un nouveau test au catalogue du laboratoire"}
      onClose={onClose}
      footer={
        <>
          <div className="hint">Tous les champs marqués sont obligatoires</div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              {isEdit ? "Enregistrer" : "Créer le test"}
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      {!isEdit && <PresetPicker existingCodes={existingCodes} onPick={applyPreset} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Code</label>
          <input className="input" placeholder="TSH"
            value={form.code}
            onChange={(e) => set("code", e.target.value.toUpperCase())}
            style={{ fontFamily: "var(--mono)" }} />
          <span className="hint">3-6 caractères, unique</span>
        </div>
        <div className="field">
          <label>Nom complet du test</label>
          <input className="input" placeholder="Thyréostimuline"
            value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Type d'échantillon</label>
          <select className="select"
            value={form.sample_type}
            onChange={(e) => set("sample_type", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Description (facultatif)</label>
          <input className="input" placeholder="Détails ou consignes…"
            value={form.description}
            onChange={(e) => set("description", e.target.value)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Tarif</label>
          <div className="input-prefix">
            <span className="pfx">{CURRENCY.symbol}</span>
            <input className="input" type="number" min="0" step="50"
              value={form.price_mru}
              onChange={(e) => set("price_mru", Number(e.target.value))} />
          </div>
          <span className="hint">Tarif conventionnel, hors complémentaires</span>
        </div>
        <div className="field">
          <label>Délai de rendu</label>
          <select className="select"
            value={form.turnaround_hours}
            onChange={(e) => set("turnaround_hours", Number(e.target.value))}>
            {TAT_OPTIONS.map((h) => <option key={h} value={h}>{h}h</option>)}
          </select>
        </div>
      </div>

      <div style={{ background: "var(--bg)", padding: 16, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 2 }}>Test actif au catalogue</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Les tests inactifs ne peuvent pas être commandés mais restent dans l'historique
          </div>
        </div>
        <Switch on={form.is_active} onChange={(v) => set("is_active", v)} />
      </div>

      <div style={{ background: "var(--bg)", padding: 16, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 500, fontSize: 13.5, marginBottom: 2 }}>Patient à jeun requis</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            Affiche une consigne au patient au moment de la prise de rendez-vous
          </div>
        </div>
        <Switch on={form.requires_fasting} onChange={(v) => set("requires_fasting", v)} />
      </div>

      {/* Questionnaire pré-test — une question par ligne, stocké en JSON
          côté backend mais éditable comme texte libre côté chef de labo. */}
      <div className="field">
        <label>Questionnaire pré-test (facultatif)</label>
        <textarea className="textarea" rows={4}
          placeholder="Une question par ligne — ex :&#10;Patient à jeun (≥ 8h) ?&#10;Allergies médicamenteuses connues ?&#10;Médicaments en cours"
          value={(form.prerequisite_questions || []).join("\n")}
          onChange={(e) => set(
            "prerequisite_questions",
            e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
          )} />
        <span className="hint">
          Posées au comptoir avant le prélèvement. Les réponses sont attachées à l'ordre et visibles par le biologiste.
        </span>
      </div>
    </Modal>
  );
}

export default function Tests({ permissions }) {
  const canEdit = permissions.editTests;
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await fetchCatalog());
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => items.filter((t) => {
    if (filter !== "all" && t.sample_type !== filter) return false;
    if (query && !`${t.code} ${t.name}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [items, filter, query]);

  const avg = items.length ? Math.round(items.reduce((a, t) => a + Number(t.price_mru || 0), 0) / items.length) : 0;
  const existingCodes = useMemo(() => new Set(items.map((t) => t.code)), [items]);

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing) await updateTest(editing.uuid, form);
      else await createTest(form);
      await reload();
      setEditing(null); setAdding(false);
    } finally { setSaving(false); }
  };

  const onDelete = async (uuid) => {
    if (!confirm("Supprimer ce test du catalogue ?")) return;
    await deleteTest(uuid);
    setItems((arr) => arr.filter((x) => x.uuid !== uuid));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Catalogue de <em>tests</em></h1>
          <p className="page-sub">
            {items.length} test{items.length > 1 ? "s" : ""} configuré{items.length > 1 ? "s" : ""}
            {items.length > 0 && <> · prix moyen {CURRENCY.format(avg)}</>} · gérez votre offre d'analyses et la tarification associée.
          </p>
        </div>
        <div className="page-actions">
          {!canEdit && <PermRibbon>Lecture seule</PermRibbon>}
          <button className="btn btn-secondary"><I.Export size={14} sw={1.8} /> Exporter</button>
          {canEdit && (
            <button className="btn btn-orange" onClick={() => setAdding(true)}>
              <I.Plus size={14} sw={2} /> Ajouter un test
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, flexWrap: "wrap" }}>
          <div className="search" style={{ flex: 1, minWidth: 220 }}>
            <I.Search size={15} />
            <input
              placeholder="Filtrer par code ou nom…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div className="segmented">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Tous</button>
            {CATEGORIES.map((c) => (
              <button key={c.id} className={filter === c.id ? "active" : ""} onClick={() => setFilter(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Code</th>
              <th>Nom du test</th>
              <th>Échantillon</th>
              <th>Délai</th>
              <th style={{ textAlign: "right" }}>Tarif</th>
              <th>État</th>
              {canEdit && <th style={{ width: 80 }}></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canEdit ? 7 : 6} className="empty"><span className="spinner" /> Chargement…</td></tr>
            )}
            {!loading && filtered.map((t) => (
              <tr key={t.uuid}>
                <td className="num" style={{ fontWeight: 600 }}>{t.code}</td>
                <td>{t.name}</td>
                <td><CatBadge catId={t.sample_type} /></td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-2)" }}>
                    <I.Clock size={12} sw={1.8} />
                    <span className="num">{t.turnaround_hours}h</span>
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <span className="price-pill">{CURRENCY.format(t.price_mru)}</span>
                </td>
                <td>
                  {t.is_active
                    ? <span className="badge green"><span className="dot" />actif</span>
                    : <span className="badge"><span className="dot" />inactif</span>}
                </td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button className="row-act-btn" title="Modifier" onClick={() => setEditing(t)}><I.Edit /></button>
                      <button className="row-act-btn danger" title="Supprimer" onClick={() => onDelete(t.uuid)}><I.Trash /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="empty">Aucun test ne correspond aux filtres.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <TestModal
          initial={editing}
          existingCodes={existingCodes}
          saving={saving}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={onSave}
        />
      )}
    </div>
  );
}
