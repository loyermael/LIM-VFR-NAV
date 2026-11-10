// Pont UDP -> WebSocket pour L!M VFR Nav.
// Un navigateur ne sait pas écouter l'UDP : ce petit programme, lancé sur l'ordinateur (ou un Raspberry Pi) relié au récepteur
// ADS-B / FLARM ou au simulateur, reçoit les datagrammes et les retransmet à l'appli par WebSocket.
//
//   node tools/bridge.mjs                      écoute GDL90 (4000), X-Plane (49002), NMEA FLARM (10110) ; WebSocket sur 127.0.0.1:8765
//   node tools/bridge.mjs --simulate           émet un faux flux (avion + 2 cibles) pour essayer sans matériel
//   node tools/bridge.mjs --host 0.0.0.0       ouvre le WebSocket au réseau local (tablette) : n'importe qui sur ce réseau peut lire le flux
//
// Message envoyé à l'appli (texte JSON) : {"k":"gdl90"|"xplane"|"nmea","d":"<base64 du datagramme>"}.
import dgram from "node:dgram";
import { WebSocketServer } from "ws";
import { frameGdl90, encodeReport } from "../packages/core/src/gdl90.ts";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const host = opt("host", "127.0.0.1");
const wsPort = Number(opt("ws", 8765));
const ports = { gdl90: Number(opt("gdl90", 4000)), xplane: Number(opt("xplane", 49002)), nmea: Number(opt("nmea", 10110)) };
const simulate = args.includes("--simulate");

const wss = new WebSocketServer({ host, port: wsPort });
const send = (k, buf) => {
  const msg = JSON.stringify({ k, d: Buffer.from(buf).toString("base64") });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
};
wss.on("listening", () => console.log(`WebSocket sur ws://${host}:${wsPort}`));
wss.on("connection", () => console.log("appli connectée"));

if (!simulate) {
  for (const [k, port] of Object.entries(ports)) {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.on("message", (m) => send(k, m));
    s.on("error", (e) => console.error(`UDP ${k} :${port} — ${e.message}`));
    s.bind(port, () => console.log(`UDP ${k} sur le port ${port}`));
  }
} else {
  console.log("MODE SIMULATION : faux flux autour de 46,6°N 2,35°E (aucun matériel écouté)");
  const C = { lat: 46.6, lon: 2.35 }, R = 3 * 1852, V = 90 * 1852 / 3600, rad = Math.PI / 180;
  const at = (theta, r, dalt) => ({
    lat: C.lat + (r * Math.cos(theta)) / 111320,
    lon: C.lon + (r * Math.sin(theta)) / (111320 * Math.cos(C.lat * rad)),
    track: (((theta / rad) + 90) % 360 + 360) % 360,
  });
  const report = (address, callsign, p, alt, alert = false) => ({
    address, addressType: 0, alert, lat: p.lat, lon: p.lon, pressureAltitudeM: alt, groundSpeedMps: V, verticalSpeedMps: 0,
    track: p.track, airborne: true, callsign, emitterCategory: 1,
  });
  const nmeaSum = (b) => [...b].reduce((c, ch) => c ^ ch.charCodeAt(0), 0).toString(16).toUpperCase().padStart(2, "0");
  const t0 = Date.now();
  setInterval(() => {
    const t = (Date.now() - t0) / 1000, th = (V / R) * t;
    const own = at(th, R), alt = 1000;
    const hb = Uint8Array.from([0, 0x81, 0x01, 0, 0, 0, 0]);
    send("gdl90", Buffer.concat([
      frameGdl90(hb),
      frameGdl90(encodeReport(10, report("ABCDEF", "OWN", own, alt))),
      // cible 1 : même cercle, un peu devant (≈ 1 km), 200 m plus haut → attention/alerte de proximité
      frameGdl90(encodeReport(20, report("3944EF", "FGTRF", at(th + 1000 / R, R, 0), alt + 200))),
      // cible 2 : cercle en sens inverse, loin, plus bas
      frameGdl90(encodeReport(20, report("3944F0", "LOIN", at(-th * 0.5 + 2, R * 1.8, 0), alt - 600))),
    ]));
    // cible FLARM à 3 km au nord-est, 80 m plus haut
    const body = "PFLAA,0,2100,2100,80,2,DD8F12,45,,25,0,1";
    send("nmea", Buffer.from(`$${body}*${nmeaSum(body)}\r\n`));
  }, 1000);
}
