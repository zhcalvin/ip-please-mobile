import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let gameController = GameViewController()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = gameController
        self.window = window
        window.makeKeyAndVisible()
    }

    func sceneWillResignActive(_ scene: UIScene) {
        gameController.setPaused(true)
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        gameController.setPaused(true)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        gameController.setPaused(false)
        UIApplication.shared.isIdleTimerDisabled = true
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        gameController.setPaused(true)
        UIApplication.shared.isIdleTimerDisabled = false
    }
}
