export interface PickerOption {
  value: string;
  label: string;
}

/** 0 = the label starts with the term, 1 = a word in it does, 2 = matched elsewhere. */
function rank(label: string, term: string): number {
  if (label.startsWith(term)) return 0;
  if (label.includes(` ${term}`)) return 1;
  return 2;
}

/** The innospace-hub search, so both apps' dropdowns filter alike. */
export function searchOptions(
  options: readonly PickerOption[],
  query: string,
): PickerOption[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...options];

  const hits: { option: PickerOption; rank: number }[] = [];
  for (const option of options) {
    const label = option.label.toLowerCase();
    if (!terms.every((term) => label.includes(term))) continue;
    hits.push({ option, rank: rank(label, terms[0]) });
  }
  // Sort is stable, so equally ranked options keep the order they came in.
  return hits.sort((a, b) => a.rank - b.rank).map((hit) => hit.option);
}
