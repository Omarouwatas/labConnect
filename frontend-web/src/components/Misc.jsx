import { CATEGORIES } from "../constants";
import { I } from "../icons";

export function CatBadge({ catId, withDot = true }) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) return null;
  return (
    <span className={`badge ${cat.color}`}>
      {withDot && <span className="dot"></span>}
      {cat.name}
    </span>
  );
}

export function PermRibbon({ children }) {
  return (
    <span className="perm-ribbon">
      <I.Lock size={12} sw={2} />
      {children}
    </span>
  );
}

export function FullScreenLoader({ label = "Chargement…" }) {
  return (
    <div className="full-screen-loader">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}
