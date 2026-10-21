import XCTest

final class IPPleaseUITests: XCTestCase {
    func testBundledGameSurvivesBackgroundAndRelaunch() {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launch()

        let game = app.webViews["gameWebView"]
        XCTAssertTrue(game.waitForExistence(timeout: 20), "The bundled game should open offline")
        let soundButton = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ OR label CONTAINS %@", "声音", "Sound")).firstMatch
        XCTAssertTrue(soundButton.waitForExistence(timeout: 20), "The local page should finish loading")
        XCTAssertGreaterThan(game.frame.width, game.frame.height, "Gameplay should use landscape")

        // Use the game's 640 × 360 canvas coordinates while preserving its letterboxing.
        func point(_ x: CGFloat, _ y: CGFloat) -> XCUICoordinate {
            let frame = game.frame
            let scale = min(frame.width / 640, frame.height / 360)
            let origin = CGPoint(x: frame.midX - 320 * scale, y: frame.midY - 180 * scale)
            return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: origin.x + x * scale, dy: origin.y + y * scale))
        }
        func capture(_ name: String) {
            let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        Thread.sleep(forTimeInterval: 1)
        point(228, 172).tap() // Choose Chinese.
        XCTAssertTrue(app.buttons["声音：开"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.7)
        point(320, 180).tap() // Continue past the language stamp.
        Thread.sleep(forTimeInterval: 0.3)
        point(320, 180).tap() // Skip the intro.
        Thread.sleep(forTimeInterval: 2)
        point(320, 300).tap() // Start day one.
        Thread.sleep(forTimeInterval: 3)
        point(320, 180).tap() // Leave the newspaper and enter the booth.
        Thread.sleep(forTimeInterval: 0.5)
        point(15, 298).tap() // Call the first entrant.
        Thread.sleep(forTimeInterval: 5)
        capture("iOS first entrant")
        point(56, 271).press(forDuration: 0.2, thenDragTo: point(344, 200))
        Thread.sleep(forTimeInterval: 0.5)
        capture("iOS document dragged onto desk")

        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        app.activate()
        XCTAssertTrue(soundButton.waitForExistence(timeout: 10))
        capture("iOS gameplay after background return")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["声音：开"].waitForExistence(timeout: 20), "The selected language should persist after relaunch")
    }
}
