#!/usr/bin/env bash
# Run only inside a disposable D-Bus session (dbus-run-session). Never use or
# unlock the developer's normal keyring; CI fixture secrets stay isolated.
set -euo pipefail
set +x

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" || $# -eq 0 ]]; then
  echo 'Run with dbus-run-session and supply a desktop test command.' >&2
  exit 1
fi

fixture_keyring_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/datapad-e2e-keyring.XXXXXX")"
fixture_keyring_pid=''
cleanup() {
  if [[ -n "$fixture_keyring_pid" ]]; then
    kill "$fixture_keyring_pid" 2>/dev/null || true
    wait "$fixture_keyring_pid" 2>/dev/null || true
  fi
  # Only remove the private directory returned by mktemp, never a parent path.
  if [[ -d "$fixture_keyring_dir" && "${fixture_keyring_dir##*/}" == datapad-e2e-keyring.* ]]; then
    rm -rf -- "$fixture_keyring_dir"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export XDG_DATA_HOME="$fixture_keyring_dir/data"
export XDG_CONFIG_HOME="$fixture_keyring_dir/config"
export XDG_CACHE_HOME="$fixture_keyring_dir/cache"
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
unset GNOME_KEYRING_CONTROL GNOME_KEYRING_PID

# Random, process-local unlock password: no plaintext file or workflow secret.
fixture_keyring_password="$(openssl rand -hex 32)"
gnome-keyring-daemon --foreground --components=secrets --unlock \
  <<< "$fixture_keyring_password" > "$fixture_keyring_dir/daemon.log" 2>&1 &
fixture_keyring_pid=$!
unset fixture_keyring_password

# Do not let secret-tool auto-activate a second, locked daemon while the
# explicitly unlocked one is still starting. Querying the bus owner is read-only.
fixture_keyring_ready=0
for ((attempt = 0; attempt < 40; attempt++)); do
  if ! kill -0 "$fixture_keyring_pid" 2>/dev/null; then
    break
  fi
  if timeout 2s dbus-send --session --print-reply --dest=org.freedesktop.DBus \
    /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner \
    string:org.freedesktop.secrets | grep -q 'boolean true'; then
    fixture_keyring_ready=1
    break
  fi
  sleep 0.25
done
if [[ "$fixture_keyring_ready" -ne 1 ]]; then
  echo 'The isolated fixture keyring daemon did not become ready.' >&2
  exit 1
fi

# Verify write AND read before launching the app. D-Bus activation/readiness is
# bounded; errors here must not become misleading datastore login failures.
if ! timeout 20s secret-tool store --label='DataPad++ CI keyring probe' \
  service DataPadPlusPlusFixture account readiness <<< 'fixture-ready'; then
  echo 'Unable to initialize the isolated fixture credential store.' >&2
  exit 1
fi
if [[ "$(timeout 10s secret-tool lookup service DataPadPlusPlusFixture account readiness)" != 'fixture-ready' ]]; then
  echo 'The isolated fixture credential store failed its read-back check.' >&2
  exit 1
fi
timeout 10s secret-tool clear service DataPadPlusPlusFixture account readiness

"$@"
