// Validate canonical UUID shape, without restricting database-supported versions.
export function isUuid(value: string): boolean {
  return (
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
