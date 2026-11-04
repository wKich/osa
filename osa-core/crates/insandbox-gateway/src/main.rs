//! The in-sandbox control plane binary.
//!
//! Two entry shapes:
//!
//! - the plane itself, gated to an osa sandbox and a loopback plaintext bind;
//! - `__openshell`, the private shim's delegate, which serves gateway
//!   information, sandbox upload/download, and the helper scripts' exec form.

use std::ffi::OsString;
use std::process::ExitCode;

use insandbox_gateway::gate::GateError;
use insandbox_gateway::shim;
use insandbox_gateway::Detection;

const USAGE: &str = "\
insandbox-gateway - dev-only OpenShell control plane for one osa sandbox

It enforces no isolation and no policy. Its safety comes only from the osa
sandbox it runs in, and it refuses to start anywhere else.

usage: insandbox-gateway --state-root DIR [--listen IP:PORT]

  --state-root DIR   the directory that holds every sandbox and the shim
                     (required)
  --listen IP:PORT   a loopback bind (default 127.0.0.1:0)
  --help             this text

Bearer tokens and mutual TLS are refused, not downgraded: the plane accepts
plaintext loopback clients only.
";

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if args.first().and_then(|word| word.to_str()) == Some("__openshell") {
        return shim::run(&args[1..]);
    }

    match insandbox_gateway::gate::serve_gated(&args, &Detection::current()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(GateError::Help) => {
            print!("{USAGE}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("insandbox-gateway: {error}");
            ExitCode::from(2)
        }
    }
}
