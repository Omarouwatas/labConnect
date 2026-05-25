import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { I } from "../icons";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

export default function Login() {
  const { login, googleLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("creds"); // creds | totp
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const googleBtnRef = useRef(null);

  // Render the official Google Sign-In button once the GIS script is loaded.
  useEffect(() => {
    if (step !== "creds" || !GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    const init = () => {
      if (cancelled || !window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          if (!resp?.credential) return;
          setSubmitting(true);
          setError(null);
          try {
            await googleLogin(resp.credential);
            setStep("totp");
          } catch (err) {
            setError(err.detail || "Connexion Google refusée. Le compte doit déjà exister côté serveur.");
          } finally {
            setSubmitting(false);
          }
        },
        ux_mode: "popup",
        auto_select: false,
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: 380,
      });
    };

    if (window.google?.accounts?.id) {
      init();
    } else {
      const t = setInterval(() => {
        if (window.google?.accounts?.id) { clearInterval(t); init(); }
      }, 200);
      return () => { cancelled = true; clearInterval(t); };
    }
    return () => { cancelled = true; };
  }, [step, googleLogin]);

  const submitCreds = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // 2FA mocked — after creds, we show a fake TOTP screen for UX continuity.
      setStep("totp");
    } catch (err) {
      setError(err.detail || "Email ou mot de passe incorrect.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitTotp = async (e) => {
    e.preventDefault();
    // 2FA mocked — accept any 6-digit code, the session is already valid.
    if (code.join("").length === 6) {
      // The AuthProvider already hydrated user/lab after login.
      // Force a re-check by reloading the page state.
      window.location.reload();
    } else {
      setError("Entrez les 6 chiffres du code.");
    }
  };

  const onCodeChange = (i, v) => {
    if (!/^[0-9]?$/.test(v)) return;
    const next = [...code];
    next[i] = v;
    setCode(next);
    if (v && i < 5) {
      const el = document.getElementById(`totp-${i + 1}`);
      el && el.focus();
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-side">
        <div className="brand-row">
          <div className="brand-mark">l</div>
          <div className="brand-name">lab<em>Connect</em></div>
        </div>
        <div className="pitch">
          <h1>Le laboratoire,<br/>en <em>plus clair</em>.</h1>
          <p>
            Gérez le catalogue de tests, l'équipe et les analyses depuis une console
            pensée pour le terrain. Multi-rôle, multi-laboratoire, multi-langue.
          </p>
          <ul>
            <li><I.Check size={14} sw={2.4} /> Catalogue de tests &amp; tarification dynamique</li>
            <li><I.Check size={14} sw={2.4} /> Gestion d'équipe avec rôles cumulables</li>
            <li><I.Check size={14} sw={2.4} /> Validation des résultats à deux mains</li>
            <li><I.Check size={14} sw={2.4} /> Conforme ISO 15189 — audit complet</li>
          </ul>
        </div>
      </div>

      <div className="auth-main">
        <div className="auth-card">
          {step === "creds" && (
            <>
              <h2>Connexion <em>staff</em></h2>
              <p className="lead">Accédez à votre tableau de bord laboratoire.</p>
              {GOOGLE_CLIENT_ID && (
                <>
                  <div ref={googleBtnRef} style={{ display: "flex", justifyContent: "center", marginBottom: 14 }} />
                  <div className="auth-divider"><span>ou</span></div>
                </>
              )}
              {!GOOGLE_CLIENT_ID && (
                <div className="auth-hint">
                  💡 Pour activer la connexion Google, définissez <code>VITE_GOOGLE_CLIENT_ID</code> dans <code>.env.local</code>.
                </div>
              )}
              <form className="auth-form" onSubmit={submitCreds}>
                {error && <div className="auth-error">{error}</div>}
                <div className="field">
                  <label>Adresse e-mail professionnelle</label>
                  <input
                    className="input"
                    type="email"
                    autoComplete="username"
                    placeholder="nom@labconnect.mr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Mot de passe</label>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <button className="btn btn-orange btn-block btn-lg" type="submit" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : <I.Check size={14} sw={2} />}
                  Se connecter
                </button>
              </form>
              <div className="auth-foot">
                <span>Accès réservé au personnel.</span>
                <a href="#" onClick={(e) => e.preventDefault()}>Mot de passe oublié ?</a>
              </div>
              <div className="auth-hint" style={{ marginTop: 14 }}>
                <strong>Technicien · Biologiste · Infirmier · Secrétaire ?</strong>
                <br />
                Connectez-vous ici dès que votre <strong>chef de labo</strong> vous a invité depuis son écran
                « Personnel ». Vous recevrez vos identifiants par e-mail / SMS.
              </div>
            </>
          )}

          {step === "totp" && (
            <>
              <h2>Code <em>2FA</em></h2>
              <p className="lead">
                <I.Shield size={14} sw={1.8} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                Vérification en deux étapes. (Mode démo — saisissez n'importe quel code à 6 chiffres.)
              </p>
              <form className="auth-form" onSubmit={submitTotp}>
                {error && <div className="auth-error">{error}</div>}
                <div className="totp-grid">
                  {code.map((d, i) => (
                    <input
                      key={i}
                      id={`totp-${i}`}
                      value={d}
                      inputMode="numeric"
                      maxLength={1}
                      onChange={(e) => onCodeChange(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && !code[i] && i > 0) {
                          const el = document.getElementById(`totp-${i - 1}`);
                          el && el.focus();
                        }
                      }}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>
                <button className="btn btn-orange btn-block btn-lg" type="submit">
                  <I.Check size={14} sw={2} /> Valider
                </button>
              </form>
              <div className="auth-foot">
                <a href="#" onClick={(e) => { e.preventDefault(); setStep("creds"); }}>← Changer de compte</a>
                <span>Le code expire dans 30s</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
