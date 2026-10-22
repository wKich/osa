#!/bin/sh
# Creates the small fixture repo the live oskhs checks run against:
#   make-fixture.sh DIR
# main holds calc.py and a README with a secret word; branch `feature` adds
# notes.txt. Deterministic content, fixed author, so reruns look the same.
set -eu
dir=$1
rm -rf "$dir"
git init -q -b main "$dir"
cd "$dir"
git config user.name oskhs-fixture
git config user.email fixture@oskhs.invalid
printf 'def add(a, b):\n    return a + b\n' > calc.py
printf '# fx\n\nTiny oskhs fixture. The secret word is PELICAN.\n' > README.md
git add -A
git commit -qm "init fixture"
git checkout -qb feature
printf 'feature branch notes: the codename is HERON.\n' > notes.txt
git add -A
git commit -qm "add feature notes"
git checkout -q main
