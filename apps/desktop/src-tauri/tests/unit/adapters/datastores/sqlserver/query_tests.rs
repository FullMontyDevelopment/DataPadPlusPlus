use std::borrow::Cow;

use chrono::NaiveDate;
use serde_json::Value;
use tiberius::{
    time::{Date, DateTime2, DateTimeOffset, Time},
    xml::XmlData,
    ColumnData,
};

use super::{
    payload_table, sqlserver_explain_payload, sqlserver_profile_payload,
    sqlserver_showplan_operators, stringify_tiberius_cell, SqlServerResultSection,
};

#[test]
fn sqlserver_temporal_cells_render_as_native_values() {
    let date = sqlserver_date(2026, 5, 16);
    let time = sqlserver_time(11, 29, 8, 356_405_000);
    let datetime = DateTime2::new(date, time);

    assert_eq!(
        stringify_tiberius_cell(&ColumnData::DateTime2(Some(datetime))),
        "2026-05-16 11:29:08.356405",
    );
    assert_eq!(
        stringify_tiberius_cell(&ColumnData::Date(Some(date))),
        "2026-05-16",
    );
    assert_eq!(
        stringify_tiberius_cell(&ColumnData::Time(Some(time))),
        "11:29:08.356405",
    );
    assert_eq!(
        stringify_tiberius_cell(&ColumnData::DateTimeOffset(Some(DateTimeOffset::new(
            datetime, 120,
        )))),
        "2026-05-16 11:29:08.356405 +02:00",
    );
}

#[test]
fn sqlserver_decimal_and_xml_cells_do_not_leak_debug_wrappers() {
    assert_eq!(
        stringify_tiberius_cell(&ColumnData::Numeric(Some(
            tiberius::numeric::Numeric::new_with_scale(12_345, 2)
        ))),
        "123.45",
    );
    assert_eq!(
        stringify_tiberius_cell(&ColumnData::Xml(Some(Cow::Owned(XmlData::new(
            "<a>value</a>",
        ))))),
        "<a>value</a>",
    );
}

#[test]
fn sqlserver_showplan_payload_uses_plan_renderer_shape() {
    let section = SqlServerResultSection {
        payload: payload_table(
            vec!["StmtText".into()],
            vec![vec![
                "Clustered Index Scan\n  Predicate: [active]=(1)".into()
            ]],
        ),
        columns: vec!["StmtText".into()],
        row_count: 1,
        tabular_rows: vec![vec![
            "Clustered Index Scan\n  Predicate: [active]=(1)".into()
        ]],
        duration_ms: 3,
        truncated: false,
        statement: "SET SHOWPLAN_TEXT ON; select * from accounts; SET SHOWPLAN_TEXT OFF;".into(),
    };

    let payload = sqlserver_explain_payload("select * from accounts", &section);

    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["format"], "text");
    assert_eq!(payload["value"]["format"], "text");
    assert_eq!(payload["value"]["plan"][0], "Clustered Index Scan");
    assert_eq!(payload["value"]["plan"][1], "  Predicate: [active]=(1)");
    assert_eq!(payload["value"]["columns"][0], "StmtText");
    assert_eq!(
        payload["value"]["rows"][0][0],
        Value::String("Clustered Index Scan\n  Predicate: [active]=(1)".into())
    );
}

#[test]
fn sqlserver_xml_showplan_payload_extracts_operator_table() {
    let xml = r#"<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"><BatchSequence><Batch><Statements><StmtSimple StatementText="SELECT * FROM [dbo].[Accounts]" StatementType="SELECT" StatementSubTreeCost="0.008" StatementEstRows="42" StatementOptmLevel="TRIVIAL"><QueryPlan><RelOp NodeId="0" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan" EstimateRows="42" EstimatedTotalSubtreeCost="0.008"><OutputList /><IndexScan><Object Database="[datapadplusplus]" Schema="[dbo]" Table="[Accounts]" Index="[PK_Accounts]" /><Predicate><ScalarOperator ScalarString="[dbo].[Accounts].[active]=(1)" /></Predicate></IndexScan></RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>"#;
    let section = SqlServerResultSection {
        payload: payload_table(
            vec!["Microsoft SQL Server 2004 XML Showplan".into()],
            vec![vec![xml.into()]],
        ),
        columns: vec!["Microsoft SQL Server 2004 XML Showplan".into()],
        row_count: 1,
        tabular_rows: vec![vec![xml.into()]],
        duration_ms: 4,
        truncated: false,
        statement: "SET SHOWPLAN_XML ON; select * from [dbo].[Accounts]; SET SHOWPLAN_XML OFF;"
            .into(),
    };

    let operators = sqlserver_showplan_operators(xml);
    let payload = sqlserver_profile_payload("select * from [dbo].[Accounts]", &section);

    assert_eq!(operators[0].physical, "Clustered Index Scan");
    assert_eq!(
        operators[0].object,
        "[datapadplusplus].[dbo].[Accounts].[PK_Accounts]"
    );
    assert_eq!(operators[0].predicate, "[dbo].[Accounts].[active]=(1)");
    assert_eq!(payload["renderer"], "plan");
    assert_eq!(payload["format"], "xml");
    assert_eq!(payload["value"]["format"], "showplan_xml");
    assert_eq!(
        payload["value"]["statements"][0]["optimizationLevel"],
        "TRIVIAL"
    );
    assert_eq!(
        payload["value"]["plan"][0],
        "Clustered Index Scan on [datapadplusplus].[dbo].[Accounts].[PK_Accounts] [rows 42, cost 0.008]"
    );
    assert_eq!(
        payload["value"]["rows"][0][0],
        Value::String("Clustered Index Scan".into())
    );
    assert_eq!(
        payload["value"]["operators"][0]["estimatedRows"],
        Value::String("42".into())
    );
}

fn sqlserver_date(year: i32, month: u32, day: u32) -> Date {
    let start = NaiveDate::from_ymd_opt(1, 1, 1).expect("valid start date");
    let date = NaiveDate::from_ymd_opt(year, month, day).expect("valid test date");

    Date::new(date.signed_duration_since(start).num_days() as u32)
}

fn sqlserver_time(hour: u64, minute: u64, second: u64, nanos: u64) -> Time {
    let increments = ((hour * 3_600 + minute * 60 + second) * 1_000_000_000 + nanos) / 100;

    Time::new(increments, 7)
}
