// Postgres char_length counts Unicode code points, not UTF-16 code units.
export function plainText(value: string, maximum: number) {
  const text = value.trim();
  const length = Array.from(text).length;
  if (!length || length > maximum) throw new Error(`Use 1–${maximum} characters (after trimming).`);
  // Postgres text cannot contain NUL or unpaired UTF-16 surrogates.
  if (text.includes("\0") || /[\uD800-\uDFFF]/u.test(text))
    throw new Error("Use valid plain text characters.");
  return text;
}
