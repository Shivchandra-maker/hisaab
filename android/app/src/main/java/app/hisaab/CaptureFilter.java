package app.hisaab;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Cheap checks that keep personal messages out of the capture queue. */
public final class CaptureFilter {
    private CaptureFilter() {}

    private static final Pattern MONEY =
            Pattern.compile("(?i)(rs\\.?|inr|₹)\\s*[\\d,]+(\\.\\d{1,2})?");
    private static final Pattern MONEY_WORDS =
            Pattern.compile("(?i)\\b(debited|credited|spent|paid|received|withdrawn|deposited|refund|mandate|autopay|emi)\\b");

    /**
     * Banks, cards and payment apps send from alphanumeric sender IDs like "VM-HDFCBK" or
     * "JD-PHONPE-S". Messages from people come from phone numbers, so they're never captured.
     */
    public static boolean looksLikeBusinessSender(String sender) {
        if (sender == null) return false;
        return sender.matches(".*[A-Za-z].*");
    }

    public static boolean looksLikeMoney(String body) {
        if (body == null) return false;
        return MONEY.matcher(body).find() && MONEY_WORDS.matcher(body).find();
    }

    /** "₹250" from the text, for the "new payment" notification. Empty if none. */
    public static String amountLabel(String body) {
        Matcher m = MONEY.matcher(body == null ? "" : body);
        if (!m.find()) return "";
        String digits = m.group().replaceAll("(?i)(rs\\.?|inr|₹)\\s*", "");
        return "₹" + digits;
    }
}
