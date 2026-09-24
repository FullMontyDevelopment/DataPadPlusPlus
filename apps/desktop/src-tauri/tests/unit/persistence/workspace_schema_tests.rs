use super::*;

struct MigrationTestDirectory(PathBuf);
impl MigrationTestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "datapad-schema-tests-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn recovery_files(&self) -> Vec<PathBuf> {
        fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|value| value == "recovery"))
            .collect()
    }
}
impl Drop for MigrationTestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn schema_upgrade_recovery_is_exact_idempotent_and_independent_of_rolling_backup() {
    let directory = MigrationTestDirectory::new();
    let path = directory.0.join("workspace.json");
    let mut legacy = crate::app::runtime::blank_workspace_snapshot();
    legacy.schema_version = 12;
    let original = serde_json::to_string_pretty(&legacy).unwrap();
    fs::write(&path, &original).unwrap();
    assert_eq!(
        read_snapshot_with_backup(&path)
            .unwrap()
            .unwrap()
            .schema_version,
        12
    );
    read_snapshot_with_backup(&path).unwrap();
    let recoveries = directory.recovery_files();
    assert_eq!(recoveries.len(), 1);
    let current = crate::app::runtime::blank_workspace_snapshot();
    write_snapshot_file(&path, &current).unwrap();
    write_snapshot_file(&path, &current).unwrap();
    assert_eq!(fs::read_to_string(&recoveries[0]).unwrap(), original);
    assert_eq!(
        parse_workspace_snapshot(&fs::read_to_string(&path).unwrap())
            .unwrap()
            .schema_version,
        SCHEMA_VERSION
    );
}

#[test]
fn recovery_failure_or_future_schema_never_modifies_the_source() {
    let directory = MigrationTestDirectory::new();
    let path = directory.0.join("workspace.json");
    let mut legacy = crate::app::runtime::blank_workspace_snapshot();
    legacy.schema_version = 12;
    let original = serde_json::to_string(&legacy).unwrap();
    fs::write(&path, &original).unwrap();
    read_snapshot_with_backup(&path).unwrap();
    let recovery = directory.recovery_files().remove(0);
    fs::remove_file(&recovery).unwrap();
    fs::create_dir(&recovery).unwrap(); // deterministic inability to write recovery
    assert_eq!(
        read_snapshot_with_backup(&path).err().unwrap().code,
        "workspace-migration-recovery"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    fs::remove_dir(&recovery).unwrap();
    legacy.schema_version = SCHEMA_VERSION + 1;
    let future = serde_json::to_string(&legacy).unwrap();
    fs::write(&path, &future).unwrap();
    assert_eq!(
        read_snapshot_with_backup(&path).err().unwrap().code,
        "workspace-newer-version"
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), future);
    assert!(directory.recovery_files().is_empty());
}

#[test]
fn recovery_preserves_the_valid_fallback_when_primary_json_is_corrupt() {
    let directory = MigrationTestDirectory::new();
    let path = directory.0.join("workspace.json");
    let mut legacy = crate::app::runtime::blank_workspace_snapshot();
    legacy.schema_version = 12;
    let original = serde_json::to_string(&legacy).unwrap();
    fs::write(&path, "{broken").unwrap();
    fs::write(path.with_extension("json.bak"), &original).unwrap();
    assert_eq!(
        read_snapshot_with_backup(&path)
            .unwrap()
            .unwrap()
            .schema_version,
        12
    );
    assert_eq!(
        fs::read_to_string(&directory.recovery_files()[0]).unwrap(),
        original
    );
}

#[test]
fn parses_missing_schema_as_legacy_and_rejects_malformed_or_future_versions() {
    let snapshot = crate::app::runtime::blank_workspace_snapshot();
    let mut value = serde_json::to_value(snapshot).expect("workspace should serialize");
    value
        .as_object_mut()
        .expect("workspace should be an object")
        .remove("schemaVersion");
    let missing =
        parse_workspace_snapshot(&value.to_string()).expect("missing legacy schema should parse");
    assert_eq!(missing.schema_version, 0);

    value["schemaVersion"] = serde_json::json!("12");
    assert_eq!(
        parse_workspace_snapshot(&value.to_string())
            .err()
            .expect("text schema should fail")
            .code,
        "workspace-schema-version-invalid"
    );

    value["schemaVersion"] = serde_json::json!(SCHEMA_VERSION + 1);
    assert_eq!(
        parse_workspace_snapshot(&value.to_string())
            .err()
            .expect("future schema should fail")
            .code,
        "workspace-newer-version"
    );
}

#[test]
fn failed_switch_restores_only_registry_selection_not_either_workspace_file() {
    let directory = MigrationTestDirectory::new();
    let current = crate::app::runtime::blank_workspace_snapshot();
    let mut legacy = current.clone();
    legacy.schema_version = 12;
    let source_path = directory.0.join("source.json");
    let destination_path = directory.0.join("destination.json");
    let source = serde_json::to_vec(&current).unwrap();
    let destination = serde_json::to_vec(&legacy).unwrap();
    fs::write(&source_path, &source).unwrap();
    fs::write(&destination_path, &destination).unwrap();
    let registry_path = directory.0.join("registry.json");
    let registry = WorkspaceSwitcherStatus {
        enabled: true,
        active_workspace_id: "destination".into(),
        workspaces: vec![
            workspace_summary("source", "Source", &current, None),
            workspace_summary("destination", "Destination", &legacy, None),
        ],
    };
    fs::write(&registry_path, serde_json::to_vec(&registry).unwrap()).unwrap();
    restore_workspace_selection_file(&registry_path, "source").unwrap();
    let restored: WorkspaceSwitcherStatus =
        serde_json::from_slice(&fs::read(&registry_path).unwrap()).unwrap();
    assert_eq!(restored.active_workspace_id, "source");
    assert_eq!(fs::read(&source_path).unwrap(), source);
    assert_eq!(fs::read(&destination_path).unwrap(), destination);
    let registry_bytes = fs::read(&registry_path).unwrap();
    assert!(restore_workspace_selection_file(&registry_path, "missing").is_err());
    assert_eq!(fs::read(&registry_path).unwrap(), registry_bytes);
}
