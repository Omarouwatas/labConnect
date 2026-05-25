import { useState } from "react";
import { useAuth } from "../auth";
import { createLab } from "../api";
import { DEFAULT_LOCATION } from "../constants";
import MapPicker from "../components/MapPicker";
import { I } from "../icons";

export default function Onboarding({ onCreated }) {
  const { user, logout } = useAuth();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: user?.email || "",
    address: "",
    description: "",
    latitude: DEFAULT_LOCATION.lat,
    longitude: DEFAULT_LOCATION.lng,
    accepts_home_visits: true,
    accepts_emergencies: false,
  });
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!form.name.trim()) { setErr("Le nom du laboratoire est requis."); return; }
    if (!form.address.trim()) { setErr("Indiquez l'adresse sur la carte ou par recherche."); return; }
    setSaving(true);
    try {
      const lab = await createLab({
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        description: form.description,
        latitude: form.latitude,
        longitude: form.longitude,
        accepts_home_visits: form.accepts_home_visits,
        accepts_emergencies: form.accepts_emergencies,
      });
      onCreated?.(lab);
    } catch (e2) {
      setErr(e2.detail || "Erreur lors de la création.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app" style={{ gridTemplateColumns: "1fr" }}>
      <div className="page" style={{ maxWidth: 980 }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">Bienvenue, <em>chef de labo</em>.</h1>
            <p className="page-sub">
              Aucun laboratoire n'est encore rattaché à votre compte.
              Créez votre premier laboratoire pour démarrer — vous pourrez en ajouter d'autres ensuite.
            </p>
          </div>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={logout}>
              <I.Logout size={14} sw={1.8} /> Se déconnecter
            </button>
          </div>
        </div>

        <form className="card" onSubmit={submit}>
          <div className="card-head">
            <div>
              <h3>Nouveau <em style={{ color: "var(--o)", fontStyle: "italic", fontFamily: "var(--serif)" }}>laboratoire</em></h3>
              <div className="sub">Vous pourrez modifier ces informations à tout moment.</div>
            </div>
          </div>
          <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {err && <div className="auth-error">{err}</div>}

            <div className="grid-2">
              <div className="field">
                <label>Nom du laboratoire</label>
                <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Labo Tevragh Zeina" required />
              </div>
              <div className="field">
                <label>Téléphone</label>
                <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+222 …" style={{ fontFamily: "var(--mono)" }} />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>Email de contact</label>
                <input className="input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="contact@labo.mr" />
              </div>
            </div>

            <div className="field">
              <label>Adresse + géolocalisation</label>
              <MapPicker
                value={{ lat: form.latitude, lng: form.longitude, address: form.address }}
                onChange={({ lat, lng, address }) => {
                  set("latitude", lat);
                  set("longitude", lng);
                  set("address", address);
                }}
                height={320}
              />
              <input
                className="input"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Adresse complète (auto-remplie depuis la carte)"
                style={{ marginTop: 8 }}
              />
            </div>

            <div className="field">
              <label>Description (facultatif)</label>
              <textarea className="textarea" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="submit" className="btn btn-orange btn-lg" disabled={saving}>
                {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
                Créer le laboratoire
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
