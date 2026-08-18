// Splits rows into fixed-size chunks for print pagination: fewer rows on the first
// page (a recipient/header block usually eats vertical space there), more room on
// continuation pages.
export function paginateRows<T>(rows: T[], first: number, rest: number): T[][] {
  if (rows.length === 0) return [[]];
  const pages: T[][] = [rows.slice(0, first)];
  for (let i = first; i < rows.length; i += rest) {
    pages.push(rows.slice(i, i + rest));
  }
  return pages;
}
