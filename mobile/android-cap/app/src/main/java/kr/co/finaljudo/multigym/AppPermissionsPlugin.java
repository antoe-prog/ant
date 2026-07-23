package kr.co.finaljudo.multigym;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "AppPermissions",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class AppPermissionsPlugin extends Plugin {

    private static final String CAMERA = "camera";
    private static final String NOTIFICATIONS = "notifications";

    private String permissionValue(String alias) {
        if (NOTIFICATIONS.equals(alias) && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return PermissionState.GRANTED.toString();
        }

        PermissionState state = getPermissionState(alias);
        return state == null ? PermissionState.PROMPT.toString() : state.toString();
    }

    private void resolvePermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put(CAMERA, permissionValue(CAMERA));
        result.put(NOTIFICATIONS, permissionValue(NOTIFICATIONS));
        call.resolve(result);
    }

    @PluginMethod
    public void getPermissionStatus(PluginCall call) {
        resolvePermissionStatus(call);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String permission = call.getString("permission", "");

        if (!CAMERA.equals(permission) && !NOTIFICATIONS.equals(permission)) {
            call.reject("Unknown app permission.");
            return;
        }

        if (NOTIFICATIONS.equals(permission) && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermissionStatus(call);
            return;
        }

        requestPermissionForAlias(permission, call, "permissionRequestCallback");
    }

    @PermissionCallback
    private void permissionRequestCallback(PluginCall call) {
        resolvePermissionStatus(call);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
