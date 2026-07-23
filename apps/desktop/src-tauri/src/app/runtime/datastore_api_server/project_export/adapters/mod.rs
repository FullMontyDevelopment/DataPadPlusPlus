use super::*;

mod dotnet_common;
mod dotnet_dynamodb;
mod dotnet_mongodb;
mod dotnet_postgresql;
mod dotnet_sqlite;
mod rust_common;
mod rust_dynamodb;
mod rust_mongodb;
mod rust_postgresql;
mod rust_sqlite;

pub(super) use dotnet_dynamodb::ADAPTER as DOTNET_DYNAMODB;
pub(super) use dotnet_mongodb::ADAPTER as DOTNET_MONGODB;
pub(super) use dotnet_postgresql::ADAPTER as DOTNET_POSTGRESQL;
pub(super) use dotnet_sqlite::ADAPTER as DOTNET_SQLITE;
pub(super) use rust_dynamodb::ADAPTER as RUST_DYNAMODB;
pub(super) use rust_mongodb::ADAPTER as RUST_MONGODB;
pub(super) use rust_postgresql::ADAPTER as RUST_POSTGRESQL;
pub(super) use rust_sqlite::ADAPTER as RUST_SQLITE;

fn postgres_select_expression(
    source: &str,
    alias: &str,
    writable: bool,
) -> Result<String, CommandError> {
    let source = quote_ansi_identifier(source)?;
    let alias = quote_ansi_identifier(alias)?;
    if writable {
        Ok(format!("{source} AS {alias}"))
    } else {
        Ok(format!("{source}::text AS {alias}"))
    }
}

fn sqlite_select_expression(
    source: &str,
    alias: &str,
    writable: bool,
) -> Result<String, CommandError> {
    let source = quote_ansi_identifier(source)?;
    let alias = quote_ansi_identifier(alias)?;
    if writable {
        Ok(format!("{source} AS {alias}"))
    } else {
        Ok(format!("CAST({source} AS TEXT) AS {alias}"))
    }
}
