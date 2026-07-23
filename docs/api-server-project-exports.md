# API Server Project Exports

DataPad++ can turn a configured API Server profile into a standalone Rust or
.NET project backed by a real datastore client. The export keeps the profile's
existing REST/OpenAPI, GraphQL, or gRPC surface and does not include connection
secrets from the DataPad++ workspace.

The capability check in the export dialog is authoritative for the selected
connection and resources. It identifies unsupported combinations, labels each
resource as CRUD or read-only, reports schema warnings, and explains why a
custom endpoint cannot be exported. The backend runs the same planner again
when it creates the archive.

## Supported Matrix

Every enabled datastore has both a Rust and a .NET adapter:

| Datastore | Rust client | .NET client | Resource support |
| --- | --- | --- | --- |
| PostgreSQL | SQLx | Dapper and Npgsql | Tables, views, and safe read-only custom SQL |
| SQLite | SQLx | Dapper and Microsoft.Data.Sqlite | Tables, views, and safe read-only custom SQL |
| MongoDB | Official MongoDB Rust driver | MongoDB.Driver | Collections and list-only views |
| DynamoDB | AWS SDK for Rust | AWS SDK for .NET | Tables with a discovered key schema |

REST/OpenAPI, GraphQL, and gRPC are available for every supported
framework/datastore pair. Other datastores remain explicitly disabled; related
engines such as CockroachDB and TimescaleDB do not inherit PostgreSQL export
support automatically.

## Generated Runtime Configuration

Generated projects connect to an existing datastore and never create schemas,
tables, collections, indexes, or migrations.

- Rust PostgreSQL and SQLite projects read `DATABASE_URL`.
- .NET PostgreSQL and SQLite projects read
  `ConnectionStrings__Datastore`.
- MongoDB projects read `MONGODB_URI`.
- DynamoDB projects use the standard AWS SDK credential and region chain,
  including `AWS_REGION`, with optional `DYNAMODB_ENDPOINT_URL` support for
  DynamoDB Local or another explicit endpoint.

The generated `.env.example` contains example formats only. DataPad++ does not
resolve or copy workspace passwords, tokens, AWS credentials, profiles, or
other secret values into the archive. Startup validates the connection, and
`/health` performs a datastore-specific ping or table check.

## Resource And Identity Rules

Relational resources use validated, dialect-quoted physical identifiers and
bound request parameters. Tables with a usable primary key can expose CRUD.
Views, keyless resources, and resources containing unsupported writable types
are reduced to read-only behavior. Composite route identities are URL-encoded
JSON objects keyed by source column name.

MongoDB collections use exact `_id` identities and DataPad++ Extended JSON.
Patches apply `$set` only to supplied top-level fields and reject `_id`,
operator-style names, dotted field names, and empty changes. MongoDB views are
list-only. Empty collections can still be exported with a dynamic-schema
warning.

DynamoDB requires a discovered partition key and optional sort key. Route
identities are URL-encoded JSON objects containing exactly those keys. Creates,
updates, and deletes use conditional operations so creates do not overwrite
existing items and mutations distinguish missing items. Lists use one bounded,
non-consistent `Scan`, which can consume table capacity. Number, binary, and set
values use the documented lossless tagged JSON form in both generated
languages.

## Custom Endpoints

Custom endpoints are currently relational and REST-only. A query is exported
only when it contains one read-only statement, uses defined `{{api.name}}`
parameters with supported types, and passes the SQL safety classifier.
Parameters become PostgreSQL or SQLite bind parameters and the configured row
limit remains bounded.

MongoDB and DynamoDB custom endpoints are disabled until datastore-specific
read-only classifiers and binders are available. Export collection or table
resources instead.

## Generated Project Contents

Each archive includes framework host files, datastore-specific repository and
client code, protocol handlers, `.env.example`, a generated `README.md`, and an
export manifest. Direct dependencies are pinned by the framework and datastore
adapters. Generated projects enable lockfile creation on first restore; commit
the resulting Cargo or NuGet lockfile with the consumer project.

The manifest records the adapter, datastore, protocol, dependency versions,
resource modes, identity metadata, compiler requirements where applicable,
warnings, and the [official DataPad++ website](https://datapad-plus-plus.org/).

## Validation

Run the pairwise generated-project compile lane with:

```text
npm run api-export:validate
```

Run all 24 framework/datastore/protocol combinations with:

```text
npm run api-export:validate:full
```

Optional live lanes validate generated projects against SQLite, the MongoDB
replica-set fixture, and DynamoDB Local:

```text
npm run api-export:validate:live-sqlite
npm run api-export:validate:live-mongodb
npm run api-export:validate:live-dynamodb
```

Rust DynamoDB exports require Rust 1.94.1 or newer. Other Rust exports retain
the current Rust 1.89 floor, and .NET exports target `net10.0`.
