use crate::domain::{
    error::CommandError,
    models::{ConnectionProfile, QueryTabState},
};
use serde_json::{json, Value};

#[cfg(test)]
#[path = "../../../tests/unit/app/runtime/query_compiler_tests.rs"]
mod tests;

pub(super) fn invoke(function: &str, input: &Value) -> Result<Value, CommandError> {
    let failure = || {
        CommandError::new(
            "query-compiler-failed",
            "The shared query compiler could not validate this definition.",
        )
    };
    let runtime = rquickjs::Runtime::new().map_err(|_| failure())?;
    runtime.set_memory_limit(64 * 1024 * 1024);
    runtime.set_max_stack_size(1024 * 1024);
    let started = std::time::Instant::now();
    runtime.set_interrupt_handler(Some(Box::new(move || started.elapsed().as_secs() >= 5)));
    let context = rquickjs::Context::full(&runtime).map_err(|_| failure())?;
    context.with(|ctx| {
        ctx.eval::<(), _>(include_str!("query_compiler.js"))
            .map_err(|_| failure())?;
        let compiler: rquickjs::Object = ctx
            .globals()
            .get("DataPadQueryCompiler")
            .map_err(|_| failure())?;
        let callback: rquickjs::Function = compiler.get(function).map_err(|_| failure())?;
        let json: rquickjs::Object = ctx.globals().get("JSON").map_err(|_| failure())?;
        let parse: rquickjs::Function = json.get("parse").map_err(|_| failure())?;
        let stringify: rquickjs::Function = json.get("stringify").map_err(|_| failure())?;
        let argument: rquickjs::Value = parse.call((input.to_string(),)).map_err(|_| failure())?;
        let result: rquickjs::Value = callback.call((argument,)).map_err(|_| failure())?;
        let text: String = stringify.call((result,)).map_err(|_| failure())?;
        serde_json::from_str(&text).map_err(|_| failure())
    })
}

pub(super) fn compile(
    state: &Value,
    connection: &ConnectionProfile,
    tab: &QueryTabState,
) -> Result<(String, Value), CommandError> {
    // Only non-secret routing metadata enters the compiler sandbox.
    let result = invoke(
        "compileSavedBuilder",
        &json!({"builderState":state,"connection":{"engine":connection.engine,"database":connection.database},"tab":{"scopedTarget":tab.scoped_target,"sqlScope":tab.sql_scope}}),
    )?;
    if result["ok"] != true {
        return Err(CommandError::new(
            "query-builder-invalid",
            result["errors"].to_string(),
        ));
    }
    Ok((
        result["queryText"].as_str().unwrap_or_default().into(),
        result["builderState"].clone(),
    ))
}

pub(super) fn prepare(
    tab: &QueryTabState,
    connection: &ConnectionProfile,
) -> Result<Value, CommandError> {
    let result = invoke(
        "prepareSavedExecution",
        &json!({"connection":{"engine":connection.engine,"database":connection.database},"tab":tab}),
    )?;
    if result["ok"] != true {
        return Err(CommandError::new(
            "query-builder-invalid",
            result["errors"].to_string(),
        ));
    }
    Ok(result)
}
