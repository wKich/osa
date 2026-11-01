//! Byte-for-byte format goldens: each published document kind is written by
//! the Rust writer and must match the committed golden.

use std::fs;
use std::path::PathBuf;

use osa_core::entries::{Config, PendingMarker, RegistryEntry};
use osa_core::flat::FlatEntry;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/golden")
        .join(name)
}

fn golden(name: &str) -> String {
    fs::read_to_string(fixture(name)).expect("golden fixture")
}

#[test]
fn a_fresh_registry_entry_matches_the_golden_byte_for_byte() {
    let entry = RegistryEntry {
        version: "1".to_string(),
        agent: "mk".to_string(),
        host_path: "/home/me/project".to_string(),
        project: "project".to_string(),
        sandbox_name: "maki-project-1a2b".to_string(),
        sandbox_id: "id-1a2b".to_string(),
        created: "2026-01-02T03:04:05Z".to_string(),
        last_session: "2026-01-02T03:05:06Z".to_string(),
        fingerprint: Some("abcdef-123-456".to_string()),
    };
    let written = entry.to_flat().expect("valid entry").to_text();
    assert_eq!(written, golden("registry-entry.toml"));
}

#[test]
fn a_fresh_registry_entry_omits_an_absent_fingerprint() {
    let entry = RegistryEntry {
        version: "1".to_string(),
        agent: "mk".to_string(),
        host_path: "/home/me/plain".to_string(),
        project: "plain".to_string(),
        sandbox_name: "maki-plain-0000".to_string(),
        sandbox_id: "".to_string(),
        created: "2026-01-02T03:04:05Z".to_string(),
        last_session: "".to_string(),
        fingerprint: None,
    };
    let written = entry.to_flat().expect("valid entry").to_text();
    assert!(!written.contains("fingerprint"), "{written}");
    assert!(written.ends_with("last_session = \"\"\n"), "{written}");
}

#[test]
fn a_pending_marker_matches_the_golden_byte_for_byte() {
    let marker = PendingMarker {
        version: "1".to_string(),
        kind: "retained".to_string(),
        patch: "/home/me/.local/state/osa/sessions/maki-project-1a2b/retained.patch".to_string(),
        sandbox: "maki-project-1a2b".to_string(),
        sandbox_id: "id-1a2b".to_string(),
        created: "2026-01-02T03:06:07Z".to_string(),
        reason: "the sandbox changed files the host did not".to_string(),
        result_tree: "tree-1a2b".to_string(),
    };
    let written = marker.to_flat().expect("valid marker").to_text();
    assert_eq!(written, golden("pending-marker.toml"));
}

#[test]
fn a_config_omits_absent_keys_in_documented_order() {
    let mut config = Config::default();
    config.set("idle_stop", "1h");
    config.set("image", "maki-agent:local");
    config.set("engine", "docker");
    let written = config.to_flat().expect("valid config").to_text();
    assert_eq!(written, golden("config.toml"));

    let parsed = FlatEntry::parse(&golden("config.toml")).entry;
    let round_trip = Config::from_flat(&parsed).to_flat().expect("valid config");
    assert_eq!(round_trip.to_text(), written);
}
