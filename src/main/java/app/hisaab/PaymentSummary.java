package app.hisaab;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A one-line summary of a bank SMS for the "new payment" notification, read on the phone the
 * moment the message arrives: "₹250 paid to Swiggy" + "HDFC Bank ••4521".
 *
 * Deliberately light — the app's full parser (src/domain/sms/parse.ts) decides what the message
 * really is when the app opens. This only has to be right enough to be useful at a glance.
 */
public final class PaymentSummary {
    private PaymentSummary() {}

    public final static class Summary {
        public final String title;
        public final String text;

        Summary(String title, String text) {
            this.title = title;
            this.text = text;
        }
    }

    private static final Pattern AMOUNT = Pattern.compile(
            "(?i)(?:rs\\.?|inr|₹)\\s*\\.?\\s*([\\d,]+(?:\\.\\d{1,2})?)");
    private static final Pattern NOT_AMOUNT_BEFORE = Pattern.compile(
            "(?i)(bal(ance)?|limit|lmt|avl|available|outstanding|total due|min(imum)? (amt|amount)? ?due)[\\s.:]*(is)?\\s*$");
    private static final Pattern CREDIT = Pattern.compile(
            "(?i)\\b(credited|received|deposited|refund(ed)?|reversed|reversal|cashback|credit (?:with|for|by|of)|cr\\.?\\s)");
    private static final Pattern DEBIT = Pattern.compile(
            "(?i)\\b(debited|spent|sent|paid|withdrawn|purchase|deducted|charged|txn of|transaction of|debit (?:with|for|by|of)|a debit|dr\\.?\\s)");
    private static final Pattern ATM = Pattern.compile("(?i)\\b(atm|cash withdrawal)\\b");
    private static final Pattern REFUND = Pattern.compile("(?i)\\b(refund(ed)?|reversed|reversal)\\b");
    private static final Pattern CARD = Pattern.compile(
            "(?i)(credit|debit)?\\s*card(?:\\s*(?:no\\.?|number|ending(?:\\s*(?:with|in))?|xx+|x+|\\*+|:))*\\s*[x*]*\\s*(\\d{4})\\b");
    private static final Pattern ACCOUNT = Pattern.compile(
            "(?i)\\b(?:a/?c|acct|account|ac)(?:\\s*(?:no\\.?|number|ending|:))*\\s*[x*.]*\\s*(\\d{3,6})\\b");
    private static final Pattern MASKED = Pattern.compile("(?i)\\b[x*]{2,}(\\d{4})\\b");
    private static final Pattern VPA = Pattern.compile("(?i)\\b([a-z0-9._-]{2,})@[a-z][a-z0-9]{1,}\\b");
    private static final String STOP =
            "(?=\\s+(?:on|at|via|ref|refno|upi|using|avl|bal|for|from|dated|txn|credited|debited|has|is|was|not)\\b|\\.(?:\\s|$)|[,;\\n(]|\\s+\\d{1,2}[-/]|$)";
    private static final Pattern TO = Pattern.compile(
            "(?i)\\b(?:to|at|towards|for)\\s+(?:vpa\\s+)?(?!your\\b|a/?c\\b|ac\\b|account\\b|self\\b)([a-z][\\w .&'@-]{1,40}?)" + STOP);
    private static final Pattern FROM = Pattern.compile(
            "(?i)\\b(?:from|by)\\s+(?!your\\b|a/?c\\b|ac\\b|account\\b|an\\b)([a-z][\\w .&'@-]{1,40}?)" + STOP);

    /** Sender IDs like "VM-HDFCBK-S" → "HDFC Bank". */
    private static final String[][] BANKS = {
        {"HDFC", "HDFC Bank"}, {"ICICI", "ICICI Bank"}, {"SBI", "SBI"}, {"AXIS", "Axis Bank"},
        {"KOTAK", "Kotak"}, {"IDFC", "IDFC First"}, {"YESB", "Yes Bank"}, {"INDUS", "IndusInd"},
        {"PNB", "PNB"}, {"BOB", "Bank of Baroda"}, {"CANBNK", "Canara Bank"}, {"UNION", "Union Bank"},
        {"FEDBNK", "Federal Bank"}, {"AUBANK", "AU Bank"}, {"RBL", "RBL Bank"}, {"SCBANK", "Standard Chartered"},
        {"AMEX", "Amex"}, {"ONECRD", "OneCard"}, {"PHONPE", "PhonePe"}, {"PAYTM", "Paytm"},
        {"GPAY", "Google Pay"}, {"SLICE", "slice"}, {"SCAPIA", "Scapia"}, {"JUPITER", "Jupiter"},
    };

    public static String bankFor(String sender) {
        if (sender == null) return null;
        String s = sender.toUpperCase(Locale.ROOT);
        for (String[] b : BANKS) if (s.contains(b[0])) return b[1];
        return null;
    }

    static String amount(String body) {
        Matcher m = AMOUNT.matcher(body);
        while (m.find()) {
            String before = body.substring(Math.max(0, m.start() - 28), m.start());
            if (NOT_AMOUNT_BEFORE.matcher(before).find()) continue;
            String digits = m.group(1);
            if (digits.replace(",", "").replace(".", "").replace("0", "").isEmpty()) continue;
            return "₹" + indian(digits);
        }
        return null;
    }

    /** "28000.00" → "28,000"; "115000.5" → "1,15,000.50" (Indian grouping). */
    static String indian(String raw) {
        String d = raw.replace(",", "");
        String rupees = d.contains(".") ? d.substring(0, d.indexOf('.')) : d;
        String paise = d.contains(".") ? d.substring(d.indexOf('.') + 1) : "";
        rupees = rupees.replaceFirst("^0+(?=\\d)", "");
        StringBuilder out = new StringBuilder();
        int n = rupees.length();
        if (n <= 3) out.append(rupees);
        else {
            String head = rupees.substring(0, n - 3);
            StringBuilder h = new StringBuilder();
            for (int i = 0; i < head.length(); i++) {
                if (i > 0 && (head.length() - i) % 2 == 0) h.append(',');
                h.append(head.charAt(i));
            }
            out.append(h).append(',').append(rupees.substring(n - 3));
        }
        if (!paise.isEmpty() && !paise.matches("0+")) out.append('.').append(paise.length() == 1 ? paise + "0" : paise);
        return out.toString();
    }

    /** Words that follow "to/at/for/by" in alerts but aren't who you paid. */
    private static final Pattern NOT_A_NAME = Pattern.compile(
            "(?i)^(rs|inr|₹|usd|applicable|imps|neft|rtgs|upi|nach|ach|dispute|call|transfer|cash|self|beneficiary|merchant|the|monthly|interest|card|bank)\\b.*|.*\\d{3,}.*");

    private static String nice(String raw) {
        String s = raw.trim();
        if (NOT_A_NAME.matcher(s).matches()) return null;
        if (s.contains("@")) s = s.substring(0, s.indexOf('@'));
        s = s.replaceAll("[._-]+", " ").replaceAll("\\d{6,}", "").replaceAll("\\s+", " ").trim();
        if (s.length() < 2) return null;
        if (s.equals(s.toUpperCase(Locale.ROOT)) || s.equals(s.toLowerCase(Locale.ROOT))) {
            StringBuilder b = new StringBuilder();
            for (String w : s.toLowerCase(Locale.ROOT).split(" ")) {
                if (w.isEmpty()) continue;
                if (b.length() > 0) b.append(' ');
                b.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
            }
            s = b.toString();
        }
        return s.length() > 28 ? s.substring(0, 27) + "…" : s;
    }

    static String counterparty(String body, boolean credit) {
        Matcher m = (credit ? FROM : TO).matcher(body);
        if (m.find()) return nice(m.group(1));
        Matcher v = VPA.matcher(body);
        if (v.find()) return nice(v.group(1));
        return null;
    }

    static String last4(String body) {
        Matcher c = CARD.matcher(body);
        if (c.find()) return c.group(2);
        Matcher a = ACCOUNT.matcher(body);
        if (a.find()) {
            String d = a.group(1);
            return d.substring(Math.max(0, d.length() - 4));
        }
        Matcher x = MASKED.matcher(body);
        return x.find() ? x.group(1) : null;
    }

    /** Title + line for the notification, or null when the message doesn't read like a payment. */
    public static Summary describe(String sender, String body) {
        if (body == null) return null;
        String flat = CaptureFilter.plain(body).replaceAll("\\s+", " ");
        String amount = amount(flat);
        if (amount == null) return null;
        Matcher cr = CREDIT.matcher(flat);
        Matcher dr = DEBIT.matcher(flat);
        int ci = cr.find() ? cr.start() : -1;
        int di = dr.find() ? dr.start() : -1;
        boolean credit = REFUND.matcher(flat).find() || (ci >= 0 && (di < 0 || ci < di));
        String who = ATM.matcher(flat).find() && !credit ? null : counterparty(flat, credit);

        String title;
        if (REFUND.matcher(flat).find()) title = amount + " refund" + (who != null ? " from " + who : "");
        else if (credit) title = amount + " received" + (who != null ? " from " + who : "");
        else if (ATM.matcher(flat).find()) title = amount + " cash withdrawn";
        else title = amount + (who != null ? " to " + who : " paid");

        String bank = bankFor(sender);
        String l4 = last4(flat);
        StringBuilder text = new StringBuilder();
        if (bank != null) text.append(bank);
        if (l4 != null) text.append(text.length() > 0 ? " " : "").append("••").append(l4);
        if (text.length() == 0) text.append("Tap to see it in Hisaab");
        return new Summary(title, text.toString());
    }
}
