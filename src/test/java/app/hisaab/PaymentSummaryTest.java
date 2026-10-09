package app.hisaab;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** The "new payment" notification says what happened, not just "New payment". */
public class PaymentSummaryTest {
    private static void check(String sender, String body, String title, String text) {
        PaymentSummary.Summary s = PaymentSummary.describe(sender, body);
        assertEquals(body, title, s.title);
        assertEquals(body, text, s.text);
    }

    @Test
    public void upiSent() {
        check("JD-KOTAKB-S",
                "Sent Rs.292.00 from Kotak Bank AC X3344 to swiggy.stores@icici on 09-06-26.UPI Ref 426721777329. Not you, https://kotak.com/KBANKT/Fraud",
                "₹292 to Swiggy Stores", "Kotak ••3344");
        check("VM-HDFCBK-S",
                "Sent Rs.28000.00 From HDFC Bank A/C *4521 To RAJESH KUMAR On 05/10/25 Ref 426700557987",
                "₹28,000 to Rajesh Kumar", "HDFC Bank ••4521");
    }

    @Test
    public void cardSpendSkipsTheLimit() {
        check("AX-AXISBK-S",
                "Spent INR 675 Axis Bank Card no. XX7441 03-01-26 11:55:55 IST AMAZON Avl Limit: INR 144422.00",
                "₹675 paid", "Axis Bank ••7441");
        check("AD-HDFCCC-S",
                "Spent Rs.3298.00 On HDFC Bank Card 8834 At AMAZON On 2025-10-13:22:29:42 Not You?",
                "₹3,298 to Amazon", "HDFC Bank ••8834");
    }

    @Test
    public void moneyIn() {
        check("VM-HDFCBK-S",
                "Update! INR 1,15,000.00 deposited in HDFC Bank A/c XX4521 on 01-OCT-25 for NEFT Cr-ACME. Avl bal INR 2,00,000.00.",
                "₹1,15,000 received", "HDFC Bank ••4521");
        check("JD-KOTAKB-S",
                "Received Rs.1000.00 in your Kotak Bank AC X3344 from priya.sharma@oksbi on 27-11-25.UPI Ref 426704737619.",
                "₹1,000 received from Priya Sharma", "Kotak ••3344");
        check("AD-HDFCCC-S",
                "Transaction Reversed!On HDFC Bank CREDIT Card xx8834 Amt: Rs.2003.00 By AMAZON On 2025-11-07:14:12:00",
                "₹2,003 refund from Amazon", "HDFC Bank ••8834");
    }

    @Test
    public void indianGrouping() {
        assertEquals("1,15,000.50", PaymentSummary.indian("115000.5"));
        assertEquals("999", PaymentSummary.indian("999.00"));
        assertEquals("12,34,567", PaymentSummary.indian("1234567"));
    }

    @Test
    public void atmAndNoAmount() {
        check("VM-HDFCBK-S",
                "Rs.5000.00 withdrawn from HDFC Bank A/c XX4521 on 12-Apr-26 at ATM HDFC BANK KORAMANGALA. Avl bal: Rs.201847.00",
                "₹5,000 cash withdrawn", "HDFC Bank ••4521");
        assertNull(PaymentSummary.describe("VM-HDFCBK-S", "Your account statement is ready."));
    }
}
