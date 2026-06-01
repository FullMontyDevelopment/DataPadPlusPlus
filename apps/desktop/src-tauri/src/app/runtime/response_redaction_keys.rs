pub(super) fn is_secret_like_payload_key(value: &str) -> bool {
    let normalized = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    matches!(
        normalized.as_str(),
        "password"
            | "pwd"
            | "pass"
            | "token"
            | "secret"
            | "secretkey"
            | "apikey"
            | "authkey"
            | "authtoken"
            | "accesstoken"
    ) || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("token")
        || normalized.contains("apikey")
        || normalized.contains("authkey")
}
