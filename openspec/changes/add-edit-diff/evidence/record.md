# Evidence (2026-10-25)

- jsdiff `createTwoFilesPatch` vs `edit-diff.ts` on five before/after pairs
  (single line, mid-file insert, no final newline, append, empty file):
  byte-identical.
- `see-file-edit-diff` live (Maki 0.6.4): `← Edit notes.txt`, `1 - alpha`,
  `1 + beta`; verdict `parity`.
