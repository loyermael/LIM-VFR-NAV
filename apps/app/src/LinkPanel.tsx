import { streamState } from "@lim/core";
import { t, type Key, type Lang } from "./i18n";
import { validLinkUrl, type LinkConfig } from "./useLink";
import type { LinkConnection } from "./linkClient";

export interface LinkStats {
  readonly lastMsgMs: number | null;
  readonly messages: number;
  readonly badCrc: number;
  readonly flarmRx: number | null;
  readonly targets: number;
}

const CONN_KEYS: Record<LinkConnection, Key> = { idle: "lk.conn.idle", connecting: "lk.conn.connecting", open: "lk.conn.open", closed: "lk.conn.closed" };
const STREAM_KEYS = { none: "lk.stream.none", ok: "lk.stream.ok", stale: "lk.stream.stale", lost: "lk.stream.lost" } as const;

/** Réglages « Connectivité » : pont UDP → WebSocket (récepteur ADS-B / FLARM, simulateur). */
export function LinkPanel(p: { lang: Lang; config: LinkConfig; onConfig: (c: LinkConfig) => void; conn: LinkConnection; stats: LinkStats; nowMs: number }) {
  const T = (k: Key) => t(p.lang, k);
  const c = p.config;
  const urlOk = validLinkUrl(c.url);
  const stream = streamState(p.stats.lastMsgMs, p.nowMs);
  return (
    <div>
      <h3>{T("lk.title")}</h3>
      <p className="muted small">{T("lk.help")}</p>
      <div className="choices">
        <button aria-pressed={c.enabled} onClick={() => p.onConfig({ ...c, enabled: !c.enabled })}>{c.enabled ? T("lk.on") : T("lk.off")}</button>
        <button aria-pressed={c.useOwnship} onClick={() => p.onConfig({ ...c, useOwnship: !c.useOwnship })}>{T("lk.ownship")}</button>
      </div>
      <label className="numfield">
        <span>{T("lk.url")}</span>
        <input className="field" defaultValue={c.url} key={c.url} spellCheck={false} onBlur={(e) => { const v = e.target.value.trim(); if (validLinkUrl(v)) p.onConfig({ ...c, url: v }); else e.target.value = c.url; }} />
      </label>
      {!urlOk && <p className="error" role="alert">{T("lk.badUrl")}</p>}
      {c.enabled && (
        <table className="navlog"><tbody>
          <tr><td className="legname">{T("lk.conn")}</td><td>{T(CONN_KEYS[p.conn])}</td></tr>
          <tr><td className="legname">{T("lk.stream")}</td><td>{T(STREAM_KEYS[stream])}{p.stats.lastMsgMs !== null ? ` (${Math.max(0, Math.round((p.nowMs - p.stats.lastMsgMs) / 1000))} s)` : ""}</td></tr>
          <tr><td className="legname">{T("lk.messages")}</td><td>{p.stats.messages}{p.stats.badCrc > 0 ? ` · ${p.stats.badCrc} ${T("lk.badCrc")}` : ""}</td></tr>
          <tr><td className="legname">{T("lk.targets")}</td><td>{p.stats.targets}{p.stats.flarmRx !== null ? ` · FLARM ${p.stats.flarmRx}` : ""}</td></tr>
        </tbody></table>
      )}
      <p className="muted small">{T("lk.note")}</p>
    </div>
  );
}
