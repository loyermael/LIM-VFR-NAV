/** Télécharge un fichier généré sur l'appareil (aucun réseau). */
export function downloadFile(name: string, content: string | Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const safeName = (s: string): string => s.replace(/[\/:*?"<>|]/g, "_");
