using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;

// Private parent/child pipes only. stdout is a protocol channel, never a log sink.
// One helper owns exactly one workspace/connection/environment/tenant/client binding.
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
AuthSession? session = null;
while (await Console.In.ReadLineAsync() is { } line)
{
    object response;
    try
    {
        if (line.Length > 16_384) throw new AuthFailure("invalid-request");
        var request = JsonSerializer.Deserialize<AuthRequest>(line, json)
            ?? throw new AuthFailure("invalid-request");
        if (request.Operation == "health") response = new { protocolVersion = 1 };
        else
        {
            session ??= new AuthSession(request);
            response = await session.Execute(request);
        }
    }
    catch (AuthFailure error) { response = new { error = error.Code }; }
    catch (OperationCanceledException) { response = new { error = "sign-in-canceled" }; }
    catch (MsalUiRequiredException) { response = new { error = "sign-in-required" }; }
    catch (MsalException) { response = new { error = "identity-provider-rejected" }; }
    catch { response = new { error = "authentication-helper-failed" }; }
    // Never forward provider exceptions: they may contain tokens, account claims or URLs.
    await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, json));
    await Console.Out.FlushAsync();
}

internal sealed record AuthRequest(string Operation, string? TenantId, string? ClientId,
    string? Binding, string? CacheDirectory, bool Remember = false);
internal sealed class AuthFailure(string code) : Exception { public string Code { get; } = code; }

internal sealed class AuthSession
{
    private static readonly string[] Scopes = ["https://database.windows.net/.default"];
    private IPublicClientApplication app;
    private readonly AuthRequest configuration;
    private readonly string marker;
    private readonly string pendingRemoval;
    private readonly Func<IPublicClientApplication, CancellationToken, Task<AuthenticationResult>> browser;
    private readonly Func<Task<MsalCacheHelper>>? cacheFactory;
    private MsalCacheHelper? cache;
    private bool remembered;
    private IPublicClientApplication? pendingApp;
    private AuthenticationResult? pendingResult;
    private MsalCacheHelper? pendingCache;
    private bool pendingRemember;

    public AuthSession(AuthRequest request,
        Func<IPublicClientApplication, CancellationToken, Task<AuthenticationResult>>? browser = null,
        Func<Task<MsalCacheHelper>>? cacheFactory = null)
    {
        if (!AuthPolicy.IsOrganisationId(request.TenantId) || !AuthPolicy.IsOrganisationId(request.ClientId)
            || request.Binding is not { Length: 64 } || request.Binding.Any(c => !char.IsAsciiHexDigit(c))
            || !Path.IsPathFullyQualified(request.CacheDirectory ?? ""))
            throw new AuthFailure("invalid-configuration");
        configuration = request;
        marker = Path.Combine(request.CacheDirectory!, request.Binding + ".remember");
        pendingRemoval = Path.Combine(request.CacheDirectory!, request.Binding + ".forget");
        this.browser = browser ?? ((client, cancellation) => client.AcquireTokenInteractive(Scopes)
            .WithUseEmbeddedWebView(false).WithPrompt(Prompt.SelectAccount).ExecuteAsync(cancellation));
        this.cacheFactory = cacheFactory;
        app = CreateApplication();
    }

    private IPublicClientApplication CreateApplication() => PublicClientApplicationBuilder.Create(configuration.ClientId)
            .WithAuthority(AzureCloudInstance.AzurePublic, configuration.TenantId)
            .WithRedirectUri("http://localhost")
            .WithLegacyCacheCompatibility(false)
            .Build();

    private async Task<MsalCacheHelper> CreateProtectedCache()
    {
        try
        {
            if (cacheFactory is not null) return await cacheFactory();
            Directory.CreateDirectory(configuration.CacheDirectory!);
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(configuration.CacheDirectory!, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            var storage = new StorageCreationPropertiesBuilder(configuration.Binding + ".msal", configuration.CacheDirectory)
                .WithMacKeyChain("com.datapadplusplus.entra", configuration.Binding)
                .WithLinuxKeyring("com.datapadplusplus.entra", "default", "DataPad++ Microsoft Entra sign-in",
                    new KeyValuePair<string, string>("application", "DataPadPlusPlus"),
                    new KeyValuePair<string, string>("binding", configuration.Binding!))
                .Build();
            var candidate = await MsalCacheHelper.CreateAsync(storage);
            candidate.VerifyPersistence();
            return candidate;
        }
        catch { throw new AuthFailure("secure-cache-unavailable"); }
    }

    private async Task EnableProtectedCache()
    {
        if (cache is not null) return;
        cache = await CreateProtectedCache();
        cache.RegisterCache(app.UserTokenCache);
    }

    private async Task<string?> ForgetRememberedCache()
    {
        // Deactivate restoration even if the OS keyring is locked. Never fall back
        // to plaintext, and report incomplete removal of old encrypted data.
        var hadCache = File.Exists(marker) || File.Exists(pendingRemoval) || cache is not null;
        File.Delete(marker);
        remembered = false;
        if (cache is not null) cache.UnregisterCache(app.UserTokenCache);
        try
        {
            if (hadCache)
            {
                var cleanupCache = cache ?? await CreateProtectedCache();
                var cleanupApp = CreateApplication();
                cleanupCache.RegisterCache(cleanupApp.UserTokenCache);
                try { foreach (var account in await cleanupApp.GetAccountsAsync()) await cleanupApp.RemoveAsync(account); }
                finally { cleanupCache.UnregisterCache(cleanupApp.UserTokenCache); }
            }
            File.Delete(pendingRemoval);
            return null;
        }
        catch { await File.WriteAllTextAsync(pendingRemoval, "1"); return "remembered-cache-not-cleared"; }
        finally { cache = null; }
    }

    public async Task<object> Execute(AuthRequest request)
    {
        if (request.Binding != configuration.Binding || request.TenantId != configuration.TenantId
            || request.ClientId != configuration.ClientId || request.CacheDirectory != configuration.CacheDirectory)
            throw new AuthFailure("binding-mismatch");
        using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(5));
        if (request.Operation == "sign-out")
        {
            pendingApp = null; pendingResult = null; pendingCache = null;
            var warning = await ForgetRememberedCache();
            app = CreateApplication();
            return new { state = "signed-out", remembered, warning };
        }
        if (request.Operation == "sign-in")
        {
            pendingApp = null; pendingResult = null; pendingCache = null;
            // Interactive results are memory-only until Rust accepts their scope.
            // A canceled/stale browser response cannot update the remembered account.
            var candidateCache = request.Remember ? await CreateProtectedCache() : null;
            var candidateApp = CreateApplication();
            var result = await browser(candidateApp, deadline.Token);
            AuthPolicy.RequireTenant(result.TenantId, configuration.TenantId);
            pendingApp = candidateApp; pendingResult = result; pendingCache = candidateCache;
            pendingRemember = request.Remember;
            return new { state = "awaiting-acceptance" };
        }
        if (request.Operation == "complete-sign-in")
        {
            if (pendingApp is null || pendingResult is null) throw new AuthFailure("sign-in-required");
            string? warning = null;
            if (pendingRemember)
            {
                if (pendingCache is null) throw new AuthFailure("secure-cache-unavailable");
                if (cache is not null) cache.UnregisterCache(app.UserTokenCache);
                var bytes = ((ITokenCacheSerializer)pendingApp.UserTokenCache).SerializeMsalV3();
                try
                {
                    // Despite the API name, MSAL encrypts these bytes into the configured
                    // protected OS store. No unencrypted persistence is configured.
                    pendingCache.SaveUnencryptedTokenCache(bytes);
                    await File.WriteAllTextAsync(marker, "1", deadline.Token);
                    File.Delete(pendingRemoval);
                }
                catch { File.Delete(marker); throw new AuthFailure("secure-cache-unavailable"); }
                finally { CryptographicOperations.ZeroMemory(bytes); }
                cache = pendingCache;
                cache.RegisterCache(pendingApp.UserTokenCache);
            }
            else warning = await ForgetRememberedCache();
            app = pendingApp; remembered = pendingRemember;
            var account = pendingResult.Account.Username;
            pendingApp = null; pendingResult = null; pendingCache = null;
            return new { state = "signed-in", account, remembered, warning };
        }
        if (request.Operation is not ("status" or "token")) throw new AuthFailure("invalid-request");
        if (File.Exists(marker)) { await EnableProtectedCache(); remembered = true; }
        var accounts = (await app.GetAccountsAsync()).ToArray();
        // The cache is private to this binding; never select the first of several accounts.
        if (!AuthPolicy.HasUnambiguousAccount(accounts.Length)) return request.Operation == "status"
            ? new { state = "signed-out", account = (string?)null, remembered }
            : throw new AuthFailure("sign-in-required");
        if (request.Operation == "status")
            return new { state = "signed-in", account = accounts[0].Username, remembered };
        var token = await app.AcquireTokenSilent(Scopes, accounts[0]).ExecuteAsync(deadline.Token);
        if (AuthPolicy.NeedsRenewal(token.ExpiresOn, DateTimeOffset.UtcNow))
            token = await app.AcquireTokenSilent(Scopes, accounts[0]).WithForceRefresh(true).ExecuteAsync(deadline.Token);
        AuthPolicy.RequireTenant(token.TenantId, configuration.TenantId);
        return new { accessToken = token.AccessToken };
    }
}
