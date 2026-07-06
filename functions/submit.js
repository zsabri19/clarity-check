/**
 * ClarityOS Lead Capture Endpoint
 *
 * Captures email from the scorecard gate form and:
 * 1. Stores the lead for Sofia (sales agent follow-up)
 * 2. Sends a notification email to clarityos@global-mkts.com
 * 3. Returns a success response
 */

// Sofia's notification email (where leads go)
const SOFIA_EMAIL = 'clarityos@global-mkts.com';

// CORS headers for the form submission
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const { email, name, title, source, score, scoreBand, dominantLeak, summary, answers } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Valid email is required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Log the lead
    console.log(`[LEAD] New lead captured: ${email}${name ? ` (${name})` : ''} from ${source || 'scorecard'} at ${new Date().toISOString()}`);

    const leadData = {
      source: source || 'clarity-check-scorecard',
      type: 'lead-magnet',
      email: email,
      name: name || email.split('@')[0],
      title: title || null,
      captured_at: new Date().toISOString(),
      page: 'Clarity Leak Scorecard',
      score: score ?? null,
      score_band: scoreBand || null,
      dominant_leak: dominantLeak || null,
      summary: summary || null,
      answers: Array.isArray(answers) ? answers : [],
    };

    // Store in Cloudflare KV if bound
    try {
      if (context.env && context.env.LEADS) {
        await context.env.LEADS.put(
          `lead:${Date.now()}`,
          JSON.stringify(leadData)
        );
      }
    } catch (kvErr) {
      console.error('[LEAD] KV store unavailable, logging only:', kvErr.message);
    }

    // Send notification email to Sofia via MailChannels
    try {
      const emailPayload = {
        personalizations: [{ to: [{ email: SOFIA_EMAIL }] }],
        from: { email: 'noreply@clarity-check.global-mkts.com', name: 'ClarityOS Lead Capture' },
        subject: `New Lead: ${leadData.name} completed the Clarity Leak Scorecard`,
        content: [
          {
            type: 'text/plain',
            value: [
              `New Lead Captured`,
              `==================`,
              ``,
              `Name:   ${leadData.name}`,
              `Title:  ${leadData.title || 'n/a'}`,
              `Email:  ${leadData.email}`,
              `Date:   ${leadData.captured_at}`,
              `Source: ${leadData.source}`,
              `Page:   ${leadData.page}`,
              `Score:  ${leadData.score ?? 'n/a'}${leadData.score_band ? ` (${leadData.score_band})` : ''}`,
              `Leak:   ${leadData.dominant_leak || 'n/a'}`,
              `Note:   ${leadData.summary || 'n/a'}`,
              `Answers:${leadData.answers.length ? '' : ' n/a'}`,
              ...leadData.answers.map((entry) => `  - ${entry.question}: ${entry.answer}`),
              ``,
              `Action: Follow up with a personalized ClarityOS introduction and score-based diagnosis.`,
              ``,
              `---`,
              `ClarityOS Lead Capture`,
              `https://clarity-check.global-mkts.com`,
            ].join('\n'),
          },
        ],
      };

      const emailResponse = await fetch('https://api.mailchannels.net/tx/v1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emailPayload),
      });

      console.log(`[LEAD] Email notification sent: ${emailResponse.status}`);
    } catch (emailErr) {
      console.error('[LEAD] Email notification failed:', emailErr.message);
    }

    // Return success
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Thanks! Your scorecard is ready.',
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );

  } catch (err) {
    console.error('[LEAD] Error processing submission:', err.message);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
}
