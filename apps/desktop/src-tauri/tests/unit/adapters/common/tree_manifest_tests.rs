use super::datastore_tree_manifest;

#[test]
fn mongodb_tree_describes_native_database_groups() {
    let tree = datastore_tree_manifest("mongodb", "document");
    let root_labels = tree
        .roots
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(tree.empty_state, "structural-folders");
    assert_eq!(root_labels, vec!["Databases", "System Databases"]);
    assert!(tree.roots.iter().all(|node| node.children.is_empty()));
}

#[test]
fn sqlserver_tree_matches_object_explorer_major_sections() {
    let tree = datastore_tree_manifest("sqlserver", "sql");
    let root_labels = tree
        .roots
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let databases = tree
        .roots
        .iter()
        .find(|node| node.label == "Databases")
        .expect("databases root");
    let selected_database = databases
        .children
        .iter()
        .find(|node| node.id == "selected-database")
        .expect("selected database branch");
    let server_objects = tree
        .roots
        .iter()
        .find(|node| node.id == "server-objects")
        .expect("server objects root");
    assert!(root_labels.contains(&"SQL Server Agent"));
    assert!(root_labels.contains(&"Extended Events"));
    assert!(root_labels.contains(&"XEvent Profiler"));
    assert!(root_labels.contains(&"Server Objects"));
    assert!(root_labels.contains(&"Always On High Availability"));
    assert!(!root_labels.contains(&"Linked Servers"));
    assert!(!root_labels.contains(&"Availability Groups"));
    assert!(
        tree.roots
            .iter()
            .find(|node| node.label == "Analysis Services")
            .expect("analysis services")
            .optional_when_live_metadata
    );
    assert!(server_objects
        .children
        .iter()
        .any(|node| node.label == "Linked Servers"));
    assert!(selected_database
        .children
        .iter()
        .any(|node| node.label == "Query Store"));
    assert!(selected_database
        .children
        .iter()
        .any(|node| node.label == "Performance"));
    assert!(selected_database
        .children
        .iter()
        .any(|node| node.label == "Stored Procedures"));
    assert!(
        selected_database
            .children
            .iter()
            .find(|node| node.label == "Service Broker")
            .expect("service broker")
            .optional_when_live_metadata
    );
}

#[test]
fn sqlite_tree_keeps_optional_features_out_of_structural_fallback() {
    let tree = datastore_tree_manifest("sqlite", "sql");
    let main_database = tree
        .roots
        .iter()
        .find(|node| node.id == "main-database")
        .expect("main database root");
    let required_children = main_database
        .children
        .iter()
        .filter(|node| !node.optional_when_live_metadata)
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(required_children.contains(&"Tables"));
    assert!(required_children.contains(&"Views"));
    assert!(required_children.contains(&"Indexes"));
    assert!(required_children.contains(&"Triggers"));
    assert!(!required_children.contains(&"Virtual Tables"));
    assert!(!required_children.contains(&"FTS Tables"));
    assert!(!required_children.contains(&"Attached Databases"));
    assert!(
        tree.roots
            .iter()
            .find(|node| node.id == "attached-databases")
            .expect("attached databases root")
            .optional_when_live_metadata
    );
}

#[test]
fn postgres_family_tree_uses_native_schema_folders() {
    let tree = datastore_tree_manifest("postgresql", "sql");
    let user_schemas = tree
        .roots
        .iter()
        .find(|node| node.label == "User Schemas")
        .expect("user schemas");
    let public_schema = user_schemas
        .children
        .iter()
        .find(|node| node.label == "public")
        .expect("public schema");
    let labels = public_schema
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(public_schema.kind, "schema");
    assert!(labels.contains(&"Tables"));
    assert!(labels.contains(&"Functions"));
    assert!(labels.contains(&"Procedures"));
    assert!(!labels.contains(&"Programmability"));
}

#[test]
fn cockroach_tree_describes_cluster_and_schema_native_sections() {
    let tree = datastore_tree_manifest("cockroachdb", "sql");
    let databases = tree
        .roots
        .iter()
        .find(|node| node.label == "Databases")
        .expect("databases");
    let selected_database = databases
        .children
        .iter()
        .find(|node| node.id == "selected-database")
        .expect("selected database");
    let user_schemas = selected_database
        .children
        .iter()
        .find(|node| node.label == "User Schemas")
        .expect("user schemas");
    let public_schema = user_schemas
        .children
        .iter()
        .find(|node| node.label == "public")
        .expect("public schema");
    let cluster = tree
        .roots
        .iter()
        .find(|node| node.label == "Cluster")
        .expect("cluster");
    let cluster_labels = cluster
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let schema_labels = public_schema
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(schema_labels.contains(&"Tables"));
    assert!(schema_labels.contains(&"Zone Configurations"));
    assert!(cluster_labels.contains(&"Jobs"));
    assert!(cluster_labels.contains(&"Ranges"));
    assert!(cluster_labels.contains(&"Regions / Localities"));
}

#[test]
fn mysql_tree_uses_workbench_style_database_sections() {
    let tree = datastore_tree_manifest("mysql", "sql");
    let mariadb_tree = datastore_tree_manifest("mariadb", "sql");
    let databases = tree
        .roots
        .iter()
        .find(|node| node.label == "Databases")
        .expect("databases");
    let selected_database = databases
        .children
        .iter()
        .find(|node| node.id == "selected-database")
        .expect("selected database");
    let labels = selected_database
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        labels,
        vec![
            "Tables",
            "Views",
            "Stored Procedures",
            "Functions",
            "Events",
            "Triggers",
            "Indexes",
            "Storage",
        ]
    );
    assert!(tree
        .roots
        .iter()
        .any(|node| node.label == "Users / Privileges"));

    let mariadb_security = mariadb_tree
        .roots
        .iter()
        .find(|node| node.label == "Users / Privileges")
        .expect("mariadb security");
    let mariadb_diagnostics = mariadb_tree
        .roots
        .iter()
        .find(|node| node.label == "Diagnostics")
        .expect("mariadb diagnostics");
    let mariadb_security_labels = mariadb_security
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let mariadb_diagnostic_labels = mariadb_diagnostics
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(mariadb_security_labels.contains(&"Role Mappings"));
    assert!(mariadb_diagnostic_labels.contains(&"Server Variables"));
    assert!(mariadb_diagnostic_labels.contains(&"Storage Engines"));
    assert!(mariadb_diagnostic_labels.contains(&"ANALYZE FORMAT=JSON"));
    assert!(!mariadb_diagnostic_labels.contains(&"Optimizer Trace"));
}

#[test]
fn redis_tree_describes_database_types_and_admin_sections() {
    let tree = datastore_tree_manifest("redis", "keyvalue");
    let root_labels = tree
        .roots
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let databases = tree
        .roots
        .iter()
        .find(|node| node.id == "databases")
        .expect("databases root");
    let db = databases
        .children
        .iter()
        .find(|node| node.id == "db")
        .expect("logical database template");
    let db_children = db
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(root_labels.contains(&"Databases"));
    assert!(root_labels.contains(&"Cluster"));
    assert!(root_labels.contains(&"Sentinel"));
    assert!(root_labels.contains(&"ACL / Security"));
    assert!(!root_labels.contains(&"Pub/Sub"));
    assert!(
        tree.roots
            .iter()
            .find(|node| node.label == "Cluster")
            .expect("cluster")
            .optional_when_live_metadata
    );
    assert!(db_children.contains(&"Strings"));
    assert!(db_children.contains(&"Hashes"));
    assert!(db_children.contains(&"JSON"));
    assert!(db_children.contains(&"Search Indexes"));
    assert!(db_children.contains(&"Vector Indexes"));
    assert!(
        db.children
            .iter()
            .find(|node| node.label == "Search Indexes")
            .expect("search indexes")
            .optional_when_live_metadata
    );
}

#[test]
fn valkey_tree_uses_valkey_copy_without_redis_stack_claims() {
    let tree = datastore_tree_manifest("valkey", "keyvalue");
    let databases = tree
        .roots
        .iter()
        .find(|node| node.id == "databases")
        .expect("databases root");
    let db = databases
        .children
        .iter()
        .find(|node| node.id == "db")
        .expect("logical database template");
    let json = db
        .children
        .iter()
        .find(|node| node.id == "json")
        .expect("json module template");
    let functions = tree
        .roots
        .iter()
        .find(|node| node.id == "functions")
        .expect("functions root");

    assert_eq!(
        databases.detail.as_deref(),
        Some("Logical Valkey databases")
    );
    assert_eq!(db.detail.as_deref(), Some("Valkey logical database"));
    assert_eq!(
        json.detail.as_deref(),
        Some("Valkey-compatible JSON documents")
    );
    assert!(json.optional_when_live_metadata);
    assert_eq!(
        functions.detail.as_deref(),
        Some("Valkey functions and libraries")
    );
    let details = tree
        .roots
        .iter()
        .flat_map(|node| {
            std::iter::once(node)
                .chain(node.children.iter())
                .chain(node.children.iter().flat_map(|child| child.children.iter()))
        })
        .filter_map(|node| node.detail.as_deref())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!details.contains("Redis Stack"));
}

#[test]
fn cosmos_tree_describes_account_database_and_container_views() {
    let tree = datastore_tree_manifest("cosmosdb", "document");
    let account = tree
        .roots
        .iter()
        .find(|node| node.id == "account")
        .expect("account root");
    let databases = account
        .children
        .iter()
        .find(|node| node.id == "databases")
        .expect("databases section");
    let selected_database = databases
        .children
        .iter()
        .find(|node| node.id == "selected-database")
        .expect("selected database");
    let containers = selected_database
        .children
        .iter()
        .find(|node| node.id == "containers")
        .expect("containers section");
    let container_children = containers
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(account.label, "Account");
    assert!(container_children.contains(&"Items"));
    assert!(container_children.contains(&"Partition Key"));
    assert!(container_children.contains(&"Indexing Policy"));
    assert!(container_children.contains(&"Stored Procedures"));
    assert!(!container_children.contains(&"Collections"));
}

#[test]
fn secondary_tree_manifests_are_native_not_generic() {
    let memcached = datastore_tree_manifest("memcached", "keyvalue");
    let litedb = datastore_tree_manifest("litedb", "document");
    let influx = datastore_tree_manifest("influxdb", "timeseries");
    let opentsdb = datastore_tree_manifest("opentsdb", "timeseries");

    assert_eq!(memcached.roots[0].label, "Server");
    assert!(memcached.roots[0]
        .children
        .iter()
        .any(|node| node.label == "Slabs"));
    assert_eq!(litedb.roots[0].label, "Local Database");
    assert!(litedb.roots[0]
        .children
        .iter()
        .any(|node| node.label == "File Storage"));
    assert!(influx.roots.iter().any(|node| node.label == "Buckets"));
    assert!(influx.roots.iter().any(|node| node.label == "Tokens"));
    assert!(opentsdb
        .roots
        .iter()
        .any(|node| node.label == "Aggregators"));
    assert!(opentsdb
        .roots
        .iter()
        .any(|node| node.label == "UID Metadata"));
    assert!(!memcached.roots.iter().any(|node| node.label == "Objects"));
    assert!(!litedb.roots.iter().any(|node| node.label == "Objects"));
}

#[test]
fn secondary_tree_manifests_avoid_placeholder_object_children() {
    let dynamodb = datastore_tree_manifest("dynamodb", "widecolumn");
    let cassandra = datastore_tree_manifest("cassandra", "widecolumn");
    let prometheus = datastore_tree_manifest("prometheus", "timeseries");
    let influx = datastore_tree_manifest("influxdb", "timeseries");
    let graph = datastore_tree_manifest("neo4j", "graph");
    let warehouse = datastore_tree_manifest("snowflake", "warehouse");

    let dynamo_tables = dynamodb
        .roots
        .iter()
        .find(|node| node.id == "tables")
        .expect("dynamodb tables");
    assert!(dynamo_tables.children.is_empty());
    assert!(dynamodb.roots.iter().any(|node| node.label == "Access"));

    let selected_keyspace = cassandra
        .roots
        .iter()
        .find(|node| node.id == "selected-keyspace")
        .expect("selected keyspace");
    let keyspaces = cassandra
        .roots
        .iter()
        .find(|node| node.id == "keyspaces")
        .expect("keyspaces");
    assert!(selected_keyspace.requires_database);
    assert!(keyspaces.hidden_when_database_selected);
    assert!(selected_keyspace
        .children
        .iter()
        .any(|node| node.label == "Functions"));

    assert!(prometheus
        .roots
        .iter()
        .any(|node| node.label == "TSDB Status"));
    assert!(prometheus
        .roots
        .iter()
        .any(|node| node.label == "Service Discovery"));

    let selected_bucket = influx
        .roots
        .iter()
        .find(|node| node.id == "selected-bucket")
        .expect("selected bucket");
    let buckets = influx
        .roots
        .iter()
        .find(|node| node.id == "buckets")
        .expect("buckets");
    assert!(selected_bucket.requires_database);
    assert!(buckets.hidden_when_database_selected);

    let graph_root = graph
        .roots
        .iter()
        .find(|node| node.id == "graphs")
        .expect("graphs");
    assert!(graph_root.children.is_empty());
    assert!(graph.roots.iter().any(|node| node.label == "Node Labels"));

    assert!(warehouse
        .roots
        .iter()
        .any(|node| node.label == "Tasks & Query History"));
    assert!(!warehouse.roots.iter().any(|node| node.label == "Schemas"));
}

#[test]
fn oracle_tree_describes_enterprise_object_sections() {
    let tree = datastore_tree_manifest("oracle", "sql");
    let root_labels = tree
        .roots
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let schemas = tree
        .roots
        .iter()
        .find(|node| node.id == "schemas")
        .expect("schemas root");
    let schema_children = schemas
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();
    let packages = schemas
        .children
        .iter()
        .find(|node| node.id == "packages")
        .expect("packages section");
    let package_children = packages
        .children
        .iter()
        .map(|node| node.label.as_str())
        .collect::<Vec<_>>();

    assert!(root_labels.contains(&"Containers"));
    assert!(root_labels.contains(&"Performance"));
    assert!(root_labels.contains(&"Data Guard"));
    assert!(root_labels.contains(&"RAC"));
    assert!(schema_children.contains(&"Tables"));
    assert!(schema_children.contains(&"Packages"));
    assert!(schema_children.contains(&"Database Links"));
    assert!(package_children.contains(&"Spec"));
    assert!(package_children.contains(&"Compilation Errors"));
}
