import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "../icons";
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from "../api";

const POLL_MS = 30_000;

// Mapping kind → icône + intent. On reste cohérent avec le mobile.
const KIND_META = {
  appt_created:        { icon: "Calendar", color: "var(--o)" },
  appt_confirmed:      { icon: "Check",    color: "var(--leaf)" },
  appt_checked_in:     { icon: "Users",    color: "var(--grape, #7C6BFF)" },
  appt_in_progress:    { icon: "Beaker",   color: "var(--grape, #7C6BFF)" },
  appt_completed:      { icon: "Check",    color: "var(--leaf)" },
  appt_cancelled:      { icon: "X",        color: "var(--rose)" },
  appt_nurse_assigned: { icon: "Users",    color: "var(--o)" },
  sample_received:     { icon: "Beaker",   color: "var(--o)" },
  result_entered:      { icon: "Edit",     color: "var(--sun, #FFB938)" },
  result_validated:    { icon: "Shield",   color: "var(--leaf)" },
  result_available:    { icon: "Sparkle",  color: "var(--leaf)" },
  sample_rejected:     { icon: "X",        color: "var(--rose)" },
  info:                { icon: "Bell",     color: "var(--ink-3)" },
};

const SEVERITY_BG = {
  success:  "rgba(33, 192, 138, 0.14)",
  info:     "rgba(8, 196, 178, 0.14)",
  warning:  "rgba(255, 185, 56, 0.16)",
  critical: "rgba(255, 107, 107, 0.16)",
};

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `il y a ${days} j`;
  try {
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch { return ""; }
}

/**
 * Cloche de la topbar : badge unread + dropdown des dernières
 * notifications. Le composant gère son propre polling (toutes les 30 s).
 *
 * Pour les écrans staff, le payload contient typiquement
 * `appointment_uuid` ou `order_uuid` — on n'utilise pas ces deep-links
 * pour l'instant (pas de routing global app-wide) mais l'info est là
 * pour une évolution rapide.
 */
export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications();
      setItems(data?.results || []);
      setUnread(data?.unread || 0);
    } catch { /* silencieux */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Fermeture sur clic en-dehors (clavier Escape).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onTap = (n) => {
    if (!n.read_at) {
      setItems((arr) => arr.map((x) => x.uuid === n.uuid
        ? { ...x, read_at: new Date().toISOString() } : x));
      setUnread((u) => Math.max(0, u - 1));
      markNotificationRead(n.uuid).catch(() => {});
    }
    // Pas de deep-link app-wide pour l'instant — l'utilisateur peut
    // naviguer manuellement vers Analyses / Dashboard. On laisse le
    // dropdown ouvert pour ne pas perdre le contexte.
  };

  const onMarkAll = async () => {
    setItems((arr) => arr.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnread(0);
    try { await markAllNotificationsRead(); } catch { /* ignore */ }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="icon-btn"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        style={{ position: "relative" }}
      >
        <I.Bell size={16} />
        {unread > 0 && (
          <span style={badgeStyle}>{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div style={dropdownStyle}>
          <div style={headStyle}>
            <div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 700 }}>
                Notifications
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                {unread > 0 ? `${unread} non lue${unread > 1 ? "s" : ""}` : "Tout est à jour"}
              </div>
            </div>
            {unread > 0 && (
              <button
                className="btn btn-ghost"
                style={{ padding: "4px 10px", fontSize: 11.5 }}
                onClick={onMarkAll}
              >
                Tout lire
              </button>
            )}
          </div>

          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            {loading && items.length === 0 && (
              <div className="empty" style={{ padding: 28 }}>
                <span className="spinner" /> Chargement…
              </div>
            )}
            {!loading && items.length === 0 && (
              <div className="empty" style={{ padding: 28 }}>
                Pas encore de notification.
              </div>
            )}
            {items.map((n) => {
              const meta = KIND_META[n.kind] || KIND_META.info;
              const IconC = I[meta.icon] || I.Bell;
              const bg = SEVERITY_BG[n.severity] || SEVERITY_BG.info;
              const isUnread = !n.read_at;
              return (
                <button
                  key={n.uuid}
                  onClick={() => onTap(n)}
                  style={{
                    display: "flex", gap: 12, alignItems: "flex-start",
                    padding: "12px 14px", width: "100%",
                    background: isUnread ? "var(--bg)" : "transparent",
                    borderBottom: "1px solid var(--line)",
                    cursor: "pointer", textAlign: "left",
                    border: "none",
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 12,
                    background: bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, color: meta.color,
                  }}>
                    <IconC size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6,
                      fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)",
                    }}>
                      <span style={{
                        flex: 1, whiteSpace: "nowrap",
                        overflow: "hidden", textOverflow: "ellipsis",
                      }}>{n.title}</span>
                      {isUnread && <span style={dotStyle(meta.color)} />}
                    </div>
                    {n.body && (
                      <div style={{
                        fontSize: 12, color: "var(--ink-2)", marginTop: 3,
                        display: "-webkit-box", WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{
                      fontSize: 11, color: "var(--ink-3)", marginTop: 5,
                    }}>
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const badgeStyle = {
  position: "absolute", top: 2, right: 2,
  minWidth: 16, height: 16, borderRadius: 10,
  background: "var(--rose)", color: "#fff",
  fontSize: 9.5, fontWeight: 800,
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: "0 4px",
  border: "2px solid #fff",
};

const dropdownStyle = {
  position: "absolute", top: "calc(100% + 8px)", right: 0,
  width: 380, maxWidth: "92vw",
  background: "#fff",
  border: "1px solid var(--line)",
  borderRadius: 14,
  boxShadow: "0 14px 40px rgba(20,57,66,0.18)",
  zIndex: 50, overflow: "hidden",
};

const headStyle = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "12px 14px", borderBottom: "1px solid var(--line)",
};

const dotStyle = (color) => ({
  width: 8, height: 8, borderRadius: 999,
  background: color || "var(--o)",
  flexShrink: 0,
});
