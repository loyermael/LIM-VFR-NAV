import { useState } from "react";
import { t, type Key, type Lang } from "./i18n";
import { BackupError, exportBackup, importBackup } from "./backup";
import { downloadFile } from "./download";

/** Réglages « Sauvegarde » : copier ses routes, avions, traces et réglages d'un appareil à l'autre, sans serveur. */
export function BackupPanel(p: { lang: Lang }) {
  const T = (k: Key) => t(p.lang, k);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  return (
    <div>
      <h3>{T("bk.title")}</h3>
      <p className="muted small">{T("bk.help")}</p>
      <div className="choices">
        <button
          onClick={async () => {
            try {
              downloadFile(`lim-vfr-nav-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), "application/json");
              setMsg({ text: T("bk.exported"), error: false });
            } catch (e) {
              setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
            }
          }}
        >
          {T("bk.export")}
        </button>
        <label className="filebtn">
          <span className="button">{T("bk.import")}</span>
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const c = await importBackup(await f.text());
                setMsg({ text: `${T("bk.imported")} : ${c.routes} ${T("bk.routes")}, ${c.aircraft} ${T("bk.aircraft")}, ${c.tracks} ${T("bk.tracks")}.`, error: false });
                setTimeout(() => location.reload(), 2000);
              } catch (err) {
                setMsg({ text: `${T("bk.failed")} : ${err instanceof BackupError || err instanceof Error ? err.message : String(err)}`, error: true });
              }
            }}
          />
        </label>
      </div>
      {msg && <p className={msg.error ? "error" : "muted small"} role={msg.error ? "alert" : "status"}>{msg.text}</p>}
      <p className="muted small">{T("bk.note")}</p>
    </div>
  );
}
