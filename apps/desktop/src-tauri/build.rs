fn main() {
    generate_workspace_schema_version();
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows-msvc") {
        // Embed the same Common Controls dependency through the linker for every
        // executable, including unit tests. Do not also embed a resource manifest:
        // MSVC rejects two manifests with the same resource identifier.
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("Tauri build configuration must be valid");
    } else {
        tauri_build::build();
    }

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

    println!("cargo:rustc-env=DATAPAD_BUILD_TARGET={target}");
    if target.contains("windows-msvc") {
        println!("cargo:rustc-link-arg=/STACK:16777216");
        // Unit/integration executables also link Tauri's TaskDialogIndirect path.
        // Unlike the app bundle, their default manifests do not request comctl32 v6.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    } else if target.contains("windows-gnu") {
        println!("cargo:rustc-link-arg=-Wl,--stack,16777216");
    }
}

fn generate_workspace_schema_version() {
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be available"),
    );
    let source = manifest_dir.join("../../../packages/shared-types/src/workspace-schema.ts");
    println!("cargo:rerun-if-changed={}", source.display());
    let contents = std::fs::read_to_string(&source)
        .unwrap_or_else(|error| panic!("Unable to read {}: {error}", source.display()));
    let marker = "CURRENT_WORKSPACE_SCHEMA_VERSION =";
    let version = contents
        .lines()
        .find_map(|line| {
            let (_, value) = line.split_once(marker)?;
            value
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<u32>().ok())
        })
        .expect("workspace-schema.ts must declare CURRENT_WORKSPACE_SCHEMA_VERSION");
    let output =
        std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR must be available"))
            .join("workspace_schema_version.rs");
    std::fs::write(
        output,
        format!("pub const SCHEMA_VERSION: u32 = {version};\n"),
    )
    .expect("workspace schema Rust constant should be generated");
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
