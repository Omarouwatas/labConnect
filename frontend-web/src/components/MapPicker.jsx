import { useEffect, useRef, useState } from "react";
import { geocode, reverseGeocode } from "../api";
import { DEFAULT_LOCATION } from "../constants";
import { I } from "../icons";

// Click-to-set marker + address search via Nominatim.
// Requires Leaflet to be loaded globally (see index.html).

export default function MapPicker({ value, onChange, height = 320 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [query, setQuery] = useState(value?.address || "");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);

  // Init map once
  useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const start = value?.lat && value?.lng ? [value.lat, value.lng] : [DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng];
    const map = window.L.map(containerRef.current, {
      center: start, zoom: value?.lat ? 14 : 12, scrollWheelZoom: false,
    });
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    const marker = window.L.marker(start, { draggable: true }).addTo(map);
    marker.on("dragend", async () => {
      const { lat, lng } = marker.getLatLng();
      const rev = await reverseGeocode(lat, lng);
      const addr = rev?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setQuery(addr);
      onChange?.({ lat, lng, address: addr });
    });

    map.on("click", async (e) => {
      marker.setLatLng(e.latlng);
      const { lat, lng } = e.latlng;
      const rev = await reverseGeocode(lat, lng);
      const addr = rev?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setQuery(addr);
      onChange?.({ lat, lng, address: addr });
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Resize handler in case the modal was sized late
    setTimeout(() => map.invalidateSize(), 80);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update marker when value prop changes externally
  useEffect(() => {
    if (mapRef.current && markerRef.current && value?.lat && value?.lng) {
      markerRef.current.setLatLng([value.lat, value.lng]);
      mapRef.current.setView([value.lat, value.lng]);
    }
  }, [value?.lat, value?.lng]);

  const onSearch = async (q) => {
    setSearching(true);
    try {
      const results = await geocode(q);
      setSuggestions(results);
    } finally { setSearching(false); }
  };

  const pickSuggestion = (s) => {
    const lat = Number(s.lat), lng = Number(s.lon);
    setQuery(s.display_name);
    setSuggestions([]);
    onChange?.({ lat, lng, address: s.display_name });
    if (mapRef.current && markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      mapRef.current.setView([lat, lng], 15);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const rev = await reverseGeocode(lat, lng);
      const addr = rev?.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setQuery(addr);
      onChange?.({ lat, lng, address: addr });
      if (mapRef.current && markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
        mapRef.current.setView([lat, lng], 15);
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ position: "relative", display: "flex", gap: 8 }}>
        <div className="search" style={{ flex: 1 }}>
          <I.Search size={15} />
          <input
            value={query}
            placeholder="Rechercher une adresse en Mauritanie…"
            onChange={(e) => { setQuery(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearch(query); } }}
            style={{ width: "100%" }}
          />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => onSearch(query)} disabled={!query || searching}>
          {searching ? <span className="spinner" /> : <I.Search size={14} sw={1.8} />} Chercher
        </button>
        <button type="button" className="btn btn-ghost" onClick={useMyLocation} title="Utiliser ma position GPS">
          <I.Building size={14} sw={1.8} /> Ma position
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="card" style={{ padding: 6, maxHeight: 200, overflow: "auto" }}>
          {suggestions.map((s) => (
            <button
              key={s.place_id}
              type="button"
              className="role-option"
              style={{ width: "100%" }}
              onClick={() => pickSuggestion(s)}
            >
              <div className="ro-meta">
                <div className="n" style={{ fontSize: 12.5 }}>{s.display_name}</div>
                <div className="r" style={{ fontFamily: "var(--mono)" }}>
                  {Number(s.lat).toFixed(4)}, {Number(s.lon).toFixed(4)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          height,
          width: "100%",
          borderRadius: "var(--radius)",
          border: "1px solid var(--line)",
          overflow: "hidden",
        }}
      />
      <span className="hint">Cliquez sur la carte ou déplacez le marqueur pour définir l'emplacement exact.</span>
    </div>
  );
}
