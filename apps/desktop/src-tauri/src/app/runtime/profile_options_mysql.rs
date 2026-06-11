use crate::domain::models::MySqlConnectionOptions;

pub(super) fn interpolate_mysql_options(
    options: &MySqlConnectionOptions,
    interpolate: &impl Fn(&str) -> String,
) -> MySqlConnectionOptions {
    MySqlConnectionOptions {
        connect_mode: options.connect_mode.as_deref().map(interpolate),
        auth_mode: options.auth_mode.as_deref().map(interpolate),
        ssl_mode: options.ssl_mode.as_deref().map(interpolate),
        server_flavor: options.server_flavor.as_deref().map(interpolate),
        application_name: options.application_name.as_deref().map(interpolate),
        charset: options.charset.as_deref().map(interpolate),
        collation: options.collation.as_deref().map(interpolate),
        time_zone: options.time_zone.as_deref().map(interpolate),
        sql_mode: options.sql_mode.as_deref().map(interpolate),
        default_storage_engine: options.default_storage_engine.as_deref().map(interpolate),
        allow_local_infile: options.allow_local_infile,
        statement_cache_capacity: options.statement_cache_capacity,
        connect_timeout_ms: options.connect_timeout_ms,
        command_timeout_ms: options.command_timeout_ms,
        ca_certificate_path: options.ca_certificate_path.as_deref().map(interpolate),
        client_certificate_path: options.client_certificate_path.as_deref().map(interpolate),
        client_key_path: options.client_key_path.as_deref().map(interpolate),
        certificate_password_secret_ref: options.certificate_password_secret_ref.clone(),
        unix_socket_path: options.unix_socket_path.as_deref().map(interpolate),
        cloud_sql_instance: options.cloud_sql_instance.as_deref().map(interpolate),
    }
}

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/profile_options_mysql_tests.rs"]
mod tests;
