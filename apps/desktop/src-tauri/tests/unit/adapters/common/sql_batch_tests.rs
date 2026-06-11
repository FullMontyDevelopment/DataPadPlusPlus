use super::*;

#[test]
fn standard_splitter_ignores_semicolons_inside_strings_and_comments() {
    let statements = split_sql_batch(
        "select ';' as value; -- ; comment\nselect 'two'; /* ; */ select 3;",
        SqlBatchDialect::Standard,
    );

    assert_eq!(statements.len(), 3);
    assert_eq!(statements[0].text, "select ';' as value");
    assert!(statements[1].text.contains("select 'two'"));
    assert!(statements[2].text.ends_with("select 3"));
}

#[test]
fn postgres_splitter_keeps_dollar_quoted_blocks_together() {
    let statements = split_sql_batch(
        "do $$ begin raise notice 'a;b'; end $$; select 1;",
        SqlBatchDialect::Postgres,
    );

    assert_eq!(statements.len(), 2);
    assert!(statements[0].text.contains("a;b"));
    assert_eq!(statements[1].text, "select 1");
}

#[test]
fn sqlserver_splitter_uses_go_batches() {
    let statements = split_sql_batch(
        "select 1\nGO\nselect ';' as value;\ngo\n",
        SqlBatchDialect::SqlServer,
    );

    assert_eq!(
        statements
            .iter()
            .map(|statement| statement.text.as_str())
            .collect::<Vec<_>>(),
        vec!["select 1", "select ';' as value;"],
    );
}
