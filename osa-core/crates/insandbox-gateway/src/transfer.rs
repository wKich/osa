//! File transfer as copies into and out of a sandbox's filesystem.
//!
//! There is no bind mount and no containment claim: the outer sandbox is the
//! boundary. What this module does enforce is the plane's own contract — a
//! path that resolves outside the sandbox directory, including through a
//! symlink, is refused before anything is written, and the refusal names the
//! path.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use crate::state::DEFAULT_WORKDIR;

/// How deep a copied tree may nest before the copy is refused.
const MAX_DEPTH: usize = 64;

/// A refused transfer. The path is the request's, so the message is
/// diagnosable without the resolved filesystem path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferError {
    pub path: String,
    pub detail: String,
}

impl TransferError {
    fn refused(path: &str, detail: impl Into<String>) -> Self {
        TransferError {
            path: path.to_string(),
            detail: detail.into(),
        }
    }

    fn io(path: &str, error: io::Error) -> Self {
        TransferError::refused(path, error.to_string())
    }
}

impl std::fmt::Display for TransferError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "refusing path '{}': {}", self.path, self.detail)
    }
}

impl std::error::Error for TransferError {}

/// Resolve an exec workdir. Empty means the default workdir; the resolved
/// directory must exist and stay inside the sandbox.
pub fn workdir(root: &Path, requested: &str) -> Result<PathBuf, TransferError> {
    let requested = if requested.is_empty() {
        DEFAULT_WORKDIR.to_string()
    } else {
        requested.to_string()
    };
    let resolved = resolve_for_read(root, &requested)?;
    if !resolved.is_dir() {
        return Err(TransferError::refused(
            &requested,
            "the exec workdir is not a directory",
        ));
    }
    Ok(resolved)
}

/// Copy `local` into the sandbox filesystem at `dest`. Returns the resolved
/// destination path, which is always under `root`.
pub fn upload(root: &Path, local: &Path, dest: &str) -> Result<PathBuf, TransferError> {
    let root = canonical_root(root)?;
    let dest = if dest.is_empty() { "." } else { dest };
    let target = resolve_for_write(&root, dest)?;

    if !local.exists() {
        return Err(TransferError::refused(
            &local.display().to_string(),
            "the upload source does not exist",
        ));
    }

    if local.is_dir() {
        fs::create_dir_all(&target).map_err(|error| TransferError::io(dest, error))?;
        copy_tree_in(&root, local, dest, 0)?;
        return Ok(target);
    }

    let target = if dest.ends_with('/') || target.is_dir() {
        let name = local
            .file_name()
            .map(PathBuf::from)
            .ok_or_else(|| TransferError::refused(dest, "the upload source has no file name"))?;
        target.join(name)
    } else {
        target
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| TransferError::io(dest, error))?;
    }
    copy_over(local, &target, dest)?;
    Ok(target)
}

/// Copy `source` onto `target`, replacing an existing file. A previous upload
/// copied the source's permissions, so a read-only file (a git object, for
/// example) would otherwise refuse the overwrite; replacing it is what an
/// upload means.
fn copy_over(source: &Path, target: &Path, requested: &str) -> Result<(), TransferError> {
    if target.is_file() {
        fs::remove_file(target).map_err(|error| TransferError::io(requested, error))?;
    }
    fs::copy(source, target).map_err(|error| TransferError::io(requested, error))?;
    Ok(())
}

/// Copy the sandbox path `sandbox_path` out to `local_dest`. Returns the
/// resolved local path.
pub fn download(
    root: &Path,
    sandbox_path: &str,
    local_dest: &Path,
) -> Result<PathBuf, TransferError> {
    let root = canonical_root(root)?;
    let source = resolve_for_read(&root, sandbox_path)?;

    if source.is_dir() {
        fs::create_dir_all(local_dest).map_err(|error| TransferError::io(sandbox_path, error))?;
        copy_tree_out(&root, &source, local_dest, sandbox_path, 0)?;
        return Ok(local_dest.to_path_buf());
    }

    let dest = if local_dest.is_dir() {
        let name = source
            .file_name()
            .map(PathBuf::from)
            .ok_or_else(|| TransferError::refused(sandbox_path, "the file has no name"))?;
        local_dest.join(name)
    } else {
        local_dest.to_path_buf()
    };
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| TransferError::io(sandbox_path, error))?;
        }
    }
    fs::copy(&source, &dest).map_err(|error| TransferError::io(sandbox_path, error))?;
    Ok(dest)
}

fn canonical_root(root: &Path) -> Result<PathBuf, TransferError> {
    fs::canonicalize(root).map_err(|error| TransferError::io(&root.display().to_string(), error))
}

/// Resolve a sandbox path for reading. The resolved path must exist and stay
/// under the sandbox root; a symlink that points outside is refused.
pub fn resolve_for_read(root: &Path, requested: &str) -> Result<PathBuf, TransferError> {
    let root = canonical_root(root)?;
    let candidate = root.join(clean_relative(requested)?);
    let resolved = fs::canonicalize(&candidate).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => {
            TransferError::refused(requested, "the path does not exist in the sandbox")
        }
        _ => TransferError::io(requested, error),
    })?;
    ensure_inside(&root, &resolved, requested)?;
    Ok(resolved)
}

/// Resolve a sandbox path for writing. Every existing ancestor is
/// canonicalized and checked, so a symlinked directory cannot redirect the
/// write outside the sandbox. Missing components are created later by the
/// copy, after this check.
pub fn resolve_for_write(root: &Path, requested: &str) -> Result<PathBuf, TransferError> {
    let root = canonical_root(root)?;
    let relative = clean_relative(requested)?;

    let mut current = root.clone();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(TransferError::refused(
                requested,
                "the path is not a plain sandbox path",
            ));
        };
        if missing.is_empty() {
            let next = current.join(name);
            match fs::symlink_metadata(&next) {
                Ok(_) => {
                    let resolved = fs::canonicalize(&next)
                        .map_err(|error| TransferError::io(requested, error))?;
                    ensure_inside(&root, &resolved, requested)?;
                    current = resolved;
                    continue;
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(TransferError::io(requested, error)),
            }
        }
        missing.push(name.to_os_string());
    }
    for name in missing {
        current.push(name);
    }
    ensure_inside(&root, &current, requested)?;
    Ok(current)
}

/// Turn a sandbox path into a path relative to the sandbox root. A relative
/// request resolves against the default workdir, and `..` may not climb above
/// the root.
fn clean_relative(requested: &str) -> Result<PathBuf, TransferError> {
    if requested.contains('\0') {
        return Err(TransferError::refused(
            requested,
            "the path contains a NUL byte",
        ));
    }
    let stripped = if let Some(absolute) = requested.strip_prefix('/') {
        absolute.to_string()
    } else if requested.is_empty() || requested == "." {
        DEFAULT_WORKDIR.trim_start_matches('/').to_string()
    } else {
        format!("{}/{}", DEFAULT_WORKDIR.trim_start_matches('/'), requested)
    };

    let mut parts: Vec<&str> = Vec::new();
    for part in stripped.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(TransferError::refused(
                        requested,
                        "the path escapes the sandbox directory",
                    ));
                }
            }
            other => parts.push(other),
        }
    }
    Ok(parts.iter().collect())
}

fn ensure_inside(root: &Path, candidate: &Path, requested: &str) -> Result<(), TransferError> {
    if candidate.starts_with(root) {
        Ok(())
    } else {
        Err(TransferError::refused(
            requested,
            "the path resolves outside the sandbox directory",
        ))
    }
}

fn join_request(dest: &str, name: &str) -> String {
    if dest.is_empty() || dest == "." {
        name.to_string()
    } else if dest.ends_with('/') {
        format!("{dest}{name}")
    } else {
        format!("{dest}/{name}")
    }
}

fn copy_tree_in(
    root: &Path,
    source: &Path,
    dest_request: &str,
    depth: usize,
) -> Result<(), TransferError> {
    if depth > MAX_DEPTH {
        return Err(TransferError::refused(
            dest_request,
            "the upload tree is nested too deeply",
        ));
    }
    let entries = fs::read_dir(source)
        .map_err(|error| TransferError::io(&source.display().to_string(), error))?;
    for entry in entries {
        let entry = entry.map_err(|error| TransferError::io(dest_request, error))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_request = join_request(dest_request, &name);
        let target = resolve_for_write(root, &child_request)?;
        // Follow the source's links: reading outside the sandbox is allowed,
        // writing outside it is not.
        let metadata =
            fs::metadata(entry.path()).map_err(|error| TransferError::io(&child_request, error))?;
        if metadata.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| TransferError::io(&child_request, error))?;
            copy_tree_in(root, &entry.path(), &child_request, depth + 1)?;
        } else if metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| TransferError::io(&child_request, error))?;
            }
            copy_over(&entry.path(), &target, &child_request)?;
        }
        // Sockets, pipes, and devices are not copied; a sandbox exec cannot
        // use the host's anyway.
    }
    Ok(())
}

fn copy_tree_out(
    root: &Path,
    source: &Path,
    dest: &Path,
    requested: &str,
    depth: usize,
) -> Result<(), TransferError> {
    if depth > MAX_DEPTH {
        return Err(TransferError::refused(
            requested,
            "the download tree is nested too deeply",
        ));
    }
    let entries = fs::read_dir(source)
        .map_err(|error| TransferError::io(&source.display().to_string(), error))?;
    for entry in entries {
        let entry = entry.map_err(|error| TransferError::io(requested, error))?;
        let name = entry.file_name();
        let sandbox_entry = join_request(requested, &name.to_string_lossy());
        let local = dest.join(&name);
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| TransferError::io(&sandbox_entry, error))?;
        if metadata.file_type().is_symlink() {
            let target = fs::canonicalize(entry.path())
                .map_err(|error| TransferError::io(&sandbox_entry, error))?;
            ensure_inside(root, &target, &sandbox_entry)?;
            if target.is_dir() {
                fs::create_dir_all(&local)
                    .map_err(|error| TransferError::io(&sandbox_entry, error))?;
                copy_tree_out(root, &target, &local, &sandbox_entry, depth + 1)?;
            } else {
                fs::copy(&target, &local)
                    .map_err(|error| TransferError::io(&sandbox_entry, error))?;
            }
        } else if metadata.is_dir() {
            fs::create_dir_all(&local).map_err(|error| TransferError::io(&sandbox_entry, error))?;
            copy_tree_out(root, &entry.path(), &local, &sandbox_entry, depth + 1)?;
        } else if metadata.is_file() {
            fs::copy(entry.path(), &local)
                .map_err(|error| TransferError::io(&sandbox_entry, error))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "osa-insandbox-transfer-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("root/sandbox/project")).expect("root");
        dir
    }

    #[test]
    fn a_round_trip_is_byte_identical() {
        let dir = scratch("round-trip");
        let root = dir.join("root");
        let local = dir.join("local.txt");
        fs::write(&local, b"payload\n").expect("local");

        let uploaded = upload(&root, &local, "/sandbox/project/local.txt").expect("upload");
        assert!(uploaded.is_file());
        assert!(!uploaded.is_symlink());
        assert!(uploaded.starts_with(fs::canonicalize(&root).expect("canonical root")));

        let out = dir.join("out.txt");
        download(&root, "/sandbox/project/local.txt", &out).expect("download");
        assert_eq!(
            fs::read(&local).expect("local"),
            fs::read(&out).expect("out")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_upload_replaces_a_read_only_file() {
        let dir = scratch("read-only");
        let root = dir.join("root");
        let local = dir.join("local.txt");
        fs::write(&local, b"first\n").expect("local");
        let target = upload(&root, &local, "/sandbox/project/local.txt").expect("first upload");

        fs::set_permissions(&target, fs::Permissions::from_mode(0o444)).expect("read-only");
        fs::write(&local, b"second\n").expect("local");
        upload(&root, &local, "/sandbox/project/local.txt").expect("second upload");
        assert_eq!(fs::read(&target).expect("target"), b"second\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_symlink_escape_is_refused_before_writing() {
        let dir = scratch("escape");
        let root = dir.join("root");
        let outside = dir.join("outside.txt");
        fs::write(&outside, b"inert\n").expect("outside");
        std::os::unix::fs::symlink(&outside, root.join("sandbox/project/escape")).expect("symlink");

        let error =
            download(&root, "/sandbox/project/escape", &dir.join("stolen")).expect_err("refused");
        assert!(error.to_string().contains("escape"), "{error}");
        assert_eq!(fs::read(&outside).expect("outside"), b"inert\n");
        assert!(!dir.join("stolen").exists());

        let error = upload(&root, &dir.join("outside.txt"), "/sandbox/project/escape")
            .expect_err("refused");
        assert!(error.to_string().contains("escape"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lexical_escapes_are_refused() {
        let dir = scratch("lexical");
        let root = dir.join("root");
        let error = resolve_for_write(&root, "/../escape").expect_err("refused");
        assert!(error.to_string().contains("escapes"), "{error}");
        let error = resolve_for_write(&root, "../../escape").expect_err("refused");
        assert!(error.to_string().contains("escapes"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }
}
