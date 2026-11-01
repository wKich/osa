fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    std::process::exit(osa_core::agent::run(&osa_core::agent::profile::MAKI, args));
}
