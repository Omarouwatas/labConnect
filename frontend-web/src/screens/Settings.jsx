import { useEffect, useState } from "react";
import { I } from "../icons";
import Switch from "../components/Switch";
import MapPicker from "../components/MapPicker";
import { fetchLabConfig, patchLabConfig, uploadLabLogo, mediaUrl } from "../api";
import { useRef } from "react";
import { CURRENCY, DEFAULT_LOCATION } from "../constants";

export default function Settings({ permissions, lab: labFromCtx }) {
  const canEdit = permissions.editSettings;
  const [tab, setTab] = useState("lab");
  const [lab, setLab] = useState(labFromCtx);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef(null);

  const onLogoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Sélectionnez une image (PNG, JPG, SVG…).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("Le fichier dépasse 5 MB.");
      return;
    }
    setUploadingLogo(true);
    try {
      const updated = await uploadLabLogo(file);
      setLab(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      alert(err?.detail || "Erreur lors de l'envoi du logo.");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    let cancelled = false;
    const apply = (cfg) => {
      if (cancelled || !cfg) return;
      setLab(cfg);
      setForm({
        name: cfg.name || "",
        phone: cfg.phone || "",
        email: cfg.email || "",
        address: cfg.address || "",
        description: cfg.description || "",
        accepts_home_visits: !!cfg.accepts_home_visits,
        accepts_emergencies: !!cfg.accepts_emergencies,
        home_visit_fee_mru: cfg.home_visit_fee_mru || 0,
        emergency_fee_mru: cfg.emergency_fee_mru || 0,
        latitude: cfg.latitude ?? DEFAULT_LOCATION.lat,
        longitude: cfg.longitude ?? DEFAULT_LOCATION.lng,
      });
    };
    // AuthProvider has already loaded `/lab/mine/` and exposes the active
    // lab as a prop. Use it directly to avoid a redundant `/lab/config`
    // round trip on every navigation. Fall back to fetching only if the
    // context hasn't hydrated yet.
    if (labFromCtx) {
      apply(labFromCtx);
    } else {
      fetchLabConfig().then(apply).catch(() => { /* ignore */ });
    }
    return () => { cancelled = true; };
  }, [labFromCtx]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const updated = await patchLabConfig(form);
      setLab(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres du <em>laboratoire</em></h1>
          <p className="page-sub">Configurez l'identité, l'emplacement et les processus de votre laboratoire.</p>
        </div>
        <div className="page-actions">
          {canEdit && form && (
            <button className="btn btn-orange" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              {saved ? "Enregistré ✓" : "Enregistrer"}
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {[
          { id: "lab",       label: "Identité du labo" },
          { id: "location",  label: "Emplacement" },
          { id: "workflow",  label: "Workflow" },
          { id: "billing",   label: "Facturation" },
          { id: "access",    label: "Accès & sécurité" },
        ].map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "lab" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
          <div className="card">
            <div className="card-pad" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 32, position: "relative", overflow: "hidden" }}>
              <div className="deco-dots" style={{ top: 12, right: 12 }} />
              {lab?.logo ? (
                <img
                  src={mediaUrl(lab.logo)}
                  alt="Logo"
                  style={{ width: 86, height: 86, borderRadius: 22, objectFit: "cover", boxShadow: "0 4px 0 var(--o-deep), 0 12px 24px rgba(196,74,34,0.25)" }}
                />
              ) : (
                <div style={{
                  width: 86, height: 86, borderRadius: 22,
                  background: "linear-gradient(135deg, var(--o) 0%, var(--o-deep) 100%)",
                  display: "grid", placeItems: "center",
                  color: "white", fontFamily: "var(--serif)", fontSize: 48, fontStyle: "italic",
                  boxShadow: "0 4px 0 var(--o-deep), 0 12px 24px rgba(196,74,34,0.25)",
                }}>{(form?.name || "L")[0].toUpperCase()}</div>
              )}
              <div style={{ marginTop: 14, fontFamily: "var(--serif)", fontSize: 24, letterSpacing: "-0.01em" }}>
                {form?.name || "Laboratoire"}
              </div>
              <div style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 2 }}>
                Nouakchott, Mauritanie
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onLogoPick}
                style={{ display: "none" }}
              />
              <button
                className="btn btn-secondary"
                style={{ marginTop: 18 }}
                disabled={!canEdit || uploadingLogo}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingLogo ? <span className="spinner" /> : null}
                {uploadingLogo ? "Envoi…" : (lab?.logo ? "Changer le logo" : "Téléverser un logo")}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div><h3>Informations générales</h3><div className="sub">Apparaissent sur les rapports et factures</div></div></div>
            <div style={{ padding: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Nom du laboratoire</label>
                <input className="input" value={form?.name || ""} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} />
              </div>
              <div className="field">
                <label>Téléphone</label>
                <input className="input" value={form?.phone || ""} onChange={(e) => set("phone", e.target.value)} style={{ fontFamily: "var(--mono)" }} disabled={!canEdit} placeholder="+222 …" />
              </div>
              <div className="field">
                <label>Email de contact</label>
                <input className="input" value={form?.email || ""} onChange={(e) => set("email", e.target.value)} disabled={!canEdit} placeholder="contact@labo.mr" />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Description (portail patient)</label>
                <textarea className="textarea" value={form?.description || ""} onChange={(e) => set("description", e.target.value)} disabled={!canEdit} />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "location" && form && (
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Emplacement <em style={{ color: "var(--o)", fontStyle: "italic", fontFamily: "var(--serif)" }}>du labo</em></h3>
              <div className="sub">Recherchez l'adresse ou cliquez sur la carte pour positionner précisément le labo.</div>
            </div>
          </div>
          <div className="card-pad">
            <MapPicker
              value={{ lat: form.latitude, lng: form.longitude, address: form.address }}
              onChange={({ lat, lng, address }) => {
                set("latitude", lat);
                set("longitude", lng);
                set("address", address);
              }}
              height={420}
            />
            <div className="field" style={{ marginTop: 14 }}>
              <label>Adresse complète</label>
              <input className="input" value={form.address || ""} onChange={(e) => set("address", e.target.value)} disabled={!canEdit} />
              <span className="hint">
                Coordonnées : <span className="num">{Number(form.latitude).toFixed(5)}, {Number(form.longitude).toFixed(5)}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === "workflow" && (
        <div className="card">
          <div className="card-head"><div><h3>Processus du laboratoire</h3><div className="sub">Visites, urgences, prélèvements</div></div></div>
          <div className="setting-row">
            <div className="lbl-block">
              <div className="t">Accepte les visites à domicile</div>
              <div className="d">Les patients peuvent demander une visite à domicile via l'app mobile patient.</div>
            </div>
            <Switch on={!!form?.accepts_home_visits} disabled={!canEdit} onChange={(v) => set("accepts_home_visits", v)} />
          </div>
          <div className="setting-row">
            <div className="lbl-block">
              <div className="t">Accepte les urgences</div>
              <div className="d">Active le mode urgence (priorité haute + frais supplémentaires).</div>
            </div>
            <Switch on={!!form?.accepts_emergencies} disabled={!canEdit} onChange={(v) => set("accepts_emergencies", v)} />
          </div>
        </div>
      )}

      {tab === "billing" && (
        <div className="card">
          <div className="card-head"><div><h3>Facturation & tarifs</h3><div className="sub">Frais visite à domicile et urgence</div></div></div>
          <div className="setting-row">
            <div className="lbl-block">
              <div className="t">Frais de visite à domicile</div>
              <div className="d">Supplément facturé en plus du prix des tests pour un déplacement.</div>
            </div>
            <div className="input-prefix" style={{ maxWidth: 200 }}>
              <span className="pfx">{CURRENCY.symbol}</span>
              <input className="input" type="number" min="0" step="50"
                value={form?.home_visit_fee_mru || 0}
                onChange={(e) => set("home_visit_fee_mru", Number(e.target.value))}
                disabled={!canEdit || !form?.accepts_home_visits} />
            </div>
          </div>
          <div className="setting-row">
            <div className="lbl-block">
              <div className="t">Frais urgence</div>
              <div className="d">Supplément urgence pour traitement prioritaire.</div>
            </div>
            <div className="input-prefix" style={{ maxWidth: 200 }}>
              <span className="pfx">{CURRENCY.symbol}</span>
              <input className="input" type="number" min="0" step="50"
                value={form?.emergency_fee_mru || 0}
                onChange={(e) => set("emergency_fee_mru", Number(e.target.value))}
                disabled={!canEdit || !form?.accepts_emergencies} />
            </div>
          </div>
        </div>
      )}

      {tab === "access" && (
        <div className="card">
          <div className="card-head"><div><h3>Accès & sécurité</h3><div className="sub">Authentification, rôles, audit</div></div></div>
          <div className="setting-row">
            <div className="lbl-block">
              <div className="t">Double authentification</div>
              <div className="d">
                <strong style={{ color: "var(--amber)" }}>Mode démo</strong> — la 2FA est mockée côté serveur.
                Réactivable depuis <code>accounts/tokens.py</code>.
              </div>
            </div>
            <Switch on={true} disabled />
          </div>
          <div className="setting-row">
            <div className="lbl-block">
              <div className="t">Journal d'audit</div>
              <div className="d">Toutes les actions sensibles sont tracées et archivées 5 ans.</div>
            </div>
            <button className="btn btn-secondary" disabled={!canEdit}>Consulter le journal</button>
          </div>
        </div>
      )}
    </div>
  );
}
