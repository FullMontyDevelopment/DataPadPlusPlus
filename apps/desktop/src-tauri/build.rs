fn main() {
    tauri_build::build();

    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows-msvc") {
        println!("cargo:rustc-link-arg=/STACK:16777216");
    } else if target.contains("windows-gnu") {
        println!("cargo:rustc-link-arg=-Wl,--stack,16777216");
    }
}
