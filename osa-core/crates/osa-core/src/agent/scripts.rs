//! The in-sandbox shell scripts the front-end sends through `sandbox exec`.
//!
//! Each script receives its values as positional arguments, so paths with
//! spaces survive, and prints only what the host consumes. The git directory
//! stays outside the worktree, so no `.git` enters the project or a patch.

pub fn init(program: &str) -> String {
    format!(
        "set -e\n\
gitdir=$1 worktree=$2\n\
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree\n\
export GIT_AUTHOR_NAME={program} GIT_AUTHOR_EMAIL={program}@localhost\n\
export GIT_COMMITTER_NAME={program} GIT_COMMITTER_EMAIL={program}@localhost\n\
mkdir -p \"$gitdir\" \"$worktree\"\n\
git init -q\n\
git add -A\n\
tree=$(git write-tree)\n\
commit=$(git commit-tree \"$tree\" -m \"{program} baseline\")\n\
git update-ref refs/{program}/base \"$commit\"\n\
printf \"%s\\n\" \"$tree\""
    )
}

pub fn probe(program: &str) -> String {
    format!(
        "set -e\n\
gitdir=$1 worktree=$2\n\
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree\n\
if ! git rev-parse -q --verify refs/{program}/base >/dev/null 2>&1; then\n    \
printf \"missing\\n\"\n    exit 0\nfi\n\
index=$gitdir/tree-index.$$\n\
rm -f \"$index\"\n\
if ! GIT_INDEX_FILE=$index git add -A 2>/dev/null; then\n    \
rm -f \"$index\"\n    \
printf \"missing\\n\"\n    exit 0\nfi\n\
tree=$(GIT_INDEX_FILE=$index git write-tree)\n\
rm -f \"$index\"\n\
printf \"%s\\n\" \"$tree\""
    )
}

pub fn collect(program: &str) -> String {
    format!(
        "set -e\n\
gitdir=$1 worktree=$2\n\
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree\n\
export GIT_AUTHOR_NAME={program} GIT_AUTHOR_EMAIL={program}@localhost\n\
export GIT_COMMITTER_NAME={program} GIT_COMMITTER_EMAIL={program}@localhost\n\
git add -A\n\
tree=$(git write-tree)\n\
commit=$(git commit-tree \"$tree\" -p refs/{program}/base -m \"{program} result\")\n\
git update-ref refs/{program}/result \"$commit\"\n\
git diff --binary --full-index refs/{program}/base refs/{program}/result"
    )
}

pub fn result_tree(program: &str) -> String {
    format!(
        "set -e\n\
export GIT_DIR=$1\n\
git rev-parse -q --verify refs/{program}/result^{{tree}} 2>/dev/null || true"
    )
}

pub fn advance(program: &str) -> String {
    format!(
        "set -e\n\
export GIT_DIR=$1\n\
git update-ref refs/{program}/base refs/{program}/result"
    )
}

pub const TREE_EMPTY: &str = "set -e\n\
export GIT_DIR=$1\n\
tree=$3\n\
if [ -z \"$tree\" ] || [ -z \"$(git ls-tree -r --name-only \"$tree\" 2>/dev/null | head -n 1)\" ]; then\n    \
printf \"empty\\n\"\nelse\n    \
printf \"nonempty\\n\"\nfi";

pub const WORKDIR_NONEMPTY: &str = "set -e\n\
worktree=$2\n\
if [ -n \"$(find \"$worktree\" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)\" ]; then\n    \
printf \"nonempty\\n\"\nelse\n    \
printf \"empty\\n\"\nfi";

pub const MKDIR: &str = "mkdir -p \"$1\"";

pub fn manifest(program: &str) -> String {
    format!(
        "set -e\n\
export GIT_DIR=$1 GIT_WORK_TREE=$2\n\
git diff --no-renames --name-status refs/{program}/base refs/{program}/result |\n\
while IFS=\"\t\" read -r status path; do\n    \
if hash=$(git rev-parse \"refs/{program}/result:$path\" 2>/dev/null); then\n        \
:\n    else\n        \
hash=-\n    fi\n    \
printf \"%s\\t%s\\t%s\\n\" \"$status\" \"$hash\" \"$path\"\ndone"
    )
}

pub const PRUNE: &str = "set -e\n\
worktree=$2\n\
manifest=$3\n\
while IFS= read -r path; do\n    \
case $path in\n        \
\"\"|/*|..|../*|*/..|*/../*) continue ;;\n    \
esac\n    \
target=$worktree/$path\n    \
if [ -f \"$target\" ] || [ -L \"$target\" ]; then\n        \
rm -f -- \"$target\"\n    \
fi\n\
done < \"$manifest\"\n\
rm -f -- \"$manifest\"";
