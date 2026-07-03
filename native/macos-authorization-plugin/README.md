# FinalJudoAuthorizationPlugin

macOS Authorization Services plug-in bundle for the Final Judo Multi Gym workspace.

This implementation is intentionally conservative:

- It exports the required `AuthorizationPluginCreate` entry point.
- It implements the `AuthorizationPluginInterface` lifecycle callbacks.
- It supports one mechanism, `pass`, which calls `SetResult(..., kAuthorizationResultAllow)`.
- It does not read, log, store, or forward user credentials, context values, hints, or tokens.

The mechanism entry for the authorization database is:

```text
FinalJudoAuthorizationPlugin:pass,privileged
```

## Build

```sh
make -C native/macos-authorization-plugin
make -C native/macos-authorization-plugin inspect
```

The output bundle is:

```text
native/macos-authorization-plugin/build/FinalJudoAuthorizationPlugin.bundle
```

## Install Bundle

Installing a Security Agent plug-in changes local macOS security behavior. Keep an existing admin session open while testing.

```sh
native/macos-authorization-plugin/scripts/install-bundle.sh
```

This copies the bundle to:

```text
/Library/Security/SecurityAgentPlugins/FinalJudoAuthorizationPlugin.bundle
```

## Update Authorization DB

Dry-run first:

```sh
native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh \
  --rule system.login.console \
  --mechanism FinalJudoAuthorizationPlugin:pass,privileged \
  --after loginwindow:login
```

Apply only after reviewing the diff:

```sh
native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh \
  --rule system.login.console \
  --mechanism FinalJudoAuthorizationPlugin:pass,privileged \
  --after loginwindow:login \
  --apply
```

The script writes a timestamped backup under:

```text
~/Library/Application Support/FinalJudoAuthorizationPlugin/backups
```

## Rollback

Remove the authorization DB mechanism first:

```sh
native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh \
  --rule system.login.console \
  --mechanism FinalJudoAuthorizationPlugin:pass,privileged \
  --remove \
  --apply
```

Then remove the installed bundle:

```sh
native/macos-authorization-plugin/scripts/uninstall-bundle.sh
```

## Notes

Apple's Authorization Plug-in API is macOS-only. Do not add this plug-in to iOS, iPadOS, or Capacitor targets.
