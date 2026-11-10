import type { LinkKind } from "./linkDecoder";

export type LinkConnection = "idle" | "connecting" | "open" | "closed";

const KINDS = new Set<LinkKind>(["gdl90", "xplane", "nmea"]);

/** Décode un message du pont : {"k": type, "d": base64}. Retourne null si le message est mal formé. */
export function parseBridgeMessage(text: string): { kind: LinkKind; data: Uint8Array } | null {
  try {
    const o = JSON.parse(text) as { k?: unknown; d?: unknown };
    if (typeof o.k !== "string" || !KINDS.has(o.k as LinkKind) || typeof o.d !== "string") return null;
    const bin = atob(o.d);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    return { kind: o.k as LinkKind, data };
  } catch {
    return null;
  }
}

/** Connexion WebSocket au pont, avec reconnexion automatique toutes les 3 s tant qu'elle est demandée. */
export class LinkClient {
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: (kind: LinkKind, data: Uint8Array) => void,
    private readonly onState: (s: LinkConnection) => void,
  ) {}

  start(): void {
    this.wanted = true;
    this.open();
  }

  stop(): void {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
    this.onState("idle");
  }

  private open(): void {
    this.onState("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.onState("closed");
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => this.onState("open");
    ws.onmessage = (e) => {
      const m = typeof e.data === "string" ? parseBridgeMessage(e.data) : null;
      if (m) this.onMessage(m.kind, m.data);
    };
    ws.onclose = () => {
      this.onState("closed");
      this.retry();
    };
    ws.onerror = () => ws.close();
  }

  private retry(): void {
    if (!this.wanted) return;
    this.timer = setTimeout(() => this.wanted && this.open(), 3000);
  }
}
