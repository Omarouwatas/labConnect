import { useEffect, useMemo, useState } from "react";
import { I } from "../icons";
import Modal from "./Modal";
import { CatBadge } from "./Misc";
import { fetchCatalog, createWalkIn } from "../api";
import { CURRENCY } from "../constants";

/**
 * Création d'une analyse au comptoir — pour un patient qui se présente au
 * labo sans avoir l'app mobile. Le staff saisit son téléphone (le seul
 * champ obligatoire — find-or-create côté backend), éventuellement son
 * nom/email si nouveau patient, et coche les tests demandés.
 *
 * Props :
 *   onClose()                — ferme le modal
 *   onCreated(result)        — appelé après succès, le parent peut
 *                              rafraîchir ses données (dashboard, etc.)
 */
export default function WalkInModal({ onClose, onCreated }) {
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cnamNumber, setCnamNumber] = useState("");
  // String pour gérer le champ vide proprement — converti en nombre
  // au moment du submit. "" = pas de changement côté backend.
  const [cnamPct, setCnamPct] = useState("");
  // Réponses au questionnaire pré-test, indexées { [test_uuid]: [str…] }.
  // Le tableau est aligné avec `prerequisite_questions` du test ; on
  // pré-alloue des chaînes vides à chaque sélection pour ne pas avoir
  // des `undefined` dans le rendu des inputs contrôlés.
  const [answers, setAnswers] = useState({});
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState({}); // { [uuid]: true }
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCatalog();
        if (!cancelled) setCatalog(data.filter((t) => t.is_active));
      } catch (e) {
        if (!cancelled) setErr(e?.detail || "Catalogue indisponible.");
      } finally { if (!cancelled) setLoadingCatalog(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return catalog;
    const q = query.toLowerCase();
    return catalog.filter((t) =>
      `${t.code} ${t.name}`.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  const selectedTests = useMemo(
    () => catalog.filter((t) => selected[t.uuid]),
    [catalog, selected],
  );
  const total = useMemo(
    () => selectedTests.reduce((acc, t) => acc + Number(t.price_mru || 0), 0),
    [selectedTests],
  );
  // Split CNAM côté UI — purement indicatif, le backend recalcule à la
  // création (et c'est lui qui fait foi en cas de divergence d'arrondi).
  const pctNum = Number(cnamPct) || 0;
  const cnamCovered = Math.floor((total * Math.max(0, Math.min(100, pctNum))) / 100);
  const patientDue = total - cnamCovered;

  const toggle = (uuid) => setSelected((s) => ({ ...s, [uuid]: !s[uuid] }));

  // Tests sélectionnés qui ont au moins une question — on n'affiche la
  // section que s'il y en a, et chaque test garde son propre bloc.
  const testsWithQuestions = useMemo(
    () => selectedTests.filter((t) => (t.prerequisite_questions || []).length > 0),
    [selectedTests],
  );
  const setAnswer = (testUuid, idx, val) => setAnswers((a) => {
    const cur = a[testUuid] || [];
    const next = [...cur];
    next[idx] = val;
    return { ...a, [testUuid]: next };
  });

  const submit = async () => {
    setErr(null);
    if (!phone.trim()) return setErr("Le téléphone du patient est requis.");
    if (selectedTests.length === 0) return setErr("Sélectionnez au moins un test.");
    setSaving(true);
    try {
      // Construit la map des réponses uniquement pour les tests qui ont
      // des questions ET au moins une réponse non vide — sinon on évite
      // d'envoyer du bruit (le backend tolérerait, mais c'est plus net).
      const answersPayload = {};
      for (const t of testsWithQuestions) {
        const arr = answers[t.uuid] || [];
        if (arr.some((v) => v && v.trim())) {
          answersPayload[t.uuid] = arr;
        }
      }
      const payload = {
        phone: phone.trim(),
        test_uuids: selectedTests.map((t) => t.uuid),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        email: email.trim() || undefined,
        cnam_number: cnamNumber.trim() || undefined,
        // On envoie le pourcentage seulement si l'agent l'a saisi.
        // Sinon le backend conserve celui déjà en base sur le profil.
        cnam_coverage_pct: cnamPct === "" ? undefined : Number(cnamPct),
        prerequisite_answers: Object.keys(answersPayload).length ? answersPayload : undefined,
        notes: notes.trim() || undefined,
      };
      const result = await createWalkIn(payload);
      onCreated?.(result);
      onClose?.();
    } catch (e) {
      // Format DRF : soit { error: { detail } }, soit { phone: [...] } etc.
      const raw = e?.raw;
      const fieldErrs = raw && typeof raw === "object" && !raw.error
        ? Object.entries(raw).map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(" ") : v}`).join(" · ")
        : null;
      setErr(fieldErrs || e?.detail || "Création impossible.");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      wide
      title={<>Nouvelle <em>analyse</em> au comptoir</>}
      subtitle="Pour un patient qui se présente sans l'app mobile. Vous renseignez son téléphone et les tests demandés ; le compte patient est créé automatiquement si besoin."
      onClose={onClose}
      footer={
        <>
          <div className="hint">
            {selectedTests.length === 0
              ? "Sélectionnez au moins un test pour valider."
              : <>
                <strong>{selectedTests.length}</strong> test{selectedTests.length > 1 ? "s" : ""} ·{" "}
                Total <strong>{CURRENCY.format(total)}</strong>
                {pctNum > 0 && (
                  <> · CNAM {pctNum}% <strong>{CURRENCY.format(cnamCovered)}</strong> ·{" "}
                    Patient <strong>{CURRENCY.format(patientDue)}</strong></>
                )}
              </>}
          </div>
          <div className="actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Annuler</button>
            <button className="btn btn-orange" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
              Créer l'analyse
            </button>
          </div>
        </>
      }
    >
      {err && <div className="auth-error" style={{ marginBottom: 12 }}>{err}</div>}

      {/* ── Patient ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <div className="kpi-label" style={{ padding: 0, marginBottom: 8 }}>1 · Patient</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div className="field">
            <label>Téléphone *</label>
            <input
              className="input"
              placeholder="+222 22 …"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{ fontFamily: "var(--mono)" }}
              autoFocus
            />
            <span className="hint">Identifiant unique du patient — find-or-create.</span>
          </div>
          <div className="field">
            <label>Email (facultatif)</label>
            <input
              className="input"
              type="email"
              placeholder="patient@exemple.mr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div className="field">
            <label>Prénom (si nouveau patient)</label>
            <input
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Nom (si nouveau patient)</label>
            <input
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>

        {/* CNAM — laissé vide si pas d'assurance ou si déjà renseigné */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <div className="field">
            <label>N° carte CNAM (facultatif)</label>
            <input
              className="input"
              placeholder="ex : MR-2026-…"
              value={cnamNumber}
              onChange={(e) => setCnamNumber(e.target.value)}
              style={{ fontFamily: "var(--mono)" }}
            />
            <span className="hint">Conservé sur le profil du patient pour les prochaines visites.</span>
          </div>
          <div className="field">
            <label>Couverture (%)</label>
            <input
              className="input"
              type="number" min={0} max={100}
              placeholder="80"
              value={cnamPct}
              onChange={(e) => setCnamPct(e.target.value)}
              style={{ fontFamily: "var(--mono)" }}
            />
            <span className="hint">0 = pas couvert.</span>
          </div>
        </div>
      </div>

      {/* ── Tests ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <div className="kpi-label" style={{ padding: 0, marginBottom: 8 }}>2 · Tests à effectuer</div>

        <div className="search" style={{ marginBottom: 10 }}>
          <I.Search size={14} />
          <input
            placeholder="Filtrer par code ou nom…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{
          maxHeight: 260, overflowY: "auto",
          border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)",
        }}>
          {loadingCatalog && (
            <div className="empty" style={{ padding: 24 }}><span className="spinner" /> Chargement…</div>
          )}
          {!loadingCatalog && filtered.length === 0 && (
            <div className="empty" style={{ padding: 24 }}>
              {catalog.length === 0
                ? "Catalogue vide. Ajoutez d'abord des tests depuis l'écran Catalogue."
                : "Aucun test ne correspond au filtre."}
            </div>
          )}
          {!loadingCatalog && filtered.map((t) => {
            const on = !!selected[t.uuid];
            return (
              <label
                key={t.uuid}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", cursor: "pointer",
                  borderBottom: "1px solid var(--line)",
                  background: on ? "var(--o-glow)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(t.uuid)}
                  style={{ width: 18, height: 18, accentColor: "var(--o)" }}
                />
                <CatBadge catId={t.sample_type || "blood"} withDot={false} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, fontFamily: "var(--mono)" }}>{t.code}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{t.name}</div>
                </div>
                <span className="price-pill">{CURRENCY.format(t.price_mru)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── Questionnaire ────────────────────────────────────────────── */}
      {testsWithQuestions.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="kpi-label" style={{ padding: 0, marginBottom: 8 }}>
            3 · Questionnaire pré-test
          </div>
          {testsWithQuestions.map((t) => (
            <div key={t.uuid} className="card" style={{
              background: "var(--bg)", padding: 14, marginBottom: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <CatBadge catId={t.sample_type || "blood"} withDot={false} />
                <strong style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{t.code}</strong>
                <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{t.name}</span>
              </div>
              {(t.prerequisite_questions || []).map((q, i) => (
                <div key={i} className="field" style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 12.5 }}>{q}</label>
                  <input
                    className="input"
                    value={(answers[t.uuid] || [])[i] || ""}
                    onChange={(e) => setAnswer(t.uuid, i, e.target.value)}
                    placeholder="Réponse…"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <div className="field">
        <label>Notes (facultatif)</label>
        <textarea
          className="textarea"
          rows={2}
          placeholder="Observation, ordonnance, contexte clinique…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}
