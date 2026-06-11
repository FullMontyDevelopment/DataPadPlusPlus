pub(crate) fn mariadb_adapter() -> super::mysql::MysqlLikeAdapter {
    super::mysql::MysqlLikeAdapter { engine: "mariadb" }
}
