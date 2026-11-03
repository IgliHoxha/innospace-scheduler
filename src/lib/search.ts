/** Lowercased with accents dropped, so "celik" and "ÇEL" both find "Çelik". */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
