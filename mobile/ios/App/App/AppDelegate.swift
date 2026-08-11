import UIKit
import AVFoundation
import UserNotifications
import Capacitor

@objc(AppPermissionsPlugin)
public class AppPermissionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppPermissionsPlugin"
    public let jsName = "AppPermissions"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPermissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    private enum PermissionAlias {
        case camera
        case notifications

        static func from(_ raw: String?) -> PermissionAlias? {
            switch raw {
            case "camera":
                return .camera
            case "notifications":
                return .notifications
            default:
                return nil
            }
        }
    }

    private func permissionStatus(for alias: PermissionAlias, completion: @escaping (String) -> Void) {
        switch alias {
        case .camera:
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                completion("granted")
            case .denied, .restricted:
                completion("denied")
            case .notDetermined:
                completion("prompt")
            @unknown default:
                completion("prompt")
            }
        case .notifications:
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                let status: String
                switch settings.authorizationStatus {
                case .authorized, .provisional, .ephemeral:
                    status = "granted"
                case .denied:
                    status = "denied"
                case .notDetermined:
                    status = "prompt"
                @unknown default:
                    status = "prompt"
                }
                completion(status)
            }
        }
    }

    private func resolvePermissionStatus(call: CAPPluginCall) {
        permissionStatus(for: .camera) { camera in
            self.permissionStatus(for: .notifications) { notifications in
                let result = [
                    "camera": camera,
                    "notifications": notifications
                ]
                call.resolve(result)
            }
        }
    }

    @objc public func getPermissionStatus(_ call: CAPPluginCall) {
        resolvePermissionStatus(call: call)
    }

    @objc public func requestPermission(_ call: CAPPluginCall) {
        guard let permission = PermissionAlias.from(call.getString("permission")) else {
            call.reject("Unknown app permission.")
            return
        }

        switch permission {
        case .camera:
            AVCaptureDevice.requestAccess(for: .video) { _ in
                self.resolvePermissionStatus(call: call)
            }
        case .notifications:
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
                if let error {
                    call.reject(error.localizedDescription)
                    return
                }
                _ = granted
                self.resolvePermissionStatus(call: call)
            }
        }
    }

    @objc public func openAppSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("App settings URL is unavailable.")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Unable to open app settings.")
                }
            }
        }
    }
}

@objc(FinalJudoBridgeViewController)
class FinalJudoBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppPermissionsPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
