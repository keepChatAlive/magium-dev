package org.magium.offline;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsResult;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.android.material.color.DynamicColors;
import com.google.android.material.color.MaterialColors;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A small offline host. All story, settings and save logic live in bundled web assets. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/index.html";
    private static final int IMPORT_SAVE = 1001;
    private static final int EXPORT_SAVE = 1002;
    private static final int MAX_SAVE_BYTES = 8 * 1024 * 1024;

    private final ExecutorService fileIo = Executors.newSingleThreadExecutor();
    private WebView webView;
    private FrameLayout container;
    private JavaScriptReplyProxy pendingReply;
    private byte[] pendingExport;
    private boolean saveBusy;
    private JSONObject systemPalette = new JSONObject();
    private int systemSurface = Color.rgb(255, 251, 254);
    private boolean systemDark;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        DynamicColors.applyToActivityIfAvailable(this);
        refreshSystemPalette();
        container = new FrameLayout(this);
        container.setBackgroundColor(systemSurface);
        setContentView(container);
        configureInsets();
        createReader();
        applyTheme(toCssColor(systemSurface), systemDark);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private void configureInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            container.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                                | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
            container.requestApplyInsets();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    private void createReader() {
        try {
            webView = new WebView(this);
        } catch (RuntimeException unavailable) {
            TextView error = new TextView(this);
            error.setText(R.string.webview_unavailable);
            error.setPadding(32, 48, 32, 32);
            error.setTextSize(18);
            container.addView(error);
            return;
        }
        webView.setBackgroundColor(systemSurface);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        // The original web UI uses alert/confirm for save imports and overwrites.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton(android.R.string.ok, (dialog, which) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isAssetUrl(request.getUrl()) || !"GET".equals(request.getMethod())) {
                    return emptyResponse(403, "Blocked");
                }
                WebResourceResponse response = assetLoader.shouldInterceptRequest(request.getUrl());
                return response != null ? response : emptyResponse(404, "Not Found");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // No implicit external browser, intent, file, data, or content navigation.
                return !isAssetUrl(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (isAssetUrl(Uri.parse(url))) pushSystemPalette(view);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                container.removeView(view);
                view.destroy();
                webView = null;
                clearPendingSave();
                Toast.makeText(MainActivity.this, R.string.reader_restarted, Toast.LENGTH_LONG).show();
                container.post(MainActivity.this::createReader);
                return true;
            }
        });

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "MagiumNative",
                    Collections.singleton(ORIGIN), (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (!isMainFrame || !ORIGIN.equals(sourceOrigin.toString())) return;
                        String data = message.getData();
                        if (data == null || data.length() > MAX_SAVE_BYTES + 1024) return;
                        handleMessage(data, reply);
                    });
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView,
                    "globalThis.MAGIUM_SYSTEM_PALETTE=" + systemPalette + ";",
                    Collections.singleton(ORIGIN));
        }
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(START_URL);
    }

    private static boolean isAssetUrl(Uri uri) {
        return "https".equals(uri.getScheme())
                && "appassets.androidplatform.net".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null
                && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    private static WebResourceResponse emptyResponse(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason,
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private void refreshSystemPalette() {
        systemDark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int fallbackSurface = systemDark ? Color.rgb(20, 18, 24) : Color.rgb(255, 251, 254);
        systemSurface = MaterialColors.getColor(this,
                com.google.android.material.R.attr.colorSurface, fallbackSurface);
        try {
            systemPalette = new JSONObject()
                    .put("surface", toCssColor(systemSurface))
                    .put("onSurface", materialColor(com.google.android.material.R.attr.colorOnSurface,
                            systemDark ? 0xffe6e0e9 : 0xff1d1b20))
                    .put("surfaceContainer", materialColor(com.google.android.material.R.attr.colorSurfaceContainer,
                            systemDark ? 0xff211f26 : 0xfff3edf7))
                    .put("surfaceContainerHigh", materialColor(com.google.android.material.R.attr.colorSurfaceContainerHigh,
                            systemDark ? 0xff2b2930 : 0xffece6f0))
                    .put("primary", materialColor(androidx.appcompat.R.attr.colorPrimary,
                            systemDark ? 0xffd0bcff : 0xff6750a4))
                    .put("onPrimary", materialColor(com.google.android.material.R.attr.colorOnPrimary,
                            systemDark ? 0xff381e72 : 0xffffffff))
                    .put("primaryContainer", materialColor(com.google.android.material.R.attr.colorPrimaryContainer,
                            systemDark ? 0xff4f378b : 0xffeaddff))
                    .put("onPrimaryContainer", materialColor(com.google.android.material.R.attr.colorOnPrimaryContainer,
                            systemDark ? 0xffeaddff : 0xff21005d))
                    .put("secondaryContainer", materialColor(com.google.android.material.R.attr.colorSecondaryContainer,
                            systemDark ? 0xff4a4458 : 0xffe8def8))
                    .put("onSecondaryContainer", materialColor(com.google.android.material.R.attr.colorOnSecondaryContainer,
                            systemDark ? 0xffe8def8 : 0xff1d192b))
                    .put("outline", materialColor(com.google.android.material.R.attr.colorOutline,
                            systemDark ? 0xff938f99 : 0xff79747e))
                    .put("errorContainer", materialColor(com.google.android.material.R.attr.colorErrorContainer,
                            systemDark ? 0xff93000a : 0xfff9dedc))
                    .put("onErrorContainer", materialColor(com.google.android.material.R.attr.colorOnErrorContainer,
                            systemDark ? 0xffffdad6 : 0xff410e0b))
                    .put("dark", systemDark);
        } catch (JSONException impossible) {
            systemPalette = new JSONObject();
        }
    }

    private String materialColor(int attribute, int fallback) {
        return toCssColor(MaterialColors.getColor(this, attribute, fallback));
    }

    private static String toCssColor(int color) {
        return String.format(Locale.US, "#%06x", color & 0x00ffffff);
    }

    private void pushSystemPalette(WebView target) {
        if (target == null || systemPalette.length() == 0) return;
        target.evaluateJavascript("globalThis.MAGIUM_SYSTEM_PALETTE=" + systemPalette
                + ";if(typeof applySystemPalette==='function')applySystemPalette(globalThis.MAGIUM_SYSTEM_PALETTE);", null);
    }

    private void handleMessage(String raw, JavaScriptReplyProxy reply) {
        try {
            JSONObject message = new JSONObject(raw);
            String type = message.optString("type");
            if ("theme".equals(type)) {
                applyTheme(message.optString("background"), message.optBoolean("dark"));
                return;
            }
            if (!"import-save".equals(type) && !"export-save".equals(type)) return;
            if (saveBusy) {
                sendError(reply, R.string.save_busy);
                return;
            }
            pendingReply = reply;
            saveBusy = true;
            if ("import-save".equals(type)) {
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                startActivityForResult(picker, IMPORT_SAVE);
            } else {
                String text = message.getString("data");
                pendingExport = text.getBytes(StandardCharsets.UTF_8);
                if (pendingExport.length > MAX_SAVE_BYTES) throw new JSONException("Save is too large");
                new JSONObject(text);
                String name = message.optString("name", "magium-save.json")
                        .replaceAll("[^a-zA-Z0-9._-]", "_");
                if (name.length() > 96 || name.isEmpty()) name = "magium-save.json";
                Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("application/json");
                picker.putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(picker, EXPORT_SAVE);
            }
        } catch (ActivityNotFoundException unavailable) {
            sendError(reply, R.string.file_unavailable);
            clearPendingSave();
        } catch (JSONException invalid) {
            sendError(reply, R.string.invalid_save);
            clearPendingSave();
        }
    }

    @SuppressWarnings("deprecation")
    private void applyTheme(String background, boolean dark) {
        if (!background.matches("#[0-9a-fA-F]{6}")) return;
        int color = Color.parseColor(background);
        container.setBackgroundColor(color);
        if (webView != null) webView.setBackgroundColor(color);
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : light, light);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 :
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent intent) {
        super.onActivityResult(requestCode, resultCode, intent);
        if (requestCode != IMPORT_SAVE && requestCode != EXPORT_SAVE) return;
        JavaScriptReplyProxy reply = pendingReply;
        byte[] export = pendingExport;
        if (reply == null) {
            clearPendingSave();
            return;
        }
        if (resultCode != RESULT_OK || intent == null || intent.getData() == null) {
            sendMessage(reply, "save-cancelled", null, null);
            clearPendingSave();
            return;
        }
        Uri uri = intent.getData();
        // Only the document explicitly selected by the user is opened.
        fileIo.execute(() -> {
            try {
                if (requestCode == EXPORT_SAVE) {
                    if (export == null) throw new IOException("Missing export");
                    try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                        if (output == null) throw new IOException("No stream");
                        output.write(export);
                    }
                    runOnUiThread(() -> {
                        sendMessage(reply, "export-save", "ok", true);
                        clearPendingSave();
                    });
                } else {
                    String imported;
                    try (InputStream input = getContentResolver().openInputStream(uri)) {
                        if (input == null) throw new IOException("No stream");
                        ByteArrayOutputStream output = new ByteArrayOutputStream();
                        byte[] buffer = new byte[8192];
                        int length;
                        while ((length = input.read(buffer)) != -1) {
                            if (output.size() + length > MAX_SAVE_BYTES) throw new JSONException("Save is too large");
                            output.write(buffer, 0, length);
                        }
                        imported = output.toString(StandardCharsets.UTF_8.name());
                        if (imported.startsWith("\uFEFF")) imported = imported.substring(1);
                        new JSONObject(imported);
                    }
                    String result = imported;
                    runOnUiThread(() -> {
                        sendMessage(reply, "import-save", "data", result);
                        clearPendingSave();
                    });
                }
            } catch (IOException | SecurityException | JSONException failure) {
                runOnUiThread(() -> {
                    sendError(reply, failure instanceof JSONException ? R.string.invalid_save : R.string.save_failed);
                    clearPendingSave();
                });
            }
        });
    }

    private void clearPendingSave() {
        pendingReply = null;
        pendingExport = null;
        saveBusy = false;
    }

    private void sendError(JavaScriptReplyProxy reply, int message) {
        sendMessage(reply, "save-error", "message", getString(message));
    }

    private void sendMessage(JavaScriptReplyProxy reply, String type, String key, Object value) {
        if (isFinishing() || isDestroyed() || webView == null) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try {
            JSONObject response = new JSONObject().put("type", type);
            if (key != null) response.put(key, value);
            reply.postMessage(response.toString());
        } catch (JSONException ignored) {
            // Constant keys and primitive/string values cannot fail JSON encoding.
        }
    }

    private void handleBack() {
        if (webView == null) {
            finish();
            return;
        }
        webView.evaluateJavascript("Boolean(window.MagiumApp && typeof window.MagiumApp.onBack==='function' && window.MagiumApp.onBack())", handled -> {
            if (!"true".equals(handled) && webView != null) {
                if (webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }

    @Override
    // API 33+ uses the platform OnBackInvokedDispatcher registered in onCreate;
    // this override exists only for devices running API 26 through 32.
    @SuppressLint("GestureBackNavigation")
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        refreshSystemPalette();
        pushSystemPalette(webView);
        container.requestApplyInsets();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        clearPendingSave();
        if (webView != null) {
            container.removeView(webView);
            webView.destroy();
            webView = null;
        }
        fileIo.shutdown();
        super.onDestroy();
    }
}
