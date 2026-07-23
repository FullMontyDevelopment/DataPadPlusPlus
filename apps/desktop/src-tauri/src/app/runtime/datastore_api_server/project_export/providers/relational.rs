use super::*;

pub(crate) static POSTGRESQL: RelationalProvider = RelationalProvider {
    engine: "postgresql",
};
pub(crate) static SQLITE: RelationalProvider = RelationalProvider { engine: "sqlite" };

pub(crate) struct RelationalProvider {
    engine: &'static str,
}

#[async_trait::async_trait]
impl ProjectExportDatastoreProvider for RelationalProvider {
    fn engine(&self) -> &'static str {
        self.engine
    }

    async fn load_metadata(
        &self,
        runtime: &ManagedAppState,
        server: &DatastoreApiServerConfig,
        connection_id: &str,
    ) -> ProjectExportMetadata {
        catalog_metadata(runtime, server, connection_id).await
    }

    fn plan_resource(
        &self,
        config: &DatastoreApiServerConfig,
        resource: &DatastoreApiServerResourceConfig,
        metadata: &ProjectExportMetadata,
        adapter: &ProjectExportClientAdapter,
    ) -> Result<ProjectResourceModel, CommandError> {
        planner::project_resource_model(config, resource, &metadata.structure_nodes, adapter)
    }

    fn plan_custom_endpoint(
        &self,
        config: &DatastoreApiServerConfig,
        endpoint: &DatastoreApiServerCustomEndpointConfig,
        adapter: &ProjectExportClientAdapter,
    ) -> Result<ProjectCustomEndpoint, CommandError> {
        planner::project_custom_endpoint(config, endpoint, adapter)
    }
}
