import { useCallback, useEffect, useRef, useState } from "react";
import type { GpsFix, LatLon } from "@lim/core";
import { LinkClient, type LinkConnection } from "./linkClient";
import { LinkDecoder } from "./linkDecoder";

export interface LinkConfig {
  readonly enabled: boolean;
  /** Adresse WebSocket du pont (ws:// ou wss://). */
  readonly url: string;
  /** La position de l'avion vient du flux externe (récepteur, simulateur) et non du GPS de l'appareil. */
  readonly useOwnship: boolean;
}

export const DEFAULT_LINK: LinkConfig = { enabled: false, url: "ws://localhost:8765", useOwnship: false };
const KEY = "lim.link.v1";

/** Seules les adresses ws:// et wss:// sont acceptées. */
export const validLinkUrl = (u: string): boolean => /^wss?:\/\/[^\s/]+(:\d+)?(\/\S*)?$/i.test(u.trim());

export function parseLinkConfig(raw: unknown): LinkConfig {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const url = typeof o["url"] === "string" && validLinkUrl(o["url"]) ? o["url"].trim() : DEFAULT_LINK.url;
  return { enabled: o["enabled"] === true, url, useOwnship: o["useOwnship"] === true };
}

export function loadLinkConfig(): LinkConfig {
  try {
    return parseLinkConfig(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_LINK;
  }
}

/** Liaison avec le pont UDP (récepteur ADS-B / FLARM, simulateur) : trafic et position externe. */
export function useLink(deviceOwnPos: () => LatLon | null, onFix: (f: GpsFix) => void) {
  const [config, setConfigState] = useState<LinkConfig>(loadLinkConfig);
  const [conn, setConn] = useState<LinkConnection>("idle");
  const cfg = useRef(config);
  cfg.current = config;
  const pos = useRef(deviceOwnPos);
  pos.current = deviceOwnPos;
  const fixCb = useRef(onFix);
  fixCb.current = onFix;
  const decoder = useRef<LinkDecoder>(new LinkDecoder(() => pos.current(), (f) => cfg.current.useOwnship && fixCb.current(f)));

  useEffect(() => {
    if (!config.enabled || !validLinkUrl(config.url)) {
      setConn("idle");
      return;
    }
    const client = new LinkClient(config.url, (k, d) => decoder.current.handle(k, d, Date.now()), setConn);
    client.start();
    return () => {
      client.stop();
      decoder.current.table.clear();
    };
  }, [config.enabled, config.url]);

  const setConfig = useCallback((c: LinkConfig) => {
    setConfigState(c);
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* stockage bloqué */
    }
  }, []);
  return { config, setConfig, conn, decoder: decoder.current };
}
