package app.hisaab;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.Telephony;

import android.view.Window;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
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
 *   takeRoute()              → "capture" when the app was opened from a capture notification
 *   requestContacts() / readContacts() → names + phone numbers, to tell friends from shops
 *   openAppSettings()        → Hisaab's App info page (a permission was blocked with "Don't allow")
 *   setBars({dark})          → status/navigation bar colours to match the app's theme
 *   saveFile({name, text})   → "Save to…" picker (Downloads, Drive, a USB stick); for backups
 */
@CapacitorPlugin(
        name = "HisaabCapture",
        permissions = {
            @Permission(strings = {Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS}, alias = "sms"),
            @Permission(strings = {"android.permission.POST_NOTIFICATIONS"}, alias = "notifications"),
            @Permission(strings = {Manifest.permission.READ_CONTACTS}, alias = "contacts")
        })
public class CapturePlugin extends Plugin {
    /**
     * Version of this Android part. The web app shows it in Settings and uses it to notice an APK
     * built without the latest Android files. 3 = contacts, wide filter, detailed notifications.
     * 4 = notification tap opens the payment (route event), import reads the full range.
     */
    public static final int NATIVE_VERSION = 4;

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

    /**
     * A notification was tapped while the app was already open. Android delivers that as a new
     * intent without pausing the app, so no "resume" reaches the web app — tell it directly.
     */
    static void notifyRoute() {
        CapturePlugin p = instance;
        if (p != null) p.notifyListeners("route", new JSObject(), true);
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
        o.put("contacts", getPermissionState("contacts") == PermissionState.GRANTED);
        o.put("pending", CaptureStore.all(getContext()).length());
        o.put("notify", CaptureStore.notifyOnCapture(getContext()));
        JSArray apps = new JSArray();
        for (String a : CaptureStore.allowedApps(getContext())) apps.put(a);
        o.put("apps", apps);
        o.put("nativeVersion", NATIVE_VERSION);
        o.put("filterVersion", CaptureFilter.VERSION);
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

    @PluginMethod
    public void requestContacts(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            call.resolve(statusObject());
        } else {
            requestPermissionForAlias("contacts", call, "afterPermission");
        }
    }

    /** Every contact's display name and phone numbers (digits only). Stays on the phone. */
    @PluginMethod
    public void readContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Contacts permission is not granted");
            return;
        }
        java.util.Map<String, JSArray> byName = new java.util.LinkedHashMap<>();
        Uri uri = android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI;
        String[] cols = {
            android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER
        };
        try (Cursor c = getContext().getContentResolver().query(uri, cols, null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    String name = c.getString(0);
                    String number = c.getString(1);
                    if (name == null || name.trim().isEmpty()) continue;
                    JSArray phones = byName.get(name);
                    if (phones == null) {
                        phones = new JSArray();
                        byName.put(name, phones);
                    }
                    if (number != null) phones.put(number.replaceAll("[^0-9]", ""));
                }
            }
        } catch (Exception e) {
            call.reject("Could not read contacts: " + e.getMessage());
            return;
        }
        JSArray out = new JSArray();
        for (java.util.Map.Entry<String, JSArray> e : byName.entrySet()) {
            JSObject o = new JSObject();
            o.put("name", e.getKey());
            o.put("phones", e.getValue());
            out.put(o);
        }
        JSObject res = new JSObject();
        res.put("contacts", out);
        call.resolve(res);
    }

    /**
     * Save a backup where you choose. A WebView can't download a file on its own (H-20), so the
     * system "Save to" picker writes it: Downloads, Google Drive, a memory card…
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/json"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "hisaab-backup.json"));
        startActivityForResult(call, i, "afterSaveFile");
    }

    @ActivityCallback
    private void afterSaveFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            res.put("saved", false);
            call.resolve(res);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(data.getData())) {
            if (out == null) throw new java.io.IOException("No file to write to");
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            call.reject("Could not save the file", e);
            return;
        }
        res.put("saved", true);
        call.resolve(res);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    @SuppressWarnings("deprecation") // bar colours still apply: the app opts out of edge-to-edge
    public void setBars(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            int color = dark ? 0xFF0E1412 : 0xFFF6F8F7; // tokens.css --bg
            w.setStatusBarColor(color);
            // White navigation buttons only before 8.1: keep that bar dark there.
            w.setNavigationBarColor(Build.VERSION.SDK_INT >= 27 ? color : 0xFF0E1412);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(!dark);
            c.setAppearanceLightNavigationBars(!dark);
        });
        call.resolve();
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
        // optLong, not getDouble: a millisecond timestamp arrives as a Long, which getDouble
        // silently ignores — every import fell back to 30 days ("1 year" included).
        long since = call.getData().optLong("sinceMs", System.currentTimeMillis() - 30L * 86_400_000L);
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
