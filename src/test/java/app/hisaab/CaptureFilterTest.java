package app.hisaab;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** H-01: real alerts the old word list dropped. Run with ./gradlew test. */
public class CaptureFilterTest {
    private static final String[] KEEP = {
        "Sent Rs.40000.00 From HDFC Bank A/C *4521 To Self Kotak Bank XX3344 On 01/10/25 Ref 426700028100",
        "Sent Rs.292.00 from Kotak Bank AC X3344 to q817263542@ybl on 09-06-26.UPI Ref 426721777329.",
        "Your txn of ₹1,250.00 on Scapia card ending 1122 at SWIGGY is successful",
        "Transaction Reversed!On HDFC Bank CREDIT Card xx8834 Amt: Rs.2003.00 By AMAZON On 2025-11-07:14:12:00",
        "SIP purchase of Rs.5,000 in Parag Parikh Flexi Cap allotted 61.2 units at NAV 81.70",
        "Dear Customer Your A/c no XXXX0024 is credited with 15000.00 on 06-06-2026 by Loan Recovery",
        "Your HDFC Bank Credit Card 8834 statement for Apr-26 has been generated. Total due Rs.16688.00",
        "USD 12.00 spent on ICICI Bank Card XX1234 at OPENAI on 03-Oct-26",
    };

    @Test
    public void keepsRealAlerts() {
        for (String s : KEEP) assertTrue(s, CaptureFilter.looksLikeMoney(s));
    }

    @Test
    public void quietForNonPayments() {
        assertFalse(CaptureFilter.looksLikePayment("Your OTP for transaction of Rs.6,528.00 at AMAZON is 517406."));
        assertFalse(CaptureFilter.looksLikePayment(
                "Payment of Rs 2,071.00 on HDFC Bank Credit Card xx8834 is due on 19-10-25. Min due: Rs 500."));
        assertFalse(CaptureFilter.looksLikePayment(
                "Your SBI account is suspended. Rs.4999 will be debited. Click http://sbi-reward.in to stop"));
        assertTrue(CaptureFilter.looksLikePayment(KEEP[0]));
    }

    @Test
    public void personalSendersSkipped() {
        assertFalse(CaptureFilter.looksLikeBusinessSender("+919845012345"));
        assertTrue(CaptureFilter.looksLikeBusinessSender("VM-HDFCBK-S"));
    }

    @Test
    public void mathsLetterTextIsKept() {
        // SBI Card: "spent on your SBI Credit Card" in sans-serif maths letters.
        assertTrue(CaptureFilter.looksLikeMoney(
                "Rs.120.00 \uD835\uDDCC\uD835\uDDC9\uD835\uDDBE\uD835\uDDC7\uD835\uDDCD on your card ending 4411 at CAFE on 03/10/26"));
    }
}
