using System.Text.Json;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;
using Xunit;

public sealed class AuthSessionTests : IDisposable
{
    private const string Tenant = "11111111-1111-1111-1111-111111111111";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "datapad-auth-unit-" + Guid.NewGuid().ToString("N"));
    private AuthRequest Request(string operation, bool remember = false) => new(operation, Tenant,
        "22222222-2222-2222-2222-222222222222", new string('a', 64), directory, remember);
    private string Marker => Path.Combine(directory, new string('a', 64) + ".remember");
    private static JsonElement Json(object value) => JsonSerializer.SerializeToElement(value);
    private static Task<MsalCacheHelper> LockedCache() => throw new AuthFailure("secure-cache-unavailable");

    [Theory]
    [InlineData(null)] [InlineData("common")] [InlineData("organizations")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public void AuthorityMustBeAnExplicitOrganisation(string? tenant) => Assert.False(AuthPolicy.IsOrganisationId(tenant));

    [Fact]
    public void ExpiredAndNearExpiryTokensNeedRenewal()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.True(AuthPolicy.NeedsRenewal(now.AddSeconds(-1), now));
        Assert.True(AuthPolicy.NeedsRenewal(now.AddMinutes(5), now));
        Assert.False(AuthPolicy.NeedsRenewal(now.AddMinutes(6), now));
    }

    [Theory]
    [InlineData(0, false)] [InlineData(1, true)] [InlineData(2, false)]
    public void NeverSelectAnArbitraryCachedAccount(int count, bool allowed) => Assert.Equal(allowed, AuthPolicy.HasUnambiguousAccount(count));

    [Fact]
    public void WrongTenantIsRejected()
    {
        Assert.Equal("tenant-mismatch", Assert.Throws<AuthFailure>(() => AuthPolicy.RequireTenant(Guid.NewGuid().ToString(), Tenant)).Code);
        AuthPolicy.RequireTenant(Tenant.ToUpperInvariant(), Tenant);
    }

    [Fact]
    public async Task RememberRequiresSecureStorageBeforeOpeningBrowser()
    {
        var browserOpened = false;
        var session = new AuthSession(Request("status"), (_, _) => { browserOpened = true; throw new Exception(); }, LockedCache);
        var failure = await Assert.ThrowsAsync<AuthFailure>(() => session.Execute(Request("sign-in", true)));
        Assert.Equal("secure-cache-unavailable", failure.Code);
        Assert.False(browserOpened);
        Assert.False(Directory.Exists(directory));
    }

    [Fact]
    public async Task CanceledSessionOnlySignInDoesNotTouchExistingRememberedAccount()
    {
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Marker, "1");
        var session = new AuthSession(Request("status"), (_, _) => throw new OperationCanceledException(), LockedCache);
        await Assert.ThrowsAsync<OperationCanceledException>(() => session.Execute(Request("sign-in")));
        Assert.True(File.Exists(Marker));
        Assert.Equal("sign-in-required", (await Assert.ThrowsAsync<AuthFailure>(() => session.Execute(Request("complete-sign-in")))).Code);
    }

    [Fact]
    public async Task SessionOnlyCanReplaceRememberingWhenKeyringIsUnavailableAfterBackendAcceptance()
    {
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Marker, "1");
        var session = new AuthSession(Request("status"), (_, _) => Task.FromResult(FakeResult()), LockedCache);
        var staged = Json(await session.Execute(Request("sign-in")));
        Assert.Equal("awaiting-acceptance", staged.GetProperty("state").GetString());
        Assert.True(File.Exists(Marker));
        Assert.DoesNotContain("unit-token", staged.GetRawText());
        var accepted = Json(await session.Execute(Request("complete-sign-in")));
        Assert.Equal("signed-in", accepted.GetProperty("state").GetString());
        Assert.False(accepted.GetProperty("remembered").GetBoolean());
        Assert.Equal("remembered-cache-not-cleared", accepted.GetProperty("warning").GetString());
        Assert.False(File.Exists(Marker));
        Assert.DoesNotContain("unit-token", accepted.GetRawText());
        var signedOut = Json(await session.Execute(Request("sign-out")));
        Assert.Equal("signed-out", signedOut.GetProperty("state").GetString());
        Assert.Equal("remembered-cache-not-cleared", signedOut.GetProperty("warning").GetString());
    }

    [Fact]
    public async Task SilentAcquisitionAndStatusNeverCallBrowser()
    {
        var session = new AuthSession(Request("status"), (_, _) => throw new InvalidOperationException("browser-called"));
        Assert.Equal("signed-out", Json(await session.Execute(Request("status"))).GetProperty("state").GetString());
        Assert.Equal("sign-in-required", (await Assert.ThrowsAsync<AuthFailure>(() => session.Execute(Request("token")))).Code);
        Assert.False(Directory.Exists(directory));
    }

    [Fact]
    public async Task RevokedConsentIsNotRetried()
    {
        var calls = 0;
        var session = new AuthSession(Request("status"), (_, _) => { calls++; throw new MsalUiRequiredException("consent_required", "unit-private-detail"); });
        await Assert.ThrowsAsync<MsalUiRequiredException>(() => session.Execute(Request("sign-in")));
        Assert.Equal(1, calls);
        Assert.Equal("sign-in-required", (await Assert.ThrowsAsync<AuthFailure>(() => session.Execute(Request("complete-sign-in")))).Code);
    }

    private static AuthenticationResult FakeResult() => new("unit-token", false, "unit-user", DateTimeOffset.UtcNow.AddHours(1),
        DateTimeOffset.UtcNow.AddHours(1), Tenant, new FakeAccount(), "", ["https://database.windows.net/.default"], Guid.Empty);
    private sealed class FakeAccount : IAccount
    {
        public string Username => "unit@example.test";
        public string Environment => "login.microsoftonline.com";
        public AccountId HomeAccountId => new("unit." + Tenant, "unit", Tenant);
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
