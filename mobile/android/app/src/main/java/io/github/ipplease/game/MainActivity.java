package io.github.ipplease.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private AlertDialog exitDialog;
    private boolean resumed;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Only packaged game code is allowed to load.
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(22, 19, 19));
        container.setKeepScreenOn(true);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(22, 19, 19));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        container.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(container);

        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            int left = 0, top = 0, right = 0, bottom = 0;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                left = safe.left;
                top = safe.top;
                right = safe.right;
                bottom = safe.bottom;
            } else if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = insets.getDisplayCutout();
                if (cutout != null) {
                    left = cutout.getSafeInsetLeft();
                    top = cutout.getSafeInsetTop();
                    right = cutout.getSafeInsetRight();
                    bottom = cutout.getSafeInsetBottom();
                }
            }
            view.setPadding(left, top, right, bottom);
            return insets;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        webView.setWebViewClient(new LocalGameClient());
        webView.loadUrl("https://" + ASSET_HOST + "/index.html?native=1");

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::confirmExit);
        }
        enterFullscreen();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) {
            webView.onResume();
            updateGamePause();
        }
        enterFullscreen();
    }

    @Override
    protected void onPause() {
        resumed = false;
        if (webView != null) {
            updateGamePause();
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) enterFullscreen();
    }

    @Override
    @SuppressWarnings("deprecation") // Back dispatch before Android 13.
    public void onBackPressed() {
        confirmExit();
    }

    private void confirmExit() {
        if (exitDialog != null) return;
        exitDialog = new AlertDialog.Builder(this)
                .setTitle(R.string.exit_title)
                .setMessage(R.string.exit_message)
                .setPositiveButton(R.string.exit_confirm, (dialog, which) -> finish())
                .setNegativeButton(R.string.exit_cancel, null)
                .create();
        exitDialog.setOnDismissListener(dialog -> {
            exitDialog = null;
            if (!isFinishing()) updateGamePause();
        });
        updateGamePause();
        exitDialog.show();
    }

    private void updateGamePause() {
        boolean paused = !resumed || exitDialog != null;
        webView.evaluateJavascript("window.__IP_PLEASE_NATIVE_PAUSED__ = " + paused
                + "; window.setNativePaused && window.setNativePaused(" + paused + ");", null);
    }

    @SuppressWarnings("deprecation") // Fullscreen support on Android 8–10.
    private void enterFullscreen() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    protected void onDestroy() {
        if (exitDialog != null) {
            exitDialog.setOnDismissListener(null);
            exitDialog.dismiss();
            exitDialog = null;
        }
        if (webView != null) {
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && ASSET_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private final class LocalGameClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request.getUrl());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri) || !"GET".equals(request.getMethod())) return error(403, "Forbidden");
            String path = uri.getPath();
            if (path == null || (!path.isEmpty() && !path.startsWith("/"))
                    || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) {
                return error(403, "Forbidden");
            }
            for (String segment : path.split("/")) {
                if (segment.equals("..") || segment.equals(".")) return error(403, "Forbidden");
            }
            String asset = path.isEmpty() || path.equals("/") ? "index.html" : path.substring(1);
            try {
                InputStream stream = getAssets().open(asset);
                String extension = MimeTypeMap.getFileExtensionFromUrl(asset).toLowerCase(Locale.ROOT);
                String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                if (extension.equals("js")) mime = "text/javascript";
                if (mime == null) mime = "application/octet-stream";
                String encoding = mime.startsWith("text/") || mime.equals("application/json")
                        ? "UTF-8" : null;
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Content-Security-Policy", "default-src 'self' data: blob:; "
                        + "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                        + "connect-src 'none'; object-src 'none'; frame-src 'none'; "
                        + "base-uri 'none'; form-action 'none'");
                return new WebResourceResponse(mime, encoding, 200, "OK", headers, stream);
            } catch (IOException missing) {
                return error(404, "Not Found");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            updateGamePause();
        }
    }

    private static WebResourceResponse error(int status, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", status, message, null,
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }
}
