package app.hisaab;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Receives every incoming SMS (the system wakes this even when Hisaab is closed), keeps only
 * money messages from business senders, and queues them for the Inbox.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null) return;

        // Long messages arrive in several parts; join them per sender.
        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        Map<String, Long> times = new LinkedHashMap<>();
        for (SmsMessage part : parts) {
            if (part == null) continue;
            String sender = part.getDisplayOriginatingAddress();
            if (sender == null) sender = "";
            StringBuilder sb = bodies.get(sender);
            if (sb == null) {
                sb = new StringBuilder();
                bodies.put(sender, sb);
                times.put(sender, part.getTimestampMillis());
            }
            sb.append(part.getMessageBody());
        }

        boolean any = false;
        for (Map.Entry<String, StringBuilder> e : bodies.entrySet()) {
            String sender = e.getKey();
            String body = e.getValue().toString();
            if (!CaptureFilter.looksLikeBusinessSender(sender) || !CaptureFilter.looksLikeMoney(body)) continue;
            Long ts = times.get(sender);
            if (CaptureStore.add(context, "sms", sender, body, ts == null ? System.currentTimeMillis() : ts)) {
                any = true;
                // OTPs, reminders and offers are kept for the parser but don't ping you.
                if (CaptureFilter.looksLikePayment(body)) CaptureNotifier.show(context, sender, body);
            }
        }
        if (any) CapturePlugin.notifyCaptured();
    }
}
