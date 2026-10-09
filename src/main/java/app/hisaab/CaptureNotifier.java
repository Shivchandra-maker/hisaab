package app.hisaab;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** "₹250 to Swiggy · HDFC Bank ••4521" the moment a bank SMS is captured. */
public final class CaptureNotifier {
    private static final String CHANNEL = "captures";
    private static final int ID = 7001;

    private CaptureNotifier() {}

    public static void show(Context ctx, String sender, String body) {
        if (!CaptureStore.notifyOnCapture(ctx)) return;
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL, "New payment messages", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("A bank message was captured and is waiting in your Inbox");
                nm.createNotificationChannel(ch);
            }
        }
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // The web app files the new message, then opens it — or the Inbox if it needs a look.
        open.putExtra("route", "capture");
        PendingIntent pi = PendingIntent.getActivity(
                ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PaymentSummary.Summary sum = PaymentSummary.describe(sender, body);
        String amount = CaptureFilter.amountLabel(body);
        String title = sum != null ? sum.title : amount.isEmpty() ? "New payment" : "New payment · " + amount;
        String text = sum != null ? sum.text : "Tap to see it in Hisaab";
        int waiting = CaptureStore.all(ctx).length();
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_hisaab)
                .setContentTitle(title)
                .setContentText(text)
                .setSubText(waiting > 1 ? waiting + " new" : null)
                .setShowWhen(true)
                .setContentIntent(pi)
                .setAutoCancel(true)
                // Every new payment alerts (a second debit could be fraud), not only the first.
                .setOnlyAlertOnce(false)
                // Lock screen shows "New payment" only; payee and card digits after unlock.
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(new NotificationCompat.Builder(ctx, CHANNEL)
                        .setSmallIcon(R.drawable.ic_stat_hisaab)
                        .setContentTitle("New payment")
                        .setContentText("Unlock to see it in Hisaab")
                        .build())
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(ctx).notify(ID, b.build());
        } catch (SecurityException ignored) {
            // Permission revoked between the check and the call.
        }
    }
}
