import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// No JWT verification needed for this function
export const config = { auth: false }

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { webhook_url, message, channel } = await req.json()

    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message
            }
          }
        ],
        ...(channel ? { channel } : {})
      })
    })

    const text = await response.text()
    return new Response(JSON.stringify({ ok: response.ok, response: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
