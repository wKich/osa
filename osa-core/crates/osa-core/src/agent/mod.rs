//! The four agent front-ends, implemented once and parameterized by profile.

pub mod agents;
pub mod baseline;
pub mod caller;
pub mod cli;
pub mod commands;
pub mod config;
pub mod context;
pub mod failure;
pub mod gateway;
pub mod health;
pub mod idle;
pub mod profile;
pub mod provider_setup;
pub mod resolve;
pub mod scripts;
pub mod session;
pub mod signals;
pub mod usage;

pub use cli::run;
pub use profile::{AgentProfile, CLAUDE, CODEX, MAKI, OPENCODE};
