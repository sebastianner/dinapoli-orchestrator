/**
 * Splits a normalized query into overlapping 3-char windows and OR-joins
 * them into an FTS5 query string, so a row matches if it shares even ONE
 * trigram with the query - MATCH's default is an implicit AND across every
 * token, which would make a single mistyped character anywhere in the query
 * fail the whole search. Returns null for queries under 3 characters, since
 * the trigram tokenizer can't index (or usefully match) anything shorter -
 * callers should fall back to a plain prefix LIKE in that case.
 *
 * Shared by every fts5(tokenize='trigram') table in the schema (see
 * customers_fts, products_fts) so they all match with the same semantics.
 */
export function buildTrigramMatchQuery(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized.length < 3) return null;
  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    grams.add(normalized.slice(i, i + 3));
  }
  return [...grams].map((g) => `"${g.replace(/"/g, '""')}"`).join(' OR ');
}
