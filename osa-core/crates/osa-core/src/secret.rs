//! A credential value with no way to print itself: it can only be handed to a
//! child process environment, and it implements neither `Display` nor
//! `Serialize`, so a leak is a compile error rather than a runtime mistake.

use std::fmt;
use std::io::{self, Read};
use std::process::Command;

pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Secret(value.into())
    }

    /// Reads a credential from STDIN and drops one trailing newline, as a
    /// piped `pass show` line carries.
    pub fn from_stdin() -> io::Result<Self> {
        let mut text = String::new();
        io::stdin().read_to_string(&mut text)?;
        if text.ends_with('\n') {
            text.pop();
            if text.ends_with('\r') {
                text.pop();
            }
        }
        Ok(Secret(text))
    }

    /// The only way to use the value: the child process environment.
    pub fn apply_env<'a>(&self, command: &'a mut Command, name: &str) -> &'a mut Command {
        command.env(name, self.0.as_str())
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Resolves to true only when T implements the trait: the inherent
    /// constant on the bounded wrapper wins over the unbounded trait default.
    macro_rules! implements {
        ($value:ty, $trait:path) => {{
            struct Wrapper<T>(std::marker::PhantomData<T>);
            trait DoesNotImplement {
                #[allow(dead_code)]
                const IMPLEMENTS: bool = false;
            }
            impl<T> DoesNotImplement for Wrapper<T> {}
            impl<T: $trait> Wrapper<T> {
                #[allow(dead_code)]
                const IMPLEMENTS: bool = true;
            }
            <Wrapper<$value>>::IMPLEMENTS
        }};
    }

    #[test]
    fn secret_cannot_be_printed_or_serialized() {
        assert!(!implements!(Secret, std::fmt::Display));
        assert!(!implements!(Secret, serde::Serialize));
        assert_eq!(format!("{:?}", Secret::new("value")), "Secret(<redacted>)");
    }

    #[test]
    fn secret_reaches_only_the_child_environment() {
        let secret = Secret::new("fixture-value");
        let mut command = Command::new("sh");
        command.arg("-c").arg(r#"printf %s "$FIXTURE""#);
        secret.apply_env(&mut command, "FIXTURE");
        assert!(
            !command
                .get_args()
                .any(|arg| arg.to_string_lossy().contains("fixture-value")),
            "the value reached argv"
        );
        let output = command.output().expect("child runs");
        assert_eq!(String::from_utf8_lossy(&output.stdout), "fixture-value");
    }
}
