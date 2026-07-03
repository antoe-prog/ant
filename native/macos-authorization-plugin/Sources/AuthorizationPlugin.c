#include <CoreFoundation/CoreFoundation.h>
#include <Security/AuthorizationPlugin.h>
#include <os/log.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define FJ_PLUGIN_NAME "FinalJudoAuthorizationPlugin"
#define FJ_MECHANISM_PASS "pass"

typedef struct {
    const AuthorizationCallbacks *callbacks;
} FJAuthorizationPlugin;

typedef struct {
    FJAuthorizationPlugin *plugin;
    AuthorizationEngineRef engine;
    char *mechanism_id;
} FJAuthorizationMechanism;

static os_log_t FJLog(void) {
    static os_log_t log;
    if (log == NULL) {
        log = os_log_create("kr.co.finaljudo.multigym.authorizationplugin", "authorization");
    }
    return log;
}

static char *FJCopyCString(const char *value) {
    if (value == NULL) {
        value = "";
    }

    size_t length = strlen(value);
    char *copy = calloc(length + 1, sizeof(char));
    if (copy == NULL) {
        return NULL;
    }

    memcpy(copy, value, length);
    return copy;
}

static bool FJMechanismIdMatches(const char *raw_id, const char *expected_id) {
    if (raw_id == NULL || expected_id == NULL) {
        return false;
    }

    const char *id = raw_id;
    const char *prefix = FJ_PLUGIN_NAME ":";
    size_t prefix_length = strlen(prefix);
    if (strncmp(id, prefix, prefix_length) == 0) {
        id += prefix_length;
    }

    size_t id_length = strcspn(id, ",");
    return strlen(expected_id) == id_length && strncmp(id, expected_id, id_length) == 0;
}

static bool FJMechanismIsSupported(const char *mechanism_id) {
    return FJMechanismIdMatches(mechanism_id, FJ_MECHANISM_PASS);
}

static OSStatus FJPluginDestroy(AuthorizationPluginRef inPlugin) {
    FJAuthorizationPlugin *plugin = (FJAuthorizationPlugin *)inPlugin;
    if (plugin != NULL) {
        free(plugin);
    }
    return errAuthorizationSuccess;
}

static OSStatus FJMechanismCreate(AuthorizationPluginRef inPlugin,
                                  AuthorizationEngineRef inEngine,
                                  AuthorizationMechanismId mechanismId,
                                  AuthorizationMechanismRef *outMechanism) {
    if (inPlugin == NULL || inEngine == NULL || outMechanism == NULL || mechanismId == NULL) {
        os_log_error(FJLog(), "MechanismCreate received invalid input.");
        return errAuthorizationInternal;
    }

    if (!FJMechanismIsSupported(mechanismId)) {
        os_log_error(FJLog(), "Unsupported mechanism id: %{public}s", mechanismId);
        return errAuthorizationInternal;
    }

    FJAuthorizationMechanism *mechanism = calloc(1, sizeof(FJAuthorizationMechanism));
    if (mechanism == NULL) {
        return errAuthorizationInternal;
    }

    mechanism->plugin = (FJAuthorizationPlugin *)inPlugin;
    mechanism->engine = inEngine;
    mechanism->mechanism_id = FJCopyCString(mechanismId);
    if (mechanism->mechanism_id == NULL) {
        free(mechanism);
        return errAuthorizationInternal;
    }

    *outMechanism = mechanism;
    os_log(FJLog(), "Created authorization mechanism: %{public}s", mechanism->mechanism_id);
    return errAuthorizationSuccess;
}

static OSStatus FJMechanismInvoke(AuthorizationMechanismRef inMechanism) {
    FJAuthorizationMechanism *mechanism = (FJAuthorizationMechanism *)inMechanism;
    if (mechanism == NULL || mechanism->plugin == NULL || mechanism->plugin->callbacks == NULL) {
        return errAuthorizationInternal;
    }

    const AuthorizationCallbacks *callbacks = mechanism->plugin->callbacks;
    if (callbacks->SetResult == NULL) {
        return errAuthorizationInternal;
    }

    if (FJMechanismIdMatches(mechanism->mechanism_id, FJ_MECHANISM_PASS)) {
        os_log(FJLog(), "Allowing pass-through authorization mechanism.");
        return callbacks->SetResult(mechanism->engine, kAuthorizationResultAllow);
    }

    os_log_error(FJLog(), "No invoke handler for mechanism: %{public}s", mechanism->mechanism_id);
    return callbacks->SetResult(mechanism->engine, kAuthorizationResultUndefined);
}

static OSStatus FJMechanismDeactivate(AuthorizationMechanismRef inMechanism) {
    FJAuthorizationMechanism *mechanism = (FJAuthorizationMechanism *)inMechanism;
    if (mechanism == NULL || mechanism->plugin == NULL || mechanism->plugin->callbacks == NULL) {
        return errAuthorizationInternal;
    }

    const AuthorizationCallbacks *callbacks = mechanism->plugin->callbacks;
    if (callbacks->DidDeactivate == NULL) {
        return errAuthorizationInternal;
    }

    return callbacks->DidDeactivate(mechanism->engine);
}

static OSStatus FJMechanismDestroy(AuthorizationMechanismRef inMechanism) {
    FJAuthorizationMechanism *mechanism = (FJAuthorizationMechanism *)inMechanism;
    if (mechanism != NULL) {
        free(mechanism->mechanism_id);
        free(mechanism);
    }

    return errAuthorizationSuccess;
}

static const AuthorizationPluginInterface FJPluginInterface = {
    .version = kAuthorizationPluginInterfaceVersion,
    .PluginDestroy = FJPluginDestroy,
    .MechanismCreate = FJMechanismCreate,
    .MechanismInvoke = FJMechanismInvoke,
    .MechanismDeactivate = FJMechanismDeactivate,
    .MechanismDestroy = FJMechanismDestroy,
};

__attribute__((visibility("default")))
OSStatus AuthorizationPluginCreate(const AuthorizationCallbacks *callbacks,
                                   AuthorizationPluginRef *outPlugin,
                                   const AuthorizationPluginInterface **outPluginInterface) {
    if (callbacks == NULL || outPlugin == NULL || outPluginInterface == NULL) {
        return errAuthorizationInternal;
    }

    if (callbacks->SetResult == NULL || callbacks->DidDeactivate == NULL) {
        os_log_error(FJLog(), "Authorization engine did not provide required callbacks.");
        return errAuthorizationInternal;
    }

    if (callbacks->version > kAuthorizationCallbacksVersion) {
        os_log(FJLog(), "Authorization callback interface is newer than this build: %{public}u", callbacks->version);
    }

    FJAuthorizationPlugin *plugin = calloc(1, sizeof(FJAuthorizationPlugin));
    if (plugin == NULL) {
        return errAuthorizationInternal;
    }

    plugin->callbacks = callbacks;
    *outPlugin = plugin;
    *outPluginInterface = &FJPluginInterface;

    os_log(FJLog(), "Authorization plugin initialized.");
    return errAuthorizationSuccess;
}
