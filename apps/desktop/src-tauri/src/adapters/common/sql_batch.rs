#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SqlBatchDialect {
    Standard,
    Postgres,
    SqlServer,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SqlBatchStatement {
    pub(crate) index: usize,
    pub(crate) text: String,
}

pub(crate) fn split_sql_batch(input: &str, dialect: SqlBatchDialect) -> Vec<SqlBatchStatement> {
    if dialect == SqlBatchDialect::SqlServer {
        return split_sqlserver_go_batches(input);
    }

    split_semicolon_statements(input, dialect)
}

pub(crate) fn single_statement_batch(statement: &str) -> Vec<SqlBatchStatement> {
    let trimmed = statement.trim();
    if trimmed.is_empty() {
        Vec::new()
    } else {
        vec![SqlBatchStatement {
            index: 1,
            text: trimmed.to_string(),
        }]
    }
}

fn split_sqlserver_go_batches(input: &str) -> Vec<SqlBatchStatement> {
    let mut batches = Vec::new();
    let mut current = String::new();

    for line in input.lines() {
        if line.trim().eq_ignore_ascii_case("go") {
            push_statement(&mut batches, &mut current);
            continue;
        }

        current.push_str(line);
        current.push('\n');
    }

    push_statement(&mut batches, &mut current);
    batches
}

fn split_semicolon_statements(input: &str, dialect: SqlBatchDialect) -> Vec<SqlBatchStatement> {
    let chars = input.chars().collect::<Vec<char>>();
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut state = ScanState::Normal;
    let mut index = 0;

    while index < chars.len() {
        match &mut state {
            ScanState::Normal => {
                if chars[index] == '-' && chars.get(index + 1) == Some(&'-') {
                    current.push(chars[index]);
                    current.push(chars[index + 1]);
                    index += 2;
                    state = ScanState::LineComment;
                    continue;
                }

                if chars[index] == '/' && chars.get(index + 1) == Some(&'*') {
                    current.push(chars[index]);
                    current.push(chars[index + 1]);
                    index += 2;
                    state = ScanState::BlockComment;
                    continue;
                }

                if chars[index] == '\'' {
                    current.push(chars[index]);
                    index += 1;
                    state = ScanState::SingleQuote;
                    continue;
                }

                if chars[index] == '"' {
                    current.push(chars[index]);
                    index += 1;
                    state = ScanState::DoubleQuote;
                    continue;
                }

                if chars[index] == '`' {
                    current.push(chars[index]);
                    index += 1;
                    state = ScanState::Backtick;
                    continue;
                }

                if chars[index] == '[' {
                    current.push(chars[index]);
                    index += 1;
                    state = ScanState::Bracket;
                    continue;
                }

                if dialect == SqlBatchDialect::Postgres && chars[index] == '$' {
                    if let Some(delimiter) = postgres_dollar_delimiter(&chars[index..]) {
                        current.push_str(&delimiter);
                        index += delimiter.chars().count();
                        state = ScanState::DollarQuote(delimiter);
                        continue;
                    }
                }

                if chars[index] == ';' {
                    push_statement(&mut statements, &mut current);
                    index += 1;
                    continue;
                }

                current.push(chars[index]);
                index += 1;
            }
            ScanState::LineComment => {
                current.push(chars[index]);
                if chars[index] == '\n' {
                    state = ScanState::Normal;
                }
                index += 1;
            }
            ScanState::BlockComment => {
                current.push(chars[index]);
                if chars[index] == '*' && chars.get(index + 1) == Some(&'/') {
                    current.push(chars[index + 1]);
                    index += 2;
                    state = ScanState::Normal;
                } else {
                    index += 1;
                }
            }
            ScanState::SingleQuote => {
                current.push(chars[index]);
                if chars[index] == '\'' {
                    if chars.get(index + 1) == Some(&'\'') {
                        current.push(chars[index + 1]);
                        index += 2;
                    } else {
                        index += 1;
                        state = ScanState::Normal;
                    }
                } else {
                    index += 1;
                }
            }
            ScanState::DoubleQuote => {
                current.push(chars[index]);
                if chars[index] == '"' {
                    if chars.get(index + 1) == Some(&'"') {
                        current.push(chars[index + 1]);
                        index += 2;
                    } else {
                        index += 1;
                        state = ScanState::Normal;
                    }
                } else {
                    index += 1;
                }
            }
            ScanState::Backtick => {
                current.push(chars[index]);
                if chars[index] == '`' {
                    if chars.get(index + 1) == Some(&'`') {
                        current.push(chars[index + 1]);
                        index += 2;
                    } else {
                        index += 1;
                        state = ScanState::Normal;
                    }
                } else {
                    index += 1;
                }
            }
            ScanState::Bracket => {
                current.push(chars[index]);
                if chars[index] == ']' {
                    if chars.get(index + 1) == Some(&']') {
                        current.push(chars[index + 1]);
                        index += 2;
                    } else {
                        index += 1;
                        state = ScanState::Normal;
                    }
                } else {
                    index += 1;
                }
            }
            ScanState::DollarQuote(delimiter) => {
                if chars[index..].starts_with(&delimiter.chars().collect::<Vec<_>>()) {
                    current.push_str(delimiter);
                    index += delimiter.chars().count();
                    state = ScanState::Normal;
                } else {
                    current.push(chars[index]);
                    index += 1;
                }
            }
        }
    }

    push_statement(&mut statements, &mut current);
    statements
}

fn push_statement(statements: &mut Vec<SqlBatchStatement>, current: &mut String) {
    let text = current.trim();
    if !text.is_empty() {
        statements.push(SqlBatchStatement {
            index: statements.len() + 1,
            text: text.to_string(),
        });
    }
    current.clear();
}

fn postgres_dollar_delimiter(chars: &[char]) -> Option<String> {
    if chars.first() != Some(&'$') {
        return None;
    }

    for end in 1..chars.len().min(64) {
        if chars[end] == '$' {
            let tag = &chars[1..end];
            let valid = tag
                .iter()
                .all(|item| item.is_ascii_alphanumeric() || *item == '_')
                && tag
                    .first()
                    .map(|item| item.is_ascii_alphabetic() || *item == '_')
                    .unwrap_or(true);

            return valid.then(|| chars[..=end].iter().collect());
        }
    }

    None
}

#[derive(Debug)]
enum ScanState {
    Normal,
    LineComment,
    BlockComment,
    SingleQuote,
    DoubleQuote,
    Backtick,
    Bracket,
    DollarQuote(String),
}

#[cfg(test)]
mod tests {
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
}
