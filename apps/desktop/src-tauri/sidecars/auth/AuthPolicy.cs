internal static class AuthPolicy
{
    public static bool IsOrganisationId(string? value) => Guid.TryParse(value, out var id) && id != Guid.Empty;
    public static bool HasUnambiguousAccount(int count) => count == 1;
    public static bool NeedsRenewal(DateTimeOffset expiry, DateTimeOffset now) => expiry <= now.AddMinutes(5);
    public static void RequireTenant(string? actual, string? expected)
    {
        if (!IsOrganisationId(actual) || !string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            throw new AuthFailure("tenant-mismatch");
    }
}
