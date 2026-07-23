use super::*;

static CLIENT_ADAPTERS: [&ProjectExportClientAdapter; 8] = [
    &adapters::RUST_POSTGRESQL,
    &adapters::RUST_SQLITE,
    &adapters::RUST_MONGODB,
    &adapters::RUST_DYNAMODB,
    &adapters::DOTNET_POSTGRESQL,
    &adapters::DOTNET_SQLITE,
    &adapters::DOTNET_MONGODB,
    &adapters::DOTNET_DYNAMODB,
];

static FRAMEWORK_RENDERERS: [&ProjectExportFrameworkRenderer; 2] =
    [&frameworks::RUST, &frameworks::DOTNET];

static DATASTORE_PROVIDERS: [&dyn ProjectExportDatastoreProvider; 4] = [
    &providers::POSTGRESQL,
    &providers::SQLITE,
    &providers::MONGODB,
    &providers::DYNAMODB,
];

pub(crate) fn client_adapter_for(
    framework: &str,
    engine: &str,
) -> Result<&'static ProjectExportClientAdapter, CommandError> {
    CLIENT_ADAPTERS
        .iter()
        .copied()
        .find(|adapter| adapter.framework == framework && adapter.engine == engine)
        .ok_or_else(|| unsupported_client_error(framework, engine))
}

pub(crate) fn datastore_provider_for(
    engine: &str,
) -> Result<&'static dyn ProjectExportDatastoreProvider, CommandError> {
    let provider = DATASTORE_PROVIDERS
        .iter()
        .copied()
        .find(|provider| provider.engine() == engine)
        .ok_or_else(|| unsupported_client_error("Rust and .NET", engine))?;
    for framework in ["rust", "dotnet"] {
        client_adapter_for(framework, engine)?;
    }
    Ok(provider)
}

pub(crate) fn framework_renderer_for(
    framework: &str,
) -> Result<&'static ProjectExportFrameworkRenderer, CommandError> {
    FRAMEWORK_RENDERERS
        .iter()
        .copied()
        .find(|renderer| renderer.framework == framework)
        .ok_or_else(unsupported_framework_error)
}

#[cfg(test)]
pub(crate) fn client_adapter_registration_count() -> usize {
    CLIENT_ADAPTERS.len()
}

#[cfg(test)]
pub(crate) fn framework_renderer_registration_count() -> usize {
    FRAMEWORK_RENDERERS.len()
}

#[cfg(test)]
pub(crate) fn datastore_provider_registration_count() -> usize {
    DATASTORE_PROVIDERS.len()
}
