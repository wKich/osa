//! The parser oracle: every recorded fixture must reproduce the `awk`
//! parser's output, its diagnostics, and its exit status.

use std::fs;
use std::path::PathBuf;

use osa_core::flat::FlatEntry;

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/flat-corpus")
}

#[test]
fn the_rust_parser_reproduces_every_recorded_awk_line() {
    let dir = corpus();
    let mut fixtures = 0;
    let mut recorded_lines = 0;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .expect("corpus directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
        .filter_map(|path| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
        })
        .collect();
    names.sort();
    for name in names {
        let text = fs::read_to_string(dir.join(format!("{name}.toml"))).expect("fixture");
        let parsed = FlatEntry::parse(&text);

        let expected_out = fs::read_to_string(dir.join(format!("{name}.out"))).expect("recording");
        recorded_lines += expected_out.lines().count();
        assert_eq!(parsed.entry.to_tsv(), expected_out, "pairs for {name}");

        let expected_err = fs::read_to_string(dir.join(format!("{name}.err"))).expect("recording");
        let mut problems = String::new();
        for problem in &parsed.problems {
            problems.push_str(&format!(
                "{name}.toml:{}: {}\n",
                problem.line, problem.message
            ));
        }
        assert_eq!(problems, expected_err, "diagnostics for {name}");

        let expected_rc = fs::read_to_string(dir.join(format!("{name}.rc"))).expect("recording");
        let actual_rc = if parsed.is_ok() { "0" } else { "1" };
        assert_eq!(actual_rc, expected_rc.trim(), "exit status for {name}");
        fixtures += 1;
    }
    assert!(fixtures >= 12, "the corpus lost fixtures: {fixtures}");
    assert!(
        recorded_lines >= 15,
        "the corpus lost recorded lines: {recorded_lines}"
    );
}
