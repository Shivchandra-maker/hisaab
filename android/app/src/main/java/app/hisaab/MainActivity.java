package app.hisaab;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static String launchRoute;

    /** Screen to open when started from a "new payment" notification, read once by the web app. */
    static synchronized String takeLaunchRoute() {
        String r = launchRoute;
        launchRoute = null;
        return r;
    }

    private static synchronized void rememberRoute(Intent intent) {
        if (intent != null && intent.hasExtra("route")) launchRoute = intent.getStringExtra("route");
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CapturePlugin.class);
        rememberRoute(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        rememberRoute(intent);
    }
}
