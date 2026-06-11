use tiberius::ColumnData;

use super::column_data_f64;

#[test]
fn converts_sqlserver_numeric_cells() {
    assert_eq!(column_data_f64(&ColumnData::F64(Some(9.5))), Some(9.5));
    assert_eq!(column_data_f64(&ColumnData::I32(Some(7))), Some(7.0));
    assert_eq!(column_data_f64(&ColumnData::String(Some("7".into()))), None);
}
