import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let backgroundColor = UIColor(red: 22 / 255, green: 19 / 255, blue: 19 / 255, alpha: 1)
    private var webView: WKWebView!
    private var webRoot: URL?
    private var isPaused = true
    private var contentRulesReady = false

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .bottom }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .landscapeRight }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = backgroundColor

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__IP_PLEASE_NATIVE__ = true; window.__IP_PLEASE_NATIVE_PAUSED__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = backgroundColor
        webView.scrollView.backgroundColor = backgroundColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.accessibilityIdentifier = "gameWebView"
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        let safeArea = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: safeArea.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: safeArea.trailingAnchor),
            webView.topAnchor.constraint(equalTo: safeArea.topAnchor),
            webView.bottomAnchor.constraint(equalTo: safeArea.bottomAnchor)
        ])

        // Compile before loading: remote subresources must be blocked from the first request.
        let rules = """
        [
          {"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}},
          {"trigger":{"url-filter":"^ftp://"},"action":{"type":"block"}}
        ]
        """
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: "IPPleaseOfflineOnly",
            encodedContentRuleList: rules
        ) { [weak self] ruleList, _ in
            guard let self else { return }
            guard let ruleList else {
                self.showLoadError("无法启用离线资源保护，请重新打开游戏。")
                return
            }
            self.webView.configuration.userContentController.add(ruleList)
            self.contentRulesReady = true
            self.loadGame()
        }
    }

    func setPaused(_ paused: Bool) {
        isPaused = paused
        guard isViewLoaded else { return }
        let value = paused ? "true" : "false"
        webView.evaluateJavaScript("""
        window.__IP_PLEASE_NATIVE_PAUSED__ = \(value);
        if (typeof window.setNativePaused === 'function') window.setNativePaused(\(value));
        """)
        webView.setAllMediaPlaybackSuspended(paused, completionHandler: nil)
    }

    private func loadGame() {
        guard contentRulesReady else { return }
        guard let root = Bundle.main.url(forResource: "web", withExtension: nil),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            showLoadError("游戏资源不完整，请重新安装。")
            return
        }
        webRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        webView.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
    }

    private func isBundledGameURL(_ url: URL?) -> Bool {
        guard let url, url.isFileURL, let webRoot else { return false }
        return url.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(webRoot.path + "/")
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(isBundledGameURL(navigationAction.request.url) ? .allow : .cancel)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(isBundledGameURL(navigationResponse.response.url) ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        setPaused(isPaused)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loadGame()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        showLoadError("游戏暂时无法打开，请重新启动应用。")
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // The bundled game never needs another window or an external browser.
        return nil
    }

    private func showLoadError(_ message: String) {
        let label = UILabel()
        label.text = message
        label.textColor = UIColor(red: 228 / 255, green: 223 / 255, blue: 212 / 255, alpha: 1)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)
        ])
    }
}
