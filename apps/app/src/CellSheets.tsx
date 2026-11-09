import { useState } from "react";
import {
  ALTITUDE_UNITS, DISTANCE_UNITS, SPEED_UNITS, STANDARD_QNH, UNIT_CHOICES, calibrationOffset, formatQuantity,
  isPlausibleQnh, meters, pascals, toSI, unitLabel,
  type AltitudeMode, type AltitudeSettings, type Meters, type UnitPrefs,
} from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import type { GpsAltitudeRef } from "./prefs";

/** Cases de la grille sur lesquelles on peut toucher pour régler l'information. */
export type CellId = "gs" | "trk" | "alt" | "brg" | "dist";

const UNIT_FIELD = { gs: "groundSpeed", trk: "track", alt: "altitude", brg: "bearing", dist: "distance" } as const;
const CELL_TITLE: Record<CellId, Key> = {
  gs: "unit.groundSpeed", trk: "unit.track", alt: "unit.altitude", brg: "unit.bearing", dist: "unit.distance",
};
const SHORT_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SPEED_UNITS).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(ALTITUDE_UNITS).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(DISTANCE_UNITS).map(([k, v]) => [k, v.label])),
};

interface CommonProps {
  lang: Lang;
  prefs: UnitPrefs;
  setUnit: <K extends keyof UnitPrefs>(field: K, value: UnitPrefs[K]) => void;
  onClose: () => void;
}

/** Choix de l'unité (ou de la référence vrai/magnétique) d'une case. */
export function UnitSheet({ cell, lang, prefs, setUnit, onClose }: CommonProps & { cell: Exclude<CellId, "alt"> }) {
  const T = (k: Key) => t(lang, k);
  const field = UNIT_FIELD[cell];
  return (
    <aside className="sheet" aria-label={T(CELL_TITLE[cell])}>
      <header>
        <h2>{T(CELL_TITLE[cell])}</h2>
        <button onClick={onClose}>{T("close")}</button>
      </header>
      <div className="choices">
        {UNIT_CHOICES[field].map((choice) => (
          <button key={choice} aria-pressed={prefs[field] === choice} onClick={() => setUnit(field, choice as UnitPrefs[typeof field])}>
            {choice === "mag" || choice === "true"
              ? unitLabel(field as "track" | "bearing", { ...prefs, [field]: choice }, lang)
              : (SHORT_LABELS[choice] ?? choice)}
          </button>
        ))}
      </div>
    </aside>
  );
}

interface AltitudeSheetProps extends CommonProps {
  settings: AltitudeSettings;
  onSettings: (next: AltitudeSettings, changed: { qnh?: boolean; offset?: boolean }) => void;
  /** Altitude GPS AMSL brute (avant calage), ou null sans GPS. */
  gpsAmsl: Meters | null;
  qnhExpired: boolean;
  gpsAltRef: GpsAltitudeRef;
  onGpsAltRef: (v: GpsAltitudeRef) => void;
}

const MODES: { mode: AltitudeMode; label: Key }[] = [
  { mode: "qnh", label: "alt.mode.qnh" },
  { mode: "fl", label: "alt.mode.fl" },
  { mode: "gps", label: "alt.mode.gps" },
];

/** Fiche d'altitude : mode, QNH du jour, calage sur un terrain, source de l'altitude GPS. */
export function AltitudeSheet(p: AltitudeSheetProps) {
  const T = (k: Key) => t(p.lang, k);
  const { prefs, settings } = p;
  const inHg = prefs.pressure === "inhg";
  const stepPa = inHg ? 33.86389 : 100;
  // Les QNH sont des valeurs entières (hPa) : depuis 1013,25 (STD), le premier appui arrive sur un QNH entier.
  const stepFrom = (pa: number) => Math.round(pa / stepPa) * stepPa;

  const [qnhText, setQnhText] = useState(() => formatQuantity("pressure", prefs, settings.qnh));
  const [qnhBad, setQnhBad] = useState(false);
  const [elevText, setElevText] = useState("");

  const setQnh = (pa: number) => {
    if (!isPlausibleQnh(pa / 100)) {
      setQnhBad(true);
      return;
    }
    setQnhBad(false);
    p.onSettings({ ...settings, qnh: pascals(pa) }, { qnh: true });
    setQnhText(formatQuantity("pressure", prefs, pascals(pa)));
  };
  const typedQnh = () => {
    const v = Number(qnhText.replace(",", "."));
    if (!Number.isFinite(v)) return setQnhBad(true);
    setQnh(toSI("pressure", prefs, v));
  };

  const elev = Number(elevText.replace(",", "."));
  const canCalibrate = p.gpsAmsl !== null && elevText.trim() !== "" && Number.isFinite(elev);
  const applyCalibration = () => {
    if (p.gpsAmsl === null || !Number.isFinite(elev)) return;
    const off = calibrationOffset(p.gpsAmsl, meters(toSI("altitude", prefs, elev)));
    p.onSettings({ ...settings, offset: off }, { offset: true });
  };
  const offsetShown = formatQuantity("altitude", prefs, Math.abs(settings.offset));
  const showQnh = settings.mode !== "gps";

  return (
    <aside className="sheet" aria-label={T("alt.title")}>
      <header>
        <h2>{T("alt.title")}</h2>
        <button onClick={p.onClose}>{T("close")}</button>
      </header>
      {showQnh && (
        <>
          <h3>{T("alt.qnh")} · {unitLabel("pressure", prefs)}</h3>
          {p.qnhExpired && <p className="error" role="alert">{T("alt.qnh.expired")}</p>}
          <div className="stepper">
            <button aria-label="QNH −" onClick={() => setQnh(stepFrom(settings.qnh) - stepPa)}>−</button>
            <input
              className="field mono"
              inputMode="decimal"
              aria-label="QNH"
              value={qnhText}
              onChange={(e) => setQnhText(e.target.value)}
              onBlur={typedQnh}
              onKeyDown={(e) => e.key === "Enter" && typedQnh()}
            />
            <button aria-label="QNH +" onClick={() => setQnh(stepFrom(settings.qnh) + stepPa)}>+</button>
            <button onClick={() => setQnh(STANDARD_QNH)}>{T("alt.qnh.std")}</button>
          </div>
          {qnhBad && <p className="error" role="alert">{T("alt.qnh.invalid")}</p>}
        </>
      )}

      <h3>{T("alt.mode")}</h3>
      <div className="choices">
        {MODES.map((m) => (
          <button key={m.mode} aria-pressed={settings.mode === m.mode} onClick={() => p.onSettings({ ...settings, mode: m.mode }, {})}>
            {T(m.label)}
          </button>
        ))}
      </div>

      <p className="muted small">{T("alt.estimate")}</p>

      <h3>{T("alt.calib")}</h3>
      <p className="muted small">{T("alt.calib.help")}</p>
      <div className="stepper">
        <input
          className="field mono"
          inputMode="decimal"
          aria-label={T("alt.calib")}
          placeholder={unitLabel("altitude", prefs)}
          value={elevText}
          onChange={(e) => setElevText(e.target.value)}
        />
        <button disabled={!canCalibrate} onClick={applyCalibration}>{T("alt.calib.apply")}</button>
      </div>
      {p.gpsAmsl === null && <p className="muted small">{T("alt.calib.nogps")}</p>}
      {settings.offset !== 0 && (
        <p className="muted small">
          {T("alt.calib.current")} : {settings.offset > 0 ? "+" : "−"}{offsetShown} {unitLabel("altitude", prefs)}{" "}
          <button className="btn-inline" onClick={() => p.onSettings({ ...settings, offset: meters(0) }, { offset: true })}>
            {T("alt.calib.reset")}
          </button>
        </p>
      )}

      <h3>{T("set.gpsalt")}</h3>
      <div className="choices">
        <button aria-pressed={p.gpsAltRef === "msl"} onClick={() => p.onGpsAltRef("msl")}>{T("set.gpsalt.msl")}</button>
        <button aria-pressed={p.gpsAltRef === "ellipsoid"} onClick={() => p.onGpsAltRef("ellipsoid")}>{T("set.gpsalt.ellipsoid")}</button>
      </div>
      <p className="muted small">{T("set.gpsalt.help")}</p>

      <h3>{T("unit.altitude")}</h3>
      <div className="choices">
        {UNIT_CHOICES.altitude.map((u) => (
          <button key={u} aria-pressed={prefs.altitude === u} onClick={() => p.setUnit("altitude", u)}>
            {SHORT_LABELS[u] ?? u}
          </button>
        ))}
      </div>
    </aside>
  );
}
