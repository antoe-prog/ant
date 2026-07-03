# macOS Authorization Plug-in Runbook

This repo includes a macOS-only Authorization Services plug-in at:

```text
native/macos-authorization-plugin
```

It follows Apple's Authorization Plug-in model: the bundle exports `AuthorizationPluginCreate`, returns an `AuthorizationPluginInterface`, creates mechanism instances, and reports mechanism decisions through the authorization engine callback `SetResult`.

## Safety Model

The current mechanism is a pass-through integration check:

```text
FinalJudoAuthorizationPlugin:pass,privileged
```

It allows the authorization evaluation to continue and deliberately avoids reading context values, hints, token identities, usernames, passwords, or other authentication material.

## Build Verification

```sh
make -C native/macos-authorization-plugin clean
make -C native/macos-authorization-plugin
make -C native/macos-authorization-plugin inspect
```

## System Install Flow

1. Build and inspect the bundle.
2. Keep an admin session open for rollback.
3. Install the bundle:

```sh
native/macos-authorization-plugin/scripts/install-bundle.sh
```

4. Dry-run the authorization DB edit:

```sh
native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh \
  --rule system.login.console \
  --mechanism FinalJudoAuthorizationPlugin:pass,privileged \
  --after loginwindow:login
```

5. Apply only after reviewing the diff:

```sh
native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh \
  --rule system.login.console \
  --mechanism FinalJudoAuthorizationPlugin:pass,privileged \
  --after loginwindow:login \
  --apply
```

## Rollback Flow

```sh
native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh \
  --rule system.login.console \
  --mechanism FinalJudoAuthorizationPlugin:pass,privileged \
  --remove \
  --apply

native/macos-authorization-plugin/scripts/uninstall-bundle.sh
```

## Chrome Note

The Apple documentation page can be inspected in Chrome when the Codex Chrome Extension is enabled. If Chrome control is unavailable, use Apple's official Security framework headers in the installed macOS SDK as the source of truth for callback signatures.
