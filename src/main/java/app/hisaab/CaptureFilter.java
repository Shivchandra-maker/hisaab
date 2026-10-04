package app.hisaab;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Cheap checks that keep personal messages out of the capture queue.
 *
 * Deliberately wide: anything from a business sender that names an amount and uses a banking word
 * is kept, and the app's SMS parser (src/domain/sms/parse.ts) decides what it is. A message
 * dropped here is lost for good, while a non-payment kept here is just set aside by the parser.
 * The simulator copy in Personal\hisaab-testdata\simulator\mocks\runtime.js mirrors this file.
 */
public final class CaptureFilter {
    private CaptureFilter() {}

    /** "Rs.250", "Rs 1,24,500", "INR 99", "₹41", "Rs..50", "USD 12.00" (card spends abroad). */
    private static final Pattern MONEY = Pattern.compile(
            "(?i)(?:\\brs\\.?|\\binr|₹|\\b(?:usd|eur|gbp|aed|sgd|aud|cad|chf|jpy|thb|myr|sar|qar|hkd|cny)\\b)\\s*\\.{0,2}\\s*\\d");

    /** No currency sign: "is credited with 15000.00", "debited by 120.0" (SBI, Kerala Gramin…). */
    private static final Pattern BARE_AMOUNT = Pattern.compile(
            "(?i)\\b(?:debited|credited|spent|paid|sent|withdrawn|deposited|received)\\s+(?:with|by|for|of)?\\s*\\d[\\d,]*(?:\\.\\d{1,2})?\\b");

    /** Word stems that appear in bank, card, UPI, wallet and investment alerts. */
    private static final Pattern MONEY_WORDS = Pattern.compile(
            "(?i)(debit|credit|\\bdr\\b|\\bcr\\b|spent|spend|paid|pay(?:ment)?|receiv|withdr|deposit|refund"
                    + "|revers|sent|transfer|\\btrf|txn|transaction|purchase|mandate|autopay|auto-pay|\\bemi\\b"
                    + "|cashback|added|loaded|top.?up|recharge|\\bdue\\b|statement|\\bbal|avl|available|\\bsip\\b"
                    + "|allot|units|invest|\\bnav\\b|neft|imps|rtgs|\\bupi\\b|\\batm\\b|\\bpos\\b|charge|deduct"
                    + "|settle|\\bnach\\b|\\becs\\b|a/c|acct|account|card|wallet)");

    /** Not a payment that happened: no "New payment" notification for these (still captured). */
    private static final Pattern NOT_A_PAYMENT = Pattern.compile(
            "(?i)(\\botp\\b|one[- ]time password|verification code|declined|failed|unsuccessful"
                    + "|will be (?:auto-?)?(?:debited|deducted|charged|credited|processed)|could not be processed|is due|due on|due date|min(?:imum)?\\.? (?:amt\\.? |amount )?due"
                    + "|payment request|collect request|requested|pre-?approved|apply now|\\boffer\\b|suspended|\\bkyc\\b|is blocked|revoked|created a mandate|e-?voucher"
                    + "|account balance is|has avl bal of|available balance for"
                    + "|statement (?:for|is|has been) generated)");

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
        return (MONEY.matcher(body).find() && MONEY_WORDS.matcher(body).find())
                || BARE_AMOUNT.matcher(body).find();
    }

    /** Worth a "New payment" notification: money moved (not an OTP, reminder, offer or request). */
    public static boolean looksLikePayment(String body) {
        return looksLikeMoney(body) && !NOT_A_PAYMENT.matcher(body).find();
    }

    /** "₹250" from the text, for the "new payment" notification. Empty if none. */
    public static String amountLabel(String body) {
        Matcher m = Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*\\.?\\s*([\\d,]+(?:\\.\\d{1,2})?)")
                .matcher(body == null ? "" : body);
        if (!m.find()) return "";
        return "₹" + m.group(1);
    }
}
