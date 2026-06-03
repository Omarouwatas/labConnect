import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import { PermRibbon } from "../components/Misc";
import Modal from "../components/Modal";
import {
  fetchInventory,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  postInventoryMove,
  fetchInventoryMoves,
} from "../api";
import { CURRENCY } from "../constants";

const CATEGORIES = [
  { id: "reagent",    label: "Réactif"       },
  { id: "consumable", label: "Consommable"   },
  { id: "equipment",  label: "Équipement"    },
  { id: "other",      label: "Autre"         },
];

const REASONS = [
  { id: "delivery",    label: "Livraison",            sign: "+" },
  { id: "consumption", label: "Consommation",         sign: "−" },
  { id: "adjustment",  label: "Ajustement inventaire",sign: "±" },
  { id: "expiry",      label: "Péremption / casse",   sign: "−" },
];

const EMPTY_ITEM = {
  name: "", code: "", category: "reagent", unit: "unité",
  min_stock: 0, unit_cost_mru: 0, supplier: "", notes: "",
  initial_stock: 0,
};

function ItemModal({ initial, onClose, onSave, saving }) {
  const isEdit = !!initial?.uuid;
  const [form, setForm] = useState(initial || EMPTY_ITEM);
  const [err, setErr] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr(null);
    if (!form.name.trim()) return setErr("Le nom est requis.");
    try { await onSave(form); }
    catch (e) { setErr(e?.detail || "Erreur lors de l'enregistrement."); }
  };

  return (
    <Modal
      wide
      title={isEdit ? <>Modifier <em>{initial.name}</em></> : <>Nouvel <em>article</em></>}
      subtitle={isEdit ? "Mettez à jour les caractéristiques de l'article" : "Ajoutez un article à l'inventaire du labo"}
      onClose={onClose}
      footer={
        <>
          <div className="hint">
            {isEdit
              ? "Le stock se modifie via Entrée / Sortie depuis la liste — pas ici."
              : "Le stock initial sera enregistré comme livraison."}
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              {isEdit ? "Enregistrer" : "Créer l'article"}
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Nom *</label>
          <input className="input" value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ex : Tubes EDTA 4mL" autoFocus />
        </div>
        <div className="field">
          <label>Référence</label>
          <input className="input" value={form.code || ""}
            onChange={(e) => set("code", e.target.value)}
            style={{ fontFamily: "var(--mono)" }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div className="field">
          <label>Catégorie</label>
          <select className="select" value={form.category}
            onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Unité</label>
          <input className="input" value={form.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="boîte, mL, tube…" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        {!isEdit && (
          <div className="field">
            <label>Stock initial</label>
            <input className="input" type="number" min={0} step="any"
              value={form.initial_stock || 0}
              onChange={(e) => set("initial_stock", Number(e.target.value))}
              style={{ fontFamily: "var(--mono)" }} />
          </div>
        )}
        <div className="field">
          <label>Seuil d'alerte</label>
          <input className="input" type="number" min={0} step="any"
            value={form.min_stock || 0}
            onChange={(e) => set("min_stock", Number(e.target.value))}
            style={{ fontFamily: "var(--mono)" }} />
          <span className="hint">0 = pas d'alerte de stock bas</span>
        </div>
        <div className="field">
          <label>Coût unitaire</label>
          <div className="input-prefix">
            <span className="pfx">{CURRENCY.symbol}</span>
            <input className="input" type="number" min={0} step="any"
              value={form.unit_cost_mru || 0}
              onChange={(e) => set("unit_cost_mru", Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label>Fournisseur (facultatif)</label>
        <input className="input" value={form.supplier || ""}
          onChange={(e) => set("supplier", e.target.value)}
          placeholder="ex : LaboFournitures SARL" />
      </div>
      <div className="field">
        <label>Notes (facultatif)</label>
        <textarea className="textarea" rows={2}
          value={form.notes || ""}
          onChange={(e) => set("notes", e.target.value)} />
      </div>
    </Modal>
  );
}

function MovementModal({ item, onClose, onPosted }) {
  const [reason, setReason] = useState("delivery");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState("act"); // act | history
  const [history, setHistory] = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // Charge l'historique du mouvement à la demande pour ne pas peser sur
  // la liste principale et garder la modale rapide à l'ouverture.
  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    setLoadingHist(true);
    (async () => {
      try {
        const rows = await fetchInventoryMoves(item.uuid);
        if (!cancelled) setHistory(rows);
      } finally { if (!cancelled) setLoadingHist(false); }
    })();
    return () => { cancelled = true; };
  }, [tab, item.uuid]);

  const submit = async () => {
    setErr(null);
    const n = Number(amount);
    if (!n) return setErr("Saisissez une quantité non nulle.");
    // On signe le delta côté front pour les raisons "négatives" — le
    // backend revérifie de toute façon.
    const reasonCfg = REASONS.find((r) => r.id === reason);
    let delta = Math.abs(n);
    if (reasonCfg?.sign === "−") delta = -delta;
    setSaving(true);
    try {
      const res = await postInventoryMove(item.uuid, {
        delta,
        reason,
        notes: notes.trim() || undefined,
      });
      onPosted(res?.item);
      onClose();
    } catch (e) {
      const raw = e?.raw;
      const fieldErrs = raw && typeof raw === "object" && !raw.error
        ? Object.entries(raw).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(" ") : v}`).join(" · ")
        : null;
      setErr(fieldErrs || e?.detail || "Erreur lors de l'enregistrement.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={<>Stock — <em>{item.name}</em></>}
      subtitle={`Stock actuel : ${item.current_stock} ${item.unit}`}
      onClose={onClose}
      footer={tab === "act" ? (
        <>
          <div className="hint">
            Le stock sera mis à jour atomiquement et tracé dans l'historique.
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              Enregistrer le mouvement
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="hint">{history.length} mouvement{history.length > 1 ? "s" : ""} récents</div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose}>Fermer</button>
          </div>
        </>
      )}
    >
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button className={tab === "act" ? "active" : ""} onClick={() => setTab("act")}>Nouveau mouvement</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Historique</button>
      </div>

      {tab === "act" && (
        <>
          {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Type de mouvement</label>
            <div className="chips">
              {REASONS.map((r) => (
                <button key={r.id} type="button"
                  className={`chip ${reason === r.id ? "active" : ""}`}
                  onClick={() => setReason(r.id)}>
                  <strong>{r.sign}</strong> {r.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 14 }}>
            <div className="field">
              <label>Quantité ({item.unit})</label>
              <input className="input" type="number" min={0} step="any"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="ex : 50"
                style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600 }}
                autoFocus />
              <span className="hint">
                {reason === "adjustment"
                  ? "Saisissez la valeur absolue, puis sélectionnez le sens via le type."
                  : "Toujours en valeur absolue — le signe vient du type choisi."}
              </span>
            </div>
            <div className="field">
              <label>Note (facultatif)</label>
              <input className="input" value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="N° BL, lot, motif d'ajustement…" />
            </div>
          </div>
        </>
      )}

      {tab === "history" && (
        <div>
          {loadingHist && <div className="empty"><span className="spinner" /> Chargement…</div>}
          {!loadingHist && history.length === 0 && <div className="empty">Aucun mouvement pour cet article.</div>}
          {!loadingHist && history.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="num">Quantité</th>
                  <th>Par</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m) => {
                  const cfg = REASONS.find((r) => r.id === m.reason);
                  return (
                    <tr key={m.uuid}>
                      <td style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        {new Date(m.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td>{cfg?.label || m.reason}</td>
                      <td className="num" style={{ fontWeight: 600, color: Number(m.delta) >= 0 ? "var(--green)" : "var(--rose)" }}>
                        {Number(m.delta) > 0 ? `+${m.delta}` : m.delta}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{m.by_name || "—"}</td>
                      <td style={{ fontSize: 12 }}>{m.notes || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Inventory({ permissions }) {
  const canEdit = !!permissions.editTests;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [moving, setMoving] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try { setItems(await fetchInventory()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => items.filter((it) => {
    if (filter !== "all" && it.category !== filter) return false;
    if (showLowOnly && !it.is_low_stock) return false;
    if (query && !`${it.name} ${it.code || ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [items, filter, showLowOnly, query]);

  const lowStockCount = items.filter((it) => it.is_low_stock).length;
  const totalValue = items.reduce(
    (acc, it) => acc + Number(it.current_stock || 0) * Number(it.unit_cost_mru || 0),
    0,
  );

  const onSave = async (form) => {
    setSaving(true);
    try {
      if (editing) {
        // PATCH n'envoie pas initial_stock — on l'ignore côté update.
        const { initial_stock, ...rest } = form; // eslint-disable-line no-unused-vars
        await updateInventoryItem(editing.uuid, rest);
      } else {
        await createInventoryItem(form);
      }
      await reload();
      setAdding(false); setEditing(null);
    } finally { setSaving(false); }
  };

  const onDelete = async (it) => {
    if (!confirm(`Supprimer "${it.name}" de l'inventaire ?`)) return;
    await deleteInventoryItem(it.uuid);
    setItems((arr) => arr.filter((x) => x.uuid !== it.uuid));
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventaire <em>du laboratoire</em></h1>
          <p className="page-sub">
            {items.length} article{items.length > 1 ? "s" : ""} suivi{items.length > 1 ? "s" : ""}
            {lowStockCount > 0 && <> · <strong style={{ color: "var(--rose)" }}>{lowStockCount} sous le seuil d'alerte</strong></>}
            {totalValue > 0 && <> · valeur estimée {CURRENCY.format(totalValue)}</>}
          </p>
        </div>
        <div className="page-actions">
          {!canEdit && <PermRibbon>Lecture seule</PermRibbon>}
          {canEdit && (
            <button className="btn btn-orange" onClick={() => setAdding(true)}>
              <I.Plus size={14} sw={2} /> Nouvel article
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, flexWrap: "wrap" }}>
          <div className="search" style={{ flex: 1, minWidth: 220 }}>
            <I.Search size={15} />
            <input placeholder="Filtrer par nom ou référence…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%" }} />
          </div>
          <div className="segmented">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Tous</button>
            {CATEGORIES.map((c) => (
              <button key={c.id} className={filter === c.id ? "active" : ""} onClick={() => setFilter(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <button className={`btn btn-ghost ${showLowOnly ? "active" : ""}`}
            onClick={() => setShowLowOnly((v) => !v)}
            style={{ padding: "8px 12px", fontSize: 12, borderStyle: "solid", borderWidth: 1, borderColor: showLowOnly ? "var(--rose)" : "var(--line)" }}>
            {showLowOnly ? "✓ " : ""}Stock bas seulement
          </button>
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Article</th>
              <th>Catégorie</th>
              <th className="num">Stock</th>
              <th className="num">Seuil</th>
              <th className="num">Valeur</th>
              <th>État</th>
              {canEdit && <th style={{ width: 200 }}></th>}
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={canEdit ? 7 : 6} className="empty"><span className="spinner" /> Chargement…</td></tr>)}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="empty">
                {items.length === 0 ? "Inventaire vide — ajoutez votre premier article." : "Aucun article ne correspond aux filtres."}
              </td></tr>
            )}
            {!loading && filtered.map((it) => {
              const value = Number(it.current_stock || 0) * Number(it.unit_cost_mru || 0);
              const catLabel = CATEGORIES.find((c) => c.id === it.category)?.label || it.category;
              return (
                <tr key={it.uuid}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{it.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
                      {it.code || `réf — ${it.uuid.slice(0, 8)}`}
                      {it.supplier && <> · {it.supplier}</>}
                    </div>
                  </td>
                  <td><span className="badge"><span className="dot" />{catLabel}</span></td>
                  <td className="num" style={{ fontWeight: 600, fontSize: 14 }}>
                    {Number(it.current_stock).toLocaleString("fr-FR")} <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: 12 }}>{it.unit}</span>
                  </td>
                  <td className="num" style={{ color: "var(--ink-3)" }}>
                    {it.min_stock > 0 ? Number(it.min_stock).toLocaleString("fr-FR") : "—"}
                  </td>
                  <td className="num" style={{ color: "var(--ink-2)" }}>
                    {value > 0 ? CURRENCY.format(value) : "—"}
                  </td>
                  <td>
                    {it.is_low_stock
                      ? <span className="badge rose"><span className="dot" />stock bas</span>
                      : <span className="badge green"><span className="dot" />ok</span>}
                  </td>
                  {canEdit && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }}
                          onClick={() => setMoving(it)}>
                          Entrée/Sortie
                        </button>
                        <button className="row-act-btn" title="Modifier" onClick={() => setEditing(it)}><I.Edit /></button>
                        <button className="row-act-btn danger" title="Supprimer" onClick={() => onDelete(it)}><I.Trash /></button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(adding || editing) && (
        <ItemModal
          initial={editing}
          saving={saving}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={onSave}
        />
      )}
      {moving && (
        <MovementModal
          item={moving}
          onClose={() => setMoving(null)}
          onPosted={(updatedItem) => {
            if (updatedItem) {
              setItems((arr) => arr.map((x) => x.uuid === updatedItem.uuid ? updatedItem : x));
            } else {
              reload();
            }
          }}
        />
      )}
    </div>
  );
}
