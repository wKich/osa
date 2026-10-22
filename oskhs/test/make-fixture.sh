#!/bin/sh
# Creates the small fixture repo the live oskhs checks run against:
#   make-fixture.sh DIR
# main holds calc.py, a README with a secret word, and data.txt (~300 KB of
# deterministic, poorly compressible lines, so a full bundle is measurably
# larger than a delta); branch `feature` adds notes.txt. Fixed content and
# author, so reruns look the same.
set -eu
dir=$1
rm -rf "$dir"
git init -q -b main "$dir"
cd "$dir"
git config user.name oskhs-fixture
git config user.email fixture@oskhs.invalid
printf 'def add(a, b):\n    return a + b\n' > calc.py
printf '# fx\n\nTiny oskhs fixture. The secret word is PELICAN.\n' > README.md
# a 32-bit LCG keeps the bytes identical across awk implementations
awk 'BEGIN { x = 42; for (i = 0; i < 18000; i++) { x = (x * 1103515245 + 12345) % 4294967296; y = (x * 1103515245 + 12345) % 4294967296; x = y; printf "%08x%08x\n", x, (x * 7 + i) % 4294967296 } }' > data.txt
git add -A
git commit -qm "init fixture"
git checkout -qb feature
printf 'feature branch notes: the codename is HERON.\n' > notes.txt
git add -A
git commit -qm "add feature notes"
git checkout -q main
