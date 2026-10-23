/** pluralize(1, "file") → "1 file"; pluralize(3, "file") → "3 files". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
