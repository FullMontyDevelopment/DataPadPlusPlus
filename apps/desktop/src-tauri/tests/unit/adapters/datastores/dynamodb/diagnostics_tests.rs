use serde_json::json;

use super::{account_capacity_limit, dynamodb_diagnostics_request_plan, table_count};

#[test]
fn dynamodb_table_count_reads_list_tables_shape() {
    let value = json!({ "TableNames": ["Orders", "Users"] });

    assert_eq!(table_count(Some(&value)), 2);
    assert_eq!(table_count(None), 0);
}

#[test]
fn dynamodb_account_capacity_limit_reads_describe_limits_shape() {
    let value = json!({
        "AccountMaxReadCapacityUnits": 80_000,
        "AccountMaxWriteCapacityUnits": 40_000
    });

    assert_eq!(
        account_capacity_limit(Some(&value), "AccountMaxReadCapacityUnits"),
        80_000
    );
    assert_eq!(
        account_capacity_limit(Some(&value), "AccountMaxWriteCapacityUnits"),
        40_000
    );
    assert_eq!(
        account_capacity_limit(None, "AccountMaxReadCapacityUnits"),
        0
    );
}

#[test]
fn dynamodb_diagnostics_plan_includes_cloud_disabled_surfaces() {
    let plan = dynamodb_diagnostics_request_plan(Some("table:Orders"));

    assert_eq!(plan[0]["operation"], "DynamoDB.ListTables");
    assert_eq!(plan[2]["tableName"], "Orders");
    assert_eq!(plan[5]["operation"], "CloudWatch.GetMetricData");
    assert_eq!(plan[6]["operation"], "IAM.SimulatePrincipalPolicy");
}
