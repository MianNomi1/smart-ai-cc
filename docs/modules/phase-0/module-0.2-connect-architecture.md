# Module 0.2 — Amazon Connect Architecture Deep Dive

## Why This Module Matters

Before you build anything on Amazon Connect, you need to understand how it works under the hood. Not just "what buttons to click" — but what happens when a customer dials your number, how their voice reaches an agent, what decides where the call goes, and where things break.

This is what separates someone who can follow a tutorial from someone a client trusts with their contact center.

---

## 1. Deep Concepts

### 1.1 What Amazon Connect Actually Is

Amazon Connect is a **cloud-based contact center platform**. Think of it as the entire phone system for a company — but instead of physical phone lines and hardware PBX boxes in a closet, everything runs in AWS.

**What it replaces:**
- Traditional PBX systems (Avaya, Cisco, Genesys)
- On-premise IVR systems
- Hardware-based call routing

**What makes it different:**
- **Pay-per-use** — You pay per minute of call time, not per seat/license
- **No capacity planning** — AWS handles scaling. 10 calls or 10,000 calls, same setup
- **API-first** — Everything you can do in the console, you can do via API
- **Tight AWS integration** — Native connections to Lambda, Lex, S3, DynamoDB, etc.

### 1.2 How a Phone Call Flows Through Connect — Step by Step

Here's exactly what happens when a customer calls your Connect number:

```
Customer dials +1-800-XXX-XXXX
        │
        ▼
┌─────────────────────┐
│  1. PSTN / Carrier  │  The call enters the public telephone network
│     Network         │  and reaches AWS's telephony partner
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  2. Connect         │  Connect claims the phone number. The number
│     Telephony       │  is mapped to a specific Connect instance
│     Layer           │  and a specific Contact Flow
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  3. Contact Flow    │  The "brain" of the call. A visual flowchart
│     Engine          │  that decides what happens next:
│                     │  - Play a greeting
│                     │  - Ask for input (DTMF or voice)
│                     │  - Call a Lambda function
│                     │  - Invoke a Lex bot
│                     │  - Route to a queue
│                     │  - Transfer to another flow
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  4. Lambda          │  Contact Flow calls Lambda for data:
│     (Data Dip)      │  - Look up customer in DynamoDB
│                     │  - Check business hours
│                     │  - Calculate routing priority
│                     │  IMPORTANT: 8-second timeout for sync calls
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  5. Lex Bot         │  If the flow invokes a bot:
│     (IVR/NLU)       │  - Customer speaks or types
│                     │  - Lex classifies intent
│                     │  - Lex fills slots (collects info)
│                     │  - Lex calls its own Lambda hooks
│                     │  - Returns result to Contact Flow
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  6. Queue           │  Call enters a queue waiting for an agent:
│                     │  - Priority-based ordering
│                     │  - Queue treatment (hold music, messages)
│                     │  - Callback option if wait is long
│                     │  - Overflow to another queue
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  7. Agent           │  Call connects to an agent via CCP:
│     (CCP)           │  - Agent sees customer info (screen pop)
│                     │  - Contact Lens analyzes in real-time
│                     │  - Agent can transfer, hold, conference
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  8. Post-Call       │  After the call ends:
│     Processing      │  - Recording saved to S3
│                     │  - Contact Lens generates transcript
│                     │  - EventBridge fires events
│                     │  - Lambda processes transcript
│                     │  - AI generates summary
└─────────────────────┘
```

### 1.3 The Key Components — What Each One Does

#### Phone Numbers
- You **claim** phone numbers inside Connect (DID or toll-free)
- Each number is associated with a **Contact Flow** (the entry point for calls to that number)
- Numbers are region-specific. A US number lives in a US region
- You can **port** existing numbers into Connect (takes 2-4 weeks)
- Cost: ~$0.06/day for DID, ~$0.06/day for toll-free + per-minute usage

#### Contact Flows
The core of Connect. A contact flow is a **visual flowchart** that controls the caller experience. Think of it as a decision tree:

- **Inbound Flow** — Handles incoming calls. The main one
- **Customer Queue Flow** — What the caller hears while waiting in queue (hold music, position announcements)
- **Agent Whisper Flow** — Played to the agent before they're connected ("This is a claims call about policy 12345")
- **Customer Whisper Flow** — Played to the caller before agent connects ("This call may be recorded")
- **Transfer Flow** — Handles call transfers
- **Outbound Whisper Flow** — For outbound calls

**Flow Blocks** (the building blocks of every flow):

| Block Category | Examples | What They Do |
|---------------|----------|--------------|
| **Interact** | Play prompt, Get customer input, Store customer input | Communicate with the caller |
| **Set** | Set contact attributes, Set recording behavior, Set logging | Configure the contact |
| **Branch** | Check contact attributes, Check hours, Check queue status | Make decisions |
| **Integrate** | Invoke AWS Lambda, Invoke Lex bot | Call external services |
| **Terminate** | Disconnect, Transfer to queue, Transfer to phone number | End or route the call |

#### Queues
Where calls wait for agents. Key concepts:

- **Basic Queue** — A named queue (e.g., "Claims", "Billing", "General")
- **Routing Profile** — Defines which queues an agent handles, in what priority order
- **Hours of Operation** — When a queue is open. Calls outside hours can be routed differently
- **Queue Priority** — When an agent handles multiple queues, priority determines which queue's call they get first
- **Queue Delay** — Minimum time before queue's calls are offered to agents

#### Agents and the CCP (Contact Control Panel)
- Agents use the **CCP** — a web-based softphone embedded in their browser
- CCP can be **customized** using the Amazon Connect Streams API
- Agent states: Available, Offline, After Contact Work (ACW), Custom states
- **After Contact Work** — Time after a call where the agent wraps up (notes, follow-ups) before taking the next call

#### Contact Attributes
The "variables" of a contact flow. Three types:

| Type | Set By | Example | Scope |
|------|--------|---------|-------|
| **System** | Connect automatically | Contact ID, Queue name, Channel | Read-only |
| **User-defined** | Your flow or Lambda | CustomerName, PolicyNumber | Persists through the contact |
| **Lex attributes** | Lex bot | Slots, session attributes | Passed between Lex and flow |

Contact attributes are how you pass data between flow blocks, Lambda functions, and Lex bots. They're key-value pairs (strings only). They persist for the entire duration of the contact.

### 1.4 Channels: Voice vs Chat vs Tasks

Connect supports three channels:

| Channel | How It Works | Key Differences |
|---------|-------------|-----------------|
| **Voice** | Phone call over PSTN or WebRTC | Real-time audio, DTMF input, 8kHz audio for Lex |
| **Chat** | Text-based via Connect Chat SDK or API | Persistent messages, file attachments, typing indicators |
| **Tasks** | Internal work items (not customer-facing) | Created by agents, APIs, or automations. Used for follow-ups |

**Why this matters for AI:** Lex bots behave differently on voice vs chat:
- **Voice:** Audio is streamed to Lex, which does speech-to-text first. Background noise, accents, and audio quality affect accuracy
- **Chat:** Text goes directly to Lex. No speech recognition issues. But customers type with typos, abbreviations, emojis
- **Same bot, different challenges.** A specialist knows this and designs for both

### 1.5 Limits and Quotas That Actually Matter

These are the limits you'll hit in real projects. Not the full list — just the ones that matter:

| Limit | Default Value | Impact | Can Increase? |
|-------|---------------|--------|---------------|
| **Concurrent active calls** | 10 | You can only handle 10 calls at once | Yes — request increase |
| **Lambda timeout in flow** | 8 seconds (sync) | Lambda MUST return in 8s or the flow errors | No — hard limit |
| **Contact attributes size** | 32 KB total | All attributes combined can't exceed 32KB | No |
| **Single attribute value** | 32 KB | One attribute value max size | No |
| **Contact flows per instance** | 500 | Number of flows you can create | Yes |
| **Queues per instance** | 500 | Number of queues | Yes |
| **Phone numbers per instance** | 5 | Starting number of phone numbers | Yes |
| **Lex bots per instance** | 70 | Number of Lex bots you can associate | Yes |
| **Prompts per instance** | 500 | Audio prompts you can upload | Yes |
| **Hours of operation per instance** | 100 | Different schedule configurations | Yes |
| **Routing profiles per instance** | 500 | Agent routing configurations | Yes |
| **Quick connects per instance** | 100 | Speed dial/transfer destinations | Yes |

**The 8-second Lambda limit is the most important one.** Your Lambda functions called from a contact flow via "Invoke AWS Lambda" block MUST return within 8 seconds. If they don't, the flow takes the "Error" branch. This means:
- No cold starts allowed (or at least, cold start + execution must be < 8s)
- No waiting on slow backends
- Cache aggressively
- Use provisioned concurrency for critical functions

### 1.6 Connect Pricing — Understanding the Cost Model

Connect pricing is usage-based. No licenses, no seats, no upfront commitment.

| Component | Cost (us-east-1) | Charged Per |
|-----------|------------------|-------------|
| **Inbound voice** | $0.018/minute | Per minute of call |
| **Outbound voice** | $0.018/minute + telephony | Per minute + carrier charges |
| **Chat** | $0.004/message | Per message sent/received |
| **Tasks** | $0.04/task | Per task created |
| **Phone number (DID)** | $0.06/day | Per number per day |
| **Phone number (toll-free)** | $0.06/day | Per number per day |
| **Contact Lens (voice)** | $0.015/minute | Per minute analyzed |
| **Contact Lens (chat)** | $0.0015/message | Per message analyzed |

**Cost modeling example for SmartInsure:**

Assume 1,000 calls/day, average 5 minutes each:
- Voice: 1,000 × 5 min × $0.018 = **$90/day**
- Contact Lens: 1,000 × 5 min × $0.015 = **$75/day**
- Phone numbers (5): 5 × $0.06 = **$0.30/day**
- Lambda (data dips): Negligible (free tier covers it)
- Lex: 1,000 × ~10 requests × $0.004 = **$40/day** (voice)

**Total: ~$205/day or ~$6,150/month**

**Key insight:** Contact Lens is almost as expensive as the calls themselves. Enable it selectively — not every queue needs real-time analysis.

### 1.7 Multi-Region and DR/HA Patterns

**The reality:** Amazon Connect does NOT natively support multi-region failover. Each Connect instance lives in one region.

**What a specialist recommends:**

| Pattern | Complexity | Use When |
|---------|-----------|----------|
| **Single region** | Low | Most projects. Connect has 99.99% SLA |
| **Active-Passive with phone number failover** | Medium | Client requires documented DR plan. Secondary instance in another region, phone numbers ported if primary region fails |
| **Active-Active with DNS routing** | High | Global contact centers. Different regions handle different geographies. Amazon Connect Global Resiliency feature |

**For SmartInsure:** Single region (us-east-1) is sufficient. Connect's SLA is 99.99%. The risk of a full regional outage is extremely low and the cost/complexity of multi-region isn't justified at this scale.

**What to actually worry about:** Your Lambda functions, DynamoDB tables, and Lex bots — those are what typically fail, not Connect itself. Build resilience into your integrations (retries, fallback flows, graceful degradation).

---

## 2. Architecture & Design Patterns

### 2.1 The "Layered Flow" Pattern

Instead of one massive contact flow that handles everything, use layers:

```
Main IVR Flow (entry point)
    │
    ├── Check Hours → After-Hours Flow (voicemail/callback)
    │
    ├── Lambda: Customer Lookup
    │   └── Sets attributes: customerName, policyStatus, tier
    │
    ├── Lex Bot: Intent Detection
    │   ├── Claims Intent → Claims Flow (separate flow module)
    │   ├── Billing Intent → Billing Flow
    │   ├── Policy Intent → Policy Flow
    │   └── Fallback → General Queue
    │
    └── Error Branch → Apologize + Transfer to General Queue
```

**Why layers:**
- Each flow is testable independently
- Teams can work on different flows without merge conflicts
- You can swap out the claims flow without touching the main IVR
- Error handling is localized — a bug in claims flow doesn't break billing

### 2.2 The "Graceful Degradation" Pattern

**What happens when things break:**

```
Normal Flow:
  Lambda lookup → Customer data → Personalized greeting

If Lambda fails (timeout/error):
  Skip personalization → Generic greeting → Still route to queue

If Lex bot fails:
  Fall back to DTMF menu → "Press 1 for claims, 2 for billing"

If DynamoDB is down:
  Agent gets call without screen pop data → Still functional

If Contact Lens is unavailable:
  Calls still work, just no analytics → Accept the gap
```

**The principle:** No single integration failure should prevent a customer from reaching an agent. Every Lambda call, every Lex invocation, every external lookup must have an error branch that keeps the call alive.

### 2.3 The "Contact Flow as State Machine" Pattern

A contact flow is essentially a state machine. Each block transitions the contact from one state to another. Design your flows with clear states:

```
States:
  GREETING → IDENTIFICATION → INTENT_DETECTION → ROUTING → QUEUED → CONNECTED → POST_CALL

Transitions:
  GREETING: Play welcome message → IDENTIFICATION
  IDENTIFICATION: Lambda lookup customer → INTENT_DETECTION (if found) or ROUTING (if not)
  INTENT_DETECTION: Lex bot classifies intent → ROUTING
  ROUTING: Set queue based on intent + priority → QUEUED
  QUEUED: Queue treatment → CONNECTED (when agent available)
  CONNECTED: Agent handles call → POST_CALL
  POST_CALL: EventBridge triggers → AI processes transcript
```

---

## 3. Real-World Scenarios

### Scenario 1: "Calls Are Dropping After Lambda Timeout"

**Situation:** Client reports that 5% of calls are getting disconnected. You investigate and find that the "Invoke Lambda" block is timing out. The Lambda function queries an external CRM API that sometimes takes 10+ seconds.

**Root Cause:** The 8-second hard limit. The CRM API is slow, Lambda can't return in time, Connect takes the Error branch — which in this case was empty (no blocks), causing a disconnect.

**Your Fix:**
1. **Immediate:** Add blocks to the Error branch — play an apology message, route to queue directly (skip personalization)
2. **Short-term:** Add caching in Lambda (DynamoDB or ElastiCache). First call to CRM takes 10s, subsequent calls use cache
3. **Long-term:** Move CRM sync to an async pipeline. Keep a local copy in DynamoDB that's updated via EventBridge, never query CRM in real-time during a call

### Scenario 2: "Client Wants to Know Why Calls Cost So Much"

**Situation:** Client's monthly Connect bill jumped from $5K to $15K. They want to know why.

**Your Investigation:**
1. Check CloudWatch metrics: `ConcurrentCalls`, `CallsPerInterval` — have call volumes increased?
2. Check average handle time — are calls lasting longer?
3. Check Contact Lens costs — did someone enable it on all queues?
4. Check Lambda costs — are functions running longer, more invocations?
5. Check Lex costs — more bot interactions per call?

**Common culprits:**
- Contact Lens enabled on ALL queues (including ones where it adds no value)
- Long hold times being billed as call minutes
- Lex bot conversations going in circles (retry loops = more requests)
- Test calls during development that were never shut off

### Scenario 3: "Client Wants Real-Time Dashboards"

**Situation:** Client wants a wall-mounted TV showing real-time metrics: calls in queue, average wait time, agent availability.

**Your Options:**
1. **Connect's built-in dashboards** — Real-time metrics page in Connect console. Free. Limited customization
2. **CloudWatch dashboards** — Connect publishes metrics to CloudWatch. More customizable. Cost: ~$3/dashboard/month
3. **Custom dashboard via Streams API** — Full control. Build a React app that uses Connect Streams JS library. Most work but most flexible
4. **QuickSight** — For historical analytics, not real-time. Good for weekly/monthly reports

**Specialist recommendation:** Start with CloudWatch dashboards. If they need more, build custom with Streams API. Don't over-engineer day one.

---

## 4. Standards & Best Practices

### 4.1 Contact Flow Standards

- Every flow MUST have error handling on every Lambda and Lex block
- Every flow MUST have a fallback path to a human agent
- No flow should exceed 50 blocks (split into modules if larger)
- All prompts should be stored as contact flow modules, not inline text
- Use Set Contact Attributes early in the flow to capture metadata for logging

### 4.2 Queue Standards

- Every queue MUST have Hours of Operation configured (even if 24/7)
- Customer Queue Flow MUST include wait time announcement
- Queue overflow must be configured (max time in queue before callback/voicemail)
- Queue names follow the naming convention: `{project}-{env}-queue-{purpose}`

### 4.3 Monitoring Standards (What to Watch)

| Metric | Alarm Threshold | Why |
|--------|----------------|-----|
| `ConcurrentCalls` | > 80% of limit | You're about to hit the ceiling |
| `CallsBreachingConcurrencyQuota` | > 0 | Calls are being REJECTED. Emergency |
| `MisconfiguredPhoneNumbers` | > 0 | A phone number has no flow attached |
| `ThrottledCalls` | > 0 | You're hitting API throttling |
| Lambda error rate | > 5% | Something is wrong with your integrations |
| Lex miss rate | > 20% | Bot isn't understanding callers |
| Average queue wait time | > 2 minutes | Staffing or routing issue |

---

## 5. Hands-On Exercises

### Exercise 1: Explore Your Connect Instance
Log into the AWS Console → Amazon Connect → Open your instance. Navigate through:
- Phone numbers (what's claimed?)
- Contact flows (what default flows exist?)
- Queues (what's configured?)
- Routing profiles (what's the default?)
- Hours of operation

Write down what you find. You need to know your starting point.

### Exercise 2: Build a "Hello World" Contact Flow
Create a flow that:
1. Plays a greeting: "Welcome to SmartInsure"
2. Plays a message: "This is a test flow. Goodbye."
3. Disconnects

Associate it with a phone number. Call the number. Hear your greeting. That's your first end-to-end test.

### Exercise 3: Add a Lambda Data Dip
Modify the flow to:
1. Call your customer-lookup Lambda (from Module 0.1)
2. If customer found → play "Welcome back, {customerName}"
3. If not found → play "We don't recognize your number"
4. If Lambda errors → play "We're experiencing technical difficulties" → route to queue

This exercise proves: Lambda integration works, error handling works, contact attributes work.

### Exercise 4: Map the Limits
Look up the current limits for your Connect instance. Document them. Identify which ones you'll need to increase for production and draft the service quota increase request.

### Exercise 5: Cost Estimation
Based on the pricing table above, estimate the monthly cost for SmartInsure assuming:
- 500 calls/day, average 4 minutes
- 200 chat conversations/day, average 15 messages each
- Contact Lens on 50% of voice calls
- 3 phone numbers
- 2 Lex bots (voice + chat)

---

## 6. Common Mistakes & Anti-Patterns

### Anti-Pattern 1: No Error Branches
**What happens:** Developer builds a flow, connects the "Success" branch of Lambda block, ignores the "Error" branch. Lambda times out in production. Call disconnects.

**The Fix:** Every Lambda block, every Lex block, every external integration MUST have an Error branch that keeps the call alive.

### Anti-Pattern 2: Giant Monolithic Flows
**What happens:** One contact flow with 200 blocks. Nobody can understand it. One change risks breaking everything. Visual editor becomes unusable.

**The Fix:** Modular flows. Main IVR calls sub-flows using "Transfer to flow" block. Each sub-flow handles one domain (claims, billing, etc.)

### Anti-Pattern 3: Ignoring the 8-Second Limit
**What happens:** Developer builds a Lambda that queries three APIs sequentially. Works in dev (fast APIs). Fails in prod under load.

**The Fix:** Design for 3-second execution (leaving 5s buffer). Cache. Async where possible. Provisioned concurrency for critical functions.

### Anti-Pattern 4: Hardcoded Prompts in Flows
**What happens:** Greeting text is typed directly into the Play Prompt block. Marketing wants to change the greeting. Developer has to edit the flow, test, deploy.

**The Fix:** Store prompts in S3 or DynamoDB. Lambda retrieves the prompt text and sets it as a contact attribute. Flow plays the attribute. Marketing can change prompts without touching flows.

### Anti-Pattern 5: Not Testing with Real Phone Calls
**What happens:** Everything works in the Connect flow test page. Deployed to production. Actual callers experience echo, latency, Lex misunderstanding accent-heavy speech.

**The Fix:** Always test with real phone calls before production. Test from a mobile phone with background noise. Test with different accents. The flow test page is for logic testing only, not production readiness.

---

## 7. Interview/Client Review Questions

1. **"Walk me through what happens when a customer calls your Connect number."**
   → Describe all 8 stages from PSTN to post-call processing.

2. **"What's the Lambda timeout limit in a Connect flow and how do you deal with it?"**
   → 8 seconds. Caching, provisioned concurrency, async patterns, and always handle the error branch.

3. **"How would you handle a situation where the backend API your Lambda calls is slow?"**
   → Cache in DynamoDB, async sync via EventBridge, graceful degradation in the flow.

4. **"What's the difference between voice and chat channels in Connect from a technical perspective?"**
   → Voice goes through PSTN + speech-to-text. Chat is direct text. Same flows but different blocks and different Lex behavior.

5. **"How would you estimate the monthly cost of a Connect deployment?"**
   → Break down by: voice minutes, chat messages, Contact Lens, phone numbers, Lex requests, Lambda, data storage.

6. **"A client says they need 99.999% uptime for their contact center. What do you tell them?"**
   → Connect's SLA is 99.99%. For higher, you need multi-region with Global Resiliency. But first question: is the cost justified? Most clients don't actually need 5-nines.

7. **"What monitoring would you set up on day one for a new Connect deployment?"**
   → ConcurrentCalls, CallsBreachingQuota, Lambda errors, Lex miss rate, queue wait times. CloudWatch alarms for each.

8. **"How do contact attributes work and what are their limitations?"**
   → Key-value string pairs. Set by flow, Lambda, or Lex. 32KB total limit. Persist for the entire contact. Used to pass data between flow components.

9. **"A developer says they need to store a JSON object in a contact attribute. What do you tell them?"**
   → Stringify it. But be aware of the 32KB limit. If the object is large, store it in DynamoDB and pass just the key as an attribute.

10. **"What's the biggest operational risk with Amazon Connect?"**
    → Integration failures (Lambda timeouts, backend outages) not being handled gracefully. Connect itself rarely fails. Your code around it is what breaks.

---

## What's Next

Once you've:
- ✅ Explored your Connect instance and documented what exists
- ✅ Built and tested a hello-world contact flow
- ✅ Made a real phone call to your flow
- ✅ Can explain the call flow diagram from memory
- ✅ Can answer the review questions

Tell me you're ready for Module 0.3 — Security & Compliance.
