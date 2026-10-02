package app.hisaab;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Bridge between Android and the Hisaab web app (src/native/capture.ts).
 *
 *   status()                 → permissions, notification access, items waiting
 *   requestSms()             → asks for SMS permission
 *   requestNotifications()   → asks to show "new payment" notifications (Android 13+)
 *   openNotificationAccess() → opens the Android screen to allow reading app notifications
 *   readInbox({sinceMs})     → bank messages already on the phone, for a one-time import
 *   getPending() / ack({ids})→ the capture queue filled while the app was closed
 *   setOptions({apps, notify})
 *   takeRoute()              → "inbox" when the app was opened from a capture notification
 */
@CapacitorPlugin(
        name = "HisaabCapture",
        permissions = {
            @Permission(strings = {Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS}, alias = "sms"),
            @Permission(strings = {"android.permission.POST_NOTIFICATIONS"}, alias = "notifications")
        })
public class CapturePlugin extends Plugin {
    private static CapturePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by the receiver/listener so an open app files new items right away. */
    public static void notifyCaptured() {
        CapturePlugin p = instance;
        if (p != null) p.notifyListeners("captured", new JSObject(), true);
    }

    private boolean smsGranted() {
        return getPermissionState("sms") == PermissionState.GRANTED;
    }

    private boolean notificationsGranted() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    private boolean listenerGranted() {
        Context ctx = getContext();
        return NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.getPackageName());
    }

    private JSObject statusObject() {
        JSObject o = new JSObject();
        o.put("sms", smsGranted());
        o.put("notifications", notificationsGranted());
        o.put("notificationAccess", listenerGranted());
        o.put("pending", CaptureStore.all(getContext()).length());
        o.put("notify", CaptureStore.notifyOnCapture(getContext()));
        JSArray apps = new JSArray();
        for (String a : CaptureStore.allowedApps(getContext())) apps.put(a);
        o.put("apps", apps);
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestSms(PluginCall call) {
        if (smsGranted()) {
            call.resolve(statusObject());
        } else {
            requestPermissionForAlias("sms", call, "afterPermission");
        }
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (notificationsGranted()) {
            call.resolve(statusObject());
        } else {
            requestPermissionForAlias("notifications", call, "afterPermission");
        }
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void openNotificationAccess(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void readInbox(PluginCall call) {
        if (!smsGranted()) {
            call.reject("SMS permission is not granted");
            return;
        }
        long since = (long) call.getDouble("sinceMs", (double) (System.currentTimeMillis() - 30L * 86_400_000L)).doubleValue();
        int limit = call.getInt("limit", 3000);
        JSArray out = new JSArray();
        ContentResolver cr = getContext().getContentResolver();
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        String[] cols = {Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE};
        try (Cursor c = cr.query(uri, cols, Telephony.Sms.DATE + " >= ?", new String[] {String.valueOf(since)}, Telephony.Sms.DATE + " DESC")) {
            if (c != null) {
                while (c.moveToNext() && out.length() < limit) {
                    String sender = c.getString(1);
                    String body = c.getString(2);
                    if (!CaptureFilter.looksLikeBusinessSender(sender) || !CaptureFilter.looksLikeMoney(body)) continue;
                    JSObject m = new JSObject();
                    m.put("id", "inbox-" + c.getLong(0));
                    m.put("source", "sms");
                    m.put("sender", sender);
                    m.put("body", body);
                    m.put("ts", c.getLong(3));
                    out.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read messages: " + e.getMessage());
            return;
        }
        JSObject res = new JSObject();
        res.put("messages", out);
        call.resolve(res);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSONArray q = CaptureStore.all(getContext());
        JSObject res = new JSObject();
        try {
            res.put("items", new JSArray(q.toString()));
        } catch (JSONException e) {
            res.put("items", new JSArray());
        }
        call.resolve(res);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        Set<String> set = new HashSet<>();
        try {
            List<String> list = ids.toList();
            set.addAll(list);
        } catch (JSONException e) {
            call.reject("Bad ids");
            return;
        }
        CaptureStore.remove(getContext(), set);
        call.resolve();
    }

    @PluginMethod
    public void setOptions(PluginCall call) {
        JSArray apps = call.getArray("apps", null);
        if (apps != null) {
            try {
                List<String> list = apps.toList();
                CaptureStore.setAllowedApps(getContext(), new HashSet<>(list));
            } catch (JSONException e) {
                call.reject("Bad apps list");
                return;
            }
        }
        Boolean notify = call.getBoolean("notify", null);
        if (notify != null) CaptureStore.setNotifyOnCapture(getContext(), notify);
        call.resolve(statusObject());
    }

    @PluginMethod
    public void takeRoute(PluginCall call) {
        JSObject res = new JSObject();
        String r = MainActivity.takeLaunchRoute();
        res.put("route", r == null ? "" : r);
        call.resolve(res);
    }
}
