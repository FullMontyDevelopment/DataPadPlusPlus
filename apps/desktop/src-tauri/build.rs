fn main() {
    tauri_build::build();

    println!("cargo:rerun-if-env-changed=DATAPADPLUSPLUS_REQUIRE_UPDATER_SIGNING");
    println!("cargo:rerun-if-env-changed=DATAPADPLUSPLUS_UPDATER_PUBKEY");
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBKEY");

    let updater_public_key = updater_public_key();
    if let Some(pubkey) = updater_public_key.as_deref() {
        println!("cargo:rustc-env=DATAPADPLUSPLUS_UPDATER_PUBKEY={pubkey}");
    }

    if updater_signing_required() && updater_public_key.is_none() {
        panic!(
            "DATAPADPLUSPLUS_REQUIRE_UPDATER_SIGNING is enabled, but no updater public key was provided. Set DATAPADPLUSPLUS_UPDATER_PUBKEY or TAURI_UPDATER_PUBKEY for release builds."
        );
    }

    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows-msvc") {
        println!("cargo:rustc-link-arg=/STACK:16777216");
    } else if target.contains("windows-gnu") {
        println!("cargo:rustc-link-arg=-Wl,--stack,16777216");
    }
}

fn updater_signing_required() -> bool {
    matches!(
        std::env::var("DATAPADPLUSPLUS_REQUIRE_UPDATER_SIGNING")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

fn updater_public_key() -> Option<String> {
    std::env::var("DATAPADPLUSPLUS_UPDATER_PUBKEY")
        .or_else(|_| std::env::var("TAURI_UPDATER_PUBKEY"))
        .ok()
        .map(|value| value.trim().replace(['\r', '\n'], ""))
        .filter(|value| !value.is_empty())
}
