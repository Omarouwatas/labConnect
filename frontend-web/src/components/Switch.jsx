export default function Switch({ on, onChange, disabled }) {
  return (
    <div
      className={`switch ${on ? "on" : ""}`}
      onClick={() => !disabled && onChange(!on)}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
      role="switch"
      aria-checked={on}
    />
  );
}
