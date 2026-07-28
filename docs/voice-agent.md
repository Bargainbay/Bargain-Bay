# Phone sales agent — (647) 943-7714

Inbound AI sales agent for Bargain Bay. The number **stays on RingCentral** (no
port, no downtime); RingCentral forwards to the agent, and the agent transfers
back to a human during staffed hours.

```
Caller → RingCentral (647) 943-7714
       → [forward] → Twilio number → ElevenLabs Agent ("Bay")
            ├─ tools → https://bargainbay.ca/api/voice/tools   (inventory, hours, leads)
            └─ "talk to someone" → transfer → Roushi   (10am–8pm, 7 days)
                                 → outside hours: take a message → owner email
```

## Why forward instead of port
Porting (647) 943-7714 to Twilio would take days, risks downtime on a live sales
line, and gives up RingCentral's other features. Forwarding is reversible in one
click: if the agent ever misbehaves, turn forwarding off and the number rings the
way it does today.

## The tool endpoint
`POST /api/voice/tools` — one URL, `action` selects the tool. Auth header
`x-voice-secret: $VOICE_AGENT_SECRET`.

| action | what it does |
|---|---|
| `search_inventory` | Live stock by query / category / max price. Returns ≤5 speech-ready lines + a count. |
| `check_unit` | Is this specific SKU still available? (qty-1 units go fast) |
| `store_info` | Address, hours, pickup/delivery, warranty, whether staff are in right now |
| `pickup_slots` | Next bookable 30-min pickup windows |
| `capture_lead` | Saves name/phone/email/interest to the customer DB + quote request, emails the owner |
| `request_human` | **Server decides** whether transfer is allowed (10:00–20:00 Toronto). The agent cannot promise a human after hours. |
| `take_message` | After-hours or unresolved — emails the owner |

Business rules live in the endpoint, not the prompt, so a prompt-injection or a
model slip can't invent hours or transfer at 2am.

## Agent prompt (paste into ElevenLabs → Agent → System prompt)

> You are "Bay", the phone sales associate for Bargain Bay — liquidation
> appliances in Pickering, Ontario. You answer the main line.
>
> HOW YOU SOUND
> - Warm, efficient, human. Short turns (1–3 sentences), because this is a phone
>   call, not an essay. Let the caller talk.
> - Never invent stock, prices, hours, or policies. If you don't know, say so and
>   offer to take details.
>
> WHAT YOU DO
> 1. Greet: "Bargain Bay, this is Bay — how can I help?"
> 2. Understand what appliance they need: type, budget, size constraints, gas vs
>    electric, finish. ONE question at a time.
> 3. Use `search_inventory` for what's actually in stock. Every unit is
>    one-of-a-kind — if they ask about a specific one, use `check_unit`.
> 4. Quote the price you're given, plus: tested & working, one-year warranty.
>    Use `store_info` for address, hours, delivery ($79 local) and pickup.
> 5. Before the call ends, ALWAYS `capture_lead` with their name and a phone
>    number or email. That is the goal of every call.
> 6. If they want a person, call `request_human`. If it returns transfer=true,
>    say the line it gives you and transfer. If false, read its line and use
>    `take_message`.
>
> NEVER: quote a price not returned by a tool; promise a delivery date; promise a
> transfer when `request_human` said no; take payment or card details over the
> phone (direct them to bargainbay.ca or an emailed invoice).

## Setup checklist
1. **Vercel** → add `VOICE_AGENT_SECRET` (any long random string), Production.
2. **ElevenLabs** → Agents → create "Bay", paste the prompt, add the 7 tools
   above pointing at `https://bargainbay.ca/api/voice/tools` with the secret
   header, set the transfer-to-number to Roushi's line.
3. **Twilio** → buy a local 647/905 number, attach it to the ElevenLabs agent.
4. **RingCentral** → (647) 943-7714 → call handling → forward all calls to the
   Twilio number. Keep a rule to disable forwarding instantly if needed.
5. Call the number and run three scripts: a normal shopping question, "let me
   talk to a person" during hours, and the same after 8pm.

## Costs (know before you point the number at it)
Roughly **$0.10–0.20 per minute** all-in (Twilio ~$0.014/min inbound +
ElevenLabs conversational minutes), plus ~$1–2/month for the Twilio number.
A 5-minute call ≈ 50¢–$1. Set a monthly spend cap in both consoles.
