//! Repository guards for the plane's non-guarantee and its absence from the
//! product build. These are cheap, offline checks of files the crate owns.

use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repository root")
}

fn text_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files
}

#[test]
fn examples_never_install_an_openshell_shim_system_wide() {
    let examples = repo_root().join("examples");
    let system_bins = [
        "/usr/bin",
        "/usr/local/bin",
        "/bin",
        "/usr/sbin",
        "/usr/local/sbin",
        "/sbin",
    ];
    for path in text_files(&examples) {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for (number, line) in text.lines().enumerate() {
            if !line.contains("openshell") {
                continue;
            }
            for bin in system_bins {
                assert!(
                    !line.contains(bin),
                    "{}:{} installs a shim under {bin}: {line}",
                    path.display(),
                    number + 1
                );
            }
        }
    }
}

#[test]
fn the_docs_and_the_crate_readme_state_the_non_guarantee() {
    let root = repo_root();
    let readme = Path::new(env!("CARGO_MANIFEST_DIR")).join("README.md");
    let doc = root.join("docs/ai/dev-environment.md");
    for path in [readme, doc] {
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let lowered = text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        assert!(
            lowered.contains("no isolation"),
            "{} must state that the plane provides no isolation",
            path.display()
        );
        assert!(
            lowered.contains("no policy"),
            "{} must state that the plane enforces no policy",
            path.display()
        );
        assert!(
            lowered.contains("outer sandbox") || lowered.contains("real sandbox"),
            "{} must state that its safety comes from the sandbox",
            path.display()
        );
    }
}

#[test]
fn no_product_crate_depends_on_the_plane() {
    let root = repo_root();
    for manifest in [
        root.join("osa-core/crates/osa-core/Cargo.toml"),
        root.join("osa-core/crates/stub-gateway/Cargo.toml"),
    ] {
        let text = std::fs::read_to_string(&manifest)
            .unwrap_or_else(|error| panic!("{}: {error}", manifest.display()));
        assert!(
            !text.contains("insandbox-gateway"),
            "{} must not depend on the dev-only plane",
            manifest.display()
        );
    }
    for path in text_files(&root.join("osa-core/crates/osa-core/src")) {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        assert!(
            !text.contains("insandbox_gateway") && !text.contains("insandbox-gateway"),
            "{} must not link the dev-only plane",
            path.display()
        );
    }
}
