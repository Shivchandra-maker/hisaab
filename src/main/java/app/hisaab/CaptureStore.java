package app.hisaab;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * A small on-device queue of captured bank messages and payment notifications.
 * The SMS receiver and notification listener write here even when the app is closed;
 * the web app reads the queue when it opens, files the items into its Inbox, then acks them.
 * Nothing in here ever leaves the phone.
 */
public final class CaptureStore {
    private static final String PREFS = "hisaab_capture";
    private static final String KEY_QUEUE = "queue";
    private static final int MAX_ITEMS = 1000;

    private CaptureStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized JSONArray all(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_QUEUE, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Adds an item unless the same text from the same source arrived in the last two minutes. */
    public static synchronized boolean add(Context ctx, String source, String sender, String body, long ts) {
        JSONArray queue = all(ctx);
        try {
            for (int i = queue.length() - 1; i >= 0 && i >= queue.length() - 30; i--) {
                JSONObject o = queue.getJSONObject(i);
                if (o.optString("body").equals(body)
                        && o.optString("source").equals(source)
                        && Math.abs(o.optLong("ts") - ts) < 120_000) {
                    return false;
                }
            }
            JSONObject item = new JSONObject();
            item.put("id", UUID.randomUUID().toString());
            item.put("source", source);
            item.put("sender", sender == null ? "" : sender);
            item.put("body", body);
            item.put("ts", ts);
            queue.put(item);
            while (queue.length() > MAX_ITEMS) queue.remove(0);
            prefs(ctx).edit().putString(KEY_QUEUE, queue.toString()).apply();
            return true;
        } catch (JSONException e) {
            return false;
        }
    }

    public static synchronized void remove(Context ctx, Set<String> ids) {
        JSONArray queue = all(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject o = queue.optJSONObject(i);
            if (o != null && !ids.contains(o.optString("id"))) kept.put(o);
        }
        prefs(ctx).edit().putString(KEY_QUEUE, kept.toString()).apply();
    }

    /* ── Options set from the app's Settings screen ── */

    private static final String KEY_APPS = "notification_apps";
    private static final String KEY_NOTIFY = "notify_on_capture";

    /** Apps whose notifications are read. PhonePe, Google Pay and Paytm by default. */
    public static Set<String> allowedApps(Context ctx) {
        Set<String> defaults = new HashSet<>();
        defaults.add("com.phonepe.app");
        defaults.add("com.google.android.apps.nbu.paisa.user");
        defaults.add("net.one97.paytm");
        return new HashSet<>(prefs(ctx).getStringSet(KEY_APPS, defaults));
    }

    public static void setAllowedApps(Context ctx, Set<String> apps) {
        prefs(ctx).edit().putStringSet(KEY_APPS, apps).apply();
    }

    public static boolean notifyOnCapture(Context ctx) {
        return prefs(ctx).getBoolean(KEY_NOTIFY, true);
    }

    public static void setNotifyOnCapture(Context ctx, boolean on) {
        prefs(ctx).edit().putBoolean(KEY_NOTIFY, on).apply();
    }
}
