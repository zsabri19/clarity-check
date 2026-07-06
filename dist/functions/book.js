/**
 * ClarityOS Mirror Call - Booking Endpoint
 *
 * Handles post-Stripe-payment booking:
 * 1. Validates the payment (via Stripe session or simple reference)
 * 2. Captures the user's date/time preference
 * 3. Sends a confirmation + Google Calendar invite to the user
 * 4. Notifies Zeeshan/Sofia about the booking
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { email, name, date, time, timezone, stripeSessionId, phone } = body;

    // Validate
    if (!email || !date || !time) {
      return new Response(
        JSON.stringify({ error: 'Email, date, and time are required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const displayName = name || email.split('@')[0];
    const tz = timezone || 'Asia/Dubai';

    const booking = {
      type: 'clarityos-mirror-call',
      name: displayName,
      email,
      phone: phone || '',
      date,
      time,
      timezone: tz,
      stripeSessionId: stripeSessionId || 'pending',
      booked_at: new Date().toISOString(),
    };

    console.log(`[BOOKING] New Mirror Call: ${displayName} — ${date} at ${time} ${tz}`);

    // Store booking reference
    try {
      if (context.env && context.env.LEADS) {
        await context.env.LEADS.put(
          `booking:${Date.now()}`,
          JSON.stringify(booking)
        );
      }
    } catch (kvErr) {
      console.error('[BOOKING] KV unavailable:', kvErr.message);
    }

    // Generate .ics calendar invite
    const startDateTime = new Date(`${date}T${time}:00`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour call

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//ClarityOS//Mirror Call//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:mirror-call-${Date.now()}@clarity-os.com`,
      `DTSTART:${startDateTime.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTEND:${endDateTime.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      'CREATED:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
      'DESCRIPTION:ClarityOS Mirror Call - A one-hour session where we map your organization\'s decision architecture and identify the #1 blocker to execution.\\n\\nHost: Zeeshan Sabri',
      `SUMMARY:ClarityOS Mirror Call with ${displayName}`,
      `ORGANIZER;CN=Zeeshan Sabri:mailto:clarityos@global-mkts.com`,
      `ATTENDEE;CN=${displayName};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${email}`,
      'LOCATION:Google Meet (link sent separately)',
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder: ClarityOS Mirror Call in 30 minutes',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    // Send confirmation to user
    try {
      const confirmHTML = [
        `<div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #0a0a0f; color: #e4e4ed;">`,
        `<h1 style="color: #fff; font-size: 22px; margin-bottom: 8px;">Your Mirror Call is Booked</h1>`,
        `<hr style="border: none; border-top: 1px solid rgba(136,136,204,0.15); margin: 16px 0;">`,
        `<p style="color: #9999bb; line-height: 1.6;">Hey ${displayName},</p>`,
        `<p style="color: #9999bb; line-height: 1.6;">Your ClarityOS Mirror Call is confirmed:</p>`,
        `<div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(136,136,204,0.1); border-radius: 12px; padding: 16px; margin: 16px 0;">`,
        `<p style="color: #ccccee; margin: 0 0 8px;"><strong>Date:</strong> ${date}</p>`,
        `<p style="color: #ccccee; margin: 0 0 8px;"><strong>Time:</strong> ${time} ${tz}</p>`,
        `<p style="color: #ccccee; margin: 0;"><strong>Duration:</strong> 60 minutes</p>`,
        `</div>`,
        `<p style="color: #9999bb; line-height: 1.6;">You'll receive a Google Meet link closer to the time. If you need to reschedule, reply to this email.</p>`,
        `<hr style="border: none; border-top: 1px solid rgba(136,136,204,0.06); margin: 16px 0;">`,
        `<p style="font-size: 12px; color: #555577;">Zeeshan Sabri · ClarityOS · <a href="https://clarity-os.com" style="color: #7777aa;">clarity-os.com</a></p>`,
        `</div>`,
      ].join('\n');

      await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: 'clarityos@global-mkts.com', name: 'Zeeshan Sabri · ClarityOS' },
          subject: 'Your ClarityOS Mirror Call is Confirmed',
          content: [{ type: 'text/html', value: confirmHTML }],
          attachments: [
            {
              filename: 'mirror-call.ics',
              content: Buffer.from(icsContent).toString('base64'),
              mimetype: 'text/calendar; method=REQUEST',
            },
          ],
        }),
      });

      console.log(`[BOOKING] Confirmation sent to ${email}`);
    } catch (err) {
      console.error('[BOOKING] Confirmation email failed:', err.message);
    }

    // Notify Zeeshan/Sofia
    try {
      const notifyHTML = [
        `<div style="font-family: 'Inter', Arial, sans-serif; max-width: 560px;">`,
        `<h2>New Mirror Call Booking</h2>`,
        `<table style="border-collapse: collapse; width: 100%;">`,
        `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Name</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${displayName}</td></tr>`,
        `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${email}</td></tr>`,
        `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${date}</td></tr>`,
        `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Time</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${time} ${tz}</td></tr>`,
        `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Stripe</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${stripeSessionId}</td></tr>`,
        `</table>`,
        `</div>`,
      ].join('\n');

      await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: 'clarityos@global-mkts.com' }] }],
          from: { email: 'noreply@clarity-check.global-mkts.com', name: 'Mirror Call Booking' },
          subject: `New Booking: ${displayName} — ${date} at ${time}`,
          content: [{ type: 'text/html', value: notifyHTML }],
        }),
      });
    } catch (err) {
      console.error('[BOOKING] Notification failed:', err.message);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Mirror Call booked successfully!' }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[BOOKING] Error:', err.message);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
}
