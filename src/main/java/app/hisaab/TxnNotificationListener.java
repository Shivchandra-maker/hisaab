package app.hisaab;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Reads payment notifications from the apps you choose (PhonePe, Google Pay, Paytm by default),
 * for payments that don't come with a bank SMS — like PhonePe wallet payments.
 * Only runs after you allow "Notification access" for Hisaab in Android settings.
 */
public class TxnNotificationListener extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName();
        if (pkg == null || !CaptureStore.allowedApps(this).contains(pkg)) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle extras = n.extras;
        if (extras == null) return;

        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence text = big != null ? big : extras.getCharSequence(Notification.EXTRA_TEXT);
        String body = ((title == null ? "" : title + ". ") + (text == null ? "" : text)).trim();
        if (!CaptureFilter.looksLikeMoney(body)) return;

        if (CaptureStore.add(this, "notification", pkg, body, sbn.getPostTime())) {
            CapturePlugin.notifyCaptured();
        }
    }
}
