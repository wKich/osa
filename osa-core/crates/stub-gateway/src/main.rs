//! Offline OpenShell gateway for the test suite: the seam the suite needs,
//! spoken as gRPC so the typed client runs with no Docker, no gateway, and no
//! network.
//!
//! `STUB_STATE_DIR` and `STUB_LOG` are the same variables the CLI stub reads;
//! `STUB_GATEWAY_PORT` picks a port (0 means one chosen by the kernel, printed
//! on stdout so the suite can point discovery at it).

use stub_gateway::Stub;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stub = Stub::from_env();
    let port = std::env::var("STUB_GATEWAY_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(0);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    let addr = listener.local_addr()?;
    // The suite reads this line to learn the port it was given.
    println!("stub-gateway listening on http://{addr}");
    let incoming = tokio_stream::wrappers::TcpListenerStream::new(listener);
    tonic::transport::Server::builder()
        .add_service(stub.into_server())
        .serve_with_incoming(incoming)
        .await?;
    Ok(())
}
