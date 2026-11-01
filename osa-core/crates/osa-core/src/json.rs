//! One serializer for every JSON output. Nothing is assembled by string
//! concatenation; a gateway-supplied document is carried as raw JSON so a
//! pass-through keeps its bytes.

use serde::Serialize;
use serde_json::value::RawValue;

/// One JSON document and its trailing newline.
pub fn line<T>(value: &T) -> String
where
    T: Serialize + ?Sized,
{
    let mut text = serde_json::to_string(value).expect("serializable output");
    text.push('\n');
    text
}

/// Parses a child's JSON document for pass-through, or `None` when it is not a
/// single valid document.
pub fn raw(text: &str) -> Option<Box<RawValue>> {
    RawValue::from_string(text.to_string()).ok()
}

/// A string literal for text that has to carry a gateway value: carriage
/// returns are dropped and newlines stay escaped, so multi-line text remains
/// one literal.
pub fn literal(text: &str) -> String {
    let cleaned: String = text.chars().filter(|ch| *ch != '\r').collect();
    serde_json::to_string(&cleaned).expect("serializable string")
}
