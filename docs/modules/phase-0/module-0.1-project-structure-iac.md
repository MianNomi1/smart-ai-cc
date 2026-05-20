# Module 0.1 — Project Structure & IaC Standards

## Why This Module Matters

Every failed contact center project I've seen started with the same mistake: someone jumped straight into building Lex bots and Connect flows without establishing structure. Six months later, they have 47 Lambda functions with no naming convention, three "test" flows that are somehow in production, and nobody knows which CloudFormation stack deployed what.

A specialist's first act on any engagement is to establish the foundation. This module is that foundation.

---

## 1. Deep Concepts

### 1.1 Why Folder Structure Matters for Connect Projects

Amazon Connect projects are uniquely complex because they span **multiple AWS services** that are tightly coupled:

- **Connect** (flows, queues, routing profiles, hours of operation)
- **Lex** (bots, intents, slot types, Lambda hooks)
- **Lambda** (data dips, fulfillment, post-call processing)
- **Bedrock** (knowledge bases, agents, guardrails)
- **DynamoDB / RDS** (customer data, conversation state)
- **S3** (recordings, transcripts, documents for RAG)
- **EventBridge** (event-driven pipelines)
- **Contact Lens** (analytics rules)

Each service has its own deployment mechanism, its own lifecycle, and its own team of people who might touch it. Your folder structure must reflect this reality.

**The Principle:** Organize by **service boundary**, not by file type. A Lambda function's code, its IaC definition, and its tests should live close together — not scattered across `src/`, `infra/`, and `tests/` directories.

### 1.2 CDK vs SAM vs Terraform — The Real Decision

| Factor | CDK (TypeScript/Python) | SAM | Terraform |
|--------|------------------------|-----|-----------|
| **Connect support** | Full L2 constructs available | Limited (CloudFormation-level) | Good via AWS provider |
| **Lex v2 support** | L1 constructs (CloudFormation wrapper) | L1 only | Mature support |
| **Bedrock support** | L1/L2 (improving rapidly) | L1 only | Solid support |
| **Lambda bundling** | Built-in (NodejsFunction, PythonFunction) | Built-in | Requires external tooling |
| **Learning curve** | Medium (need programming language + CDK concepts) | Low (YAML + CLI) | Medium (HCL + state management) |
| **Team fit** | Dev-heavy teams | Small teams, quick prototypes | Multi-cloud, ops-heavy teams |
| **State management** | CloudFormation (managed) | CloudFormation (managed) | Self-managed or Terraform Cloud |
| **Drift detection** | Via CloudFormation | Via CloudFormation | Built-in |

**My Recommendation for SmartInsure:** **AWS CDK with TypeScript.**

Why:
- **Type safety** catches misconfigurations at compile time, not deploy time
- **Construct libraries** let you build reusable patterns (e.g., a "ConnectLambda" construct that always includes proper IAM, logging, and timeout settings)
- **Same language** for Lambda handlers (TypeScript) and infrastructure — one mental model
- **Programmatic logic** — you can loop, condition, and compose. Try generating 10 similar queue configurations in SAM YAML
- **Mature Connect support** — CDK has L2 constructs for Connect resources

When CDK is NOT the right choice:
- Client already has Terraform everywhere → use Terraform
- Quick proof of concept with 1-2 Lambdas → SAM is faster
- Client's team is ops-focused, not dev-focused → Terraform

### 1.3 Environment Strategy for Connect

**The Problem:** Amazon Connect instances are **regional singletons** in most organizations. You typically don't spin up a new Connect instance per environment the way you would with an RDS database.

**The Reality:**

| Approach | Pros | Cons |
|----------|------|------|
| **Separate instances per env** (dev/staging/prod) | Full isolation, safe testing | Cost (phone numbers per instance), management overhead, flow sync complexity |
| **Single instance, separate flows** | Lower cost, simpler | Risk of dev changes affecting prod, harder to test |
| **Single instance, alias-based routing** | Balanced | Requires disciplined naming, careful deployment |

**Specialist Approach — Hybrid:**

1. **Production** → Dedicated Connect instance. Locked down. Deployed only via CI/CD.
2. **Development** → Shared Connect instance for dev and staging. Flows are prefixed with environment name. Lex bots use aliases for environment separation.
3. **Lex bots** → Same bot, different aliases (dev, staging, prod). Each alias points to a different version. This is the cheapest and most practical approach.
4. **Lambda functions** → Separate functions per environment (standard serverless practice).
5. **Knowledge Bases** → Separate per environment (different S3 sources, different vector stores).

**Key Insight:** The expensive part of Connect is the **phone numbers and telephony**, not the configuration. For development, you can share a phone number and route based on DTMF input ("Press 1 for dev, 2 for staging"). In production, this is obviously separate.

### 1.4 Naming Conventions — The System That Scales

Bad naming is the #1 cause of "what does this do?" in contact center projects. Here's a naming system that scales:

**Pattern:** `{project}-{environment}-{service}-{resource-type}-{name}`

| Resource | Pattern | Example |
|----------|---------|---------|
| **Connect Flow** | `{project}-{env}-flow-{purpose}` | `smartinsure-prod-flow-main-ivr` |
| **Connect Queue** | `{project}-{env}-queue-{team}` | `smartinsure-prod-queue-claims` |
| **Connect Routing Profile** | `{project}-{env}-rp-{role}` | `smartinsure-prod-rp-claims-agent` |
| **Lex Bot** | `{project}-{env}-bot-{purpose}` | `smartinsure-dev-bot-claims` |
| **Lex Bot Alias** | `{env}` | `dev`, `staging`, `prod` |
| **Lambda Function** | `{project}-{env}-{service}-{action}` | `smartinsure-prod-lex-validate-claim` |
| **DynamoDB Table** | `{project}-{env}-{entity}` | `smartinsure-prod-policies` |
| **S3 Bucket** | `{project}-{env}-{purpose}-{account-id}` | `smartinsure-prod-recordings-929057627672` |
| **Knowledge Base** | `{project}-{env}-kb-{domain}` | `smartinsure-prod-kb-policies` |
| **CDK Stack** | `{Project}{Env}{Service}Stack` | `SmartInsureProdLexStack` |
| **EventBridge Rule** | `{project}-{env}-rule-{trigger}` | `smartinsure-prod-rule-post-call` |

**Rules:**
- Always lowercase with hyphens (except CDK stack names which use PascalCase)
- Environment is always present — no resource exists without an environment tag
- S3 buckets include account ID to guarantee global uniqueness
- Lambda functions include the service they serve (lex, connect, bedrock) — this makes IAM policies cleaner

### 1.5 Tagging Strategy

Tags are how you answer "how much does the claims bot cost?" and "who deployed this?"

**Mandatory Tags (every resource):**

| Tag Key | Example Value | Purpose |
|---------|---------------|---------|
| `Project` | `smartinsure` | Cost allocation, resource grouping |
| `Environment` | `dev` / `staging` / `prod` | Environment identification |
| `Service` | `lex` / `connect` / `bedrock` / `lambda` | Service boundary |
| `Owner` | `claims-team` | Ownership and accountability |
| `ManagedBy` | `cdk` | Identifies IaC-managed resources (don't manually edit) |
| `CostCenter` | `cc-contact-center` | Finance/billing allocation |

**Optional Tags:**

| Tag Key | Example Value | Purpose |
|---------|---------------|---------|
| `DataClassification` | `pii` / `confidential` / `public` | Security and compliance |
| `Compliance` | `hipaa` / `gdpr` / `none` | Regulatory tracking |
| `AutoShutdown` | `true` | Cost control for dev resources |

**CDK Implementation:** Tags are applied at the stack level and inherited by all resources. You never manually tag individual resources.

### 1.6 Git Workflow for Contact Center Projects

**The Challenge:** Connect flows are partially managed in the console (visual editor) and partially in code. This creates a hybrid workflow.

**Branch Strategy:**

```
main (production)
├── staging (pre-production validation)
└── dev (active development)
    ├── feature/claims-bot-v2
    ├── feature/post-call-pipeline
    └── fix/lex-timeout-issue
```

**Rules:**
- `main` is always deployable. CI/CD deploys to production from `main`.
- `staging` is for integration testing. Deployed automatically on merge.
- `dev` is the working branch. Feature branches merge here first.
- Never commit Connect flow JSON that was exported manually — flows are defined in CDK or deployed via CI/CD.
- Lex bot definitions are version-controlled as CDK constructs, not console exports.

**Connect-Specific Git Rules:**
1. **Contact flows** → Defined as CDK constructs (JSON flow definition embedded in CDK). Never edited in console for production.
2. **Lex bots** → Defined entirely in CDK. Console is for testing only.
3. **Lambda code** → Standard git workflow. PR reviews required.
4. **Prompt templates** → Stored in repo under `prompts/`, version-controlled like code.
5. **Knowledge base documents** → Stored in S3, but ingestion pipeline code is in repo.

---

## 2. Architecture & Design Patterns

### 2.1 The Monorepo Pattern for Contact Center Projects

```
smart-ai-cc/
├── bin/                          # CDK app entry point
│   └── app.ts
├── lib/                          # CDK stack definitions
│   ├── stacks/
│   │   ├── connect-stack.ts      # Connect resources (flows, queues)
│   │   ├── lex-stack.ts          # Lex bots, intents, slots
│   │   ├── lambda-stack.ts       # All Lambda functions
│   │   ├── bedrock-stack.ts      # Knowledge bases, agents
│   │   ├── data-stack.ts         # DynamoDB, RDS, S3
│   │   └── pipeline-stack.ts     # EventBridge, Step Functions
│   └── constructs/               # Reusable CDK constructs
│       ├── connect-lambda.ts     # Lambda with Connect-specific defaults
│       ├── lex-bot.ts            # Bot construct with standards baked in
│       └── tagged-stack.ts       # Base stack with auto-tagging
├── src/                          # Runtime code (Lambda handlers)
│   ├── lex/                      # Lex Lambda hooks
│   │   ├── validate-claim/
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   ├── fulfill-claim/
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   └── policy-lookup/
│   │       ├── index.ts
│   │       └── index.test.ts
│   ├── connect/                  # Connect Lambda data dips
│   │   ├── customer-lookup/
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   └── routing-logic/
│   │       ├── index.ts
│   │       └── index.test.ts
│   ├── bedrock/                  # Bedrock-related Lambdas
│   │   ├── query-kb/
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   └── post-call-summary/
│   │       ├── index.ts
│   │       └── index.test.ts
│   ├── pipeline/                 # Event-driven pipeline Lambdas
│   │   ├── process-transcript/
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   └── generate-email/
│   │       ├── index.ts
│   │       └── index.test.ts
│   └── shared/                   # Shared utilities
│       ├── logger.ts
│       ├── connect-response.ts
│       ├── lex-response.ts
│       └── config.ts
├── prompts/                      # Bedrock prompt templates
│   ├── summarization.txt
│   ├── email-generation.txt
│   └── claim-extraction.txt
├── flows/                        # Connect flow definitions (JSON)
│   ├── main-ivr.json
│   ├── claims-flow.json
│   └── after-hours.json
├── docs/                         # Project documentation
│   └── modules/                  # Learning module docs
├── scripts/                      # Utility scripts
│   ├── deploy.sh
│   └── seed-data.sh
├── test/                         # Integration tests
│   ├── lex-batch-test.json
│   └── e2e/
├── .github/                      # CI/CD
│   └── workflows/
│       ├── deploy-dev.yml
│       └── deploy-prod.yml
├── cdk.json
├── tsconfig.json
├── package.json
├── .env.example
├── .eslintrc.json
└── .gitignore
```

**Why this structure:**

- **`lib/stacks/`** — Each stack deploys independently. You can update Lambda functions without touching Connect flows. This is critical because Connect flow deployments are riskier than Lambda deployments.
- **`lib/constructs/`** — Reusable patterns. Your `ConnectLambda` construct enforces: 30-second timeout (Connect's limit is 8 seconds for sync, but we use 30 for async), proper IAM role, X-Ray tracing, structured logging. Every Lambda in the project inherits these.
- **`src/{service}/{function}/`** — Each Lambda is self-contained with its handler and unit test co-located. No hunting for tests.
- **`src/shared/`** — Utilities shared across Lambdas. Logger with correlation ID support, standardized Connect/Lex response builders.
- **`prompts/`** — Prompt templates are version-controlled alongside code. Changes to prompts go through PR review.
- **`flows/`** — Connect flow JSON definitions. These are generated by CDK or exported for reference. In Phase 4, we'll define flows programmatically.

### 2.2 Stack Dependency Pattern

```
DataStack (DynamoDB, S3, RDS)
    ↓
LambdaStack (all Lambda functions — needs table ARNs, bucket names)
    ↓
LexStack (bots — needs Lambda ARNs for code hooks)
    ↓
ConnectStack (flows, queues — needs Lex bot ARNs)
    ↓
BedrockStack (knowledge bases — needs S3 bucket, RDS)
    ↓
PipelineStack (EventBridge rules — needs Lambda ARNs, Connect ARNs)
```

**Why this order:** Each stack only depends on the outputs of stacks above it. This means you can deploy `DataStack` alone, or deploy `LambdaStack` without touching `ConnectStack`. Independent deployment = less risk.

### 2.3 Config-Driven Environment Management

Instead of `if/else` blocks everywhere, use a config object:

```typescript
// lib/config.ts
interface EnvironmentConfig {
  envName: string;
  connectInstanceArn: string;
  connectInstanceId: string;
  lexBotAliasId: string;
  bedrockModelId: string;
  logRetentionDays: number;
  lambdaMemoryMb: number;
  enableXRay: boolean;
  tags: Record<string, string>;
}

const configs: Record<string, EnvironmentConfig> = {
  dev: {
    envName: 'dev',
    connectInstanceArn: 'arn:aws:connect:us-east-1:929057627672:instance/6383f652-5970-42fa-8fab-d6de6b561427',
    connectInstanceId: '6383f652-5970-42fa-8fab-d6de6b561427',
    lexBotAliasId: 'TSTALIASID',
    bedrockModelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    logRetentionDays: 7,
    lambdaMemoryMb: 256,
    enableXRay: false,
    tags: {
      Project: 'smartinsure',
      Environment: 'dev',
      ManagedBy: 'cdk',
    },
  },
  prod: {
    envName: 'prod',
    connectInstanceArn: 'arn:aws:connect:us-east-1:929057627672:instance/PROD-INSTANCE-ID',
    connectInstanceId: 'PROD-INSTANCE-ID',
    lexBotAliasId: 'PRODALIASID',
    bedrockModelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    logRetentionDays: 90,
    lambdaMemoryMb: 512,
    enableXRay: true,
    tags: {
      Project: 'smartinsure',
      Environment: 'prod',
      ManagedBy: 'cdk',
    },
  },
};
```

Every stack reads from this config. Zero hardcoded values in stack definitions.

---

## 3. Real-World Scenarios

### Scenario 1: "The Client Has No Structure"

**Situation:** You walk into a client engagement. They have an Amazon Connect instance with 15 contact flows named things like "Main Flow", "Test Flow 2", "John's Flow Copy", and "FINAL FINAL v3". There are 8 Lambda functions, none in version control. Three developers have been working directly in the console.

**Your Move:**
1. Audit everything currently deployed (Connect describe APIs, list Lambda functions)
2. Document the current state in a spreadsheet (what exists, what it does, who owns it)
3. Set up the project repo with proper structure
4. Migrate existing resources into CDK using `cdk import` or by defining them from scratch
5. Establish the naming convention and rename resources during migration
6. Set up CI/CD so nobody touches the console for production deployments again

**Key Insight:** Don't try to fix everything at once. Migrate one flow at a time, prove the process works, then accelerate.

### Scenario 2: "The Client Wants Terraform"

**Situation:** Client's platform team mandates Terraform for all infrastructure. But your Connect + Lex + Bedrock expertise is in CDK.

**Your Move:**
- Respect the client's existing standards. Don't fight it.
- Use `cdktf` (CDK for Terraform) as a bridge if the team is open to it
- If pure Terraform is required, structure your `.tf` files to mirror the same pattern: one module per service boundary
- Lambda code is still TypeScript in `src/` — only the IaC layer changes
- Ensure Terraform state is in S3 with DynamoDB locking (non-negotiable)

### Scenario 3: "We Need to Move Fast"

**Situation:** Client says "we have a demo in 2 weeks, just get something working."

**Your Move:**
- Use SAM for the initial prototype (fastest time to deploy)
- BUT still follow naming conventions and folder structure
- Document every shortcut you take in a `TECH_DEBT.md` file
- After the demo, migrate to CDK properly
- Never let "move fast" mean "skip structure" — the structure IS what makes you fast later

---

## 4. Reference Implementation

The reference implementation is the project scaffold itself. After studying this module, you will create:

1. **CDK project initialized with TypeScript**
2. **Folder structure** matching the pattern above
3. **Base constructs** (`TaggedStack`, `ConnectLambda`)
4. **Environment config** with dev settings
5. **Proper .gitignore, tsconfig, eslint**
6. **A deploying "hello world" stack** that proves the pipeline works

See the files I'll create in your repo as the reference scaffold.

---

## 5. Standards & Best Practices

### 5.1 File Naming
- All files use **kebab-case**: `validate-claim.ts`, not `validateClaim.ts`
- Test files are co-located: `index.ts` + `index.test.ts` in same folder
- CDK stacks use **kebab-case** files but **PascalCase** class names

### 5.2 Stack Boundaries
- One stack per service domain (Connect, Lex, Lambda, Data, Bedrock, Pipeline)
- Stacks communicate via **exports/imports** or **SSM parameters** — never hardcoded ARNs
- A stack should be independently deployable

### 5.3 Lambda Standards
- **Runtime:** Node.js 20.x (latest LTS)
- **Timeout:** 30 seconds (Connect sync limit is 8s, but async operations need more)
- **Memory:** 256MB minimum (128MB causes cold start issues with TypeScript)
- **Logging:** Structured JSON logs with `contactId` as correlation ID
- **Bundling:** esbuild via CDK's `NodejsFunction` — tree-shaking, minification
- **Layers:** Only for large shared dependencies (AWS SDK is already in runtime)

### 5.4 Environment Variable Standards
- Lambda functions receive config via environment variables, not hardcoded values
- Sensitive values (API keys) use Secrets Manager, referenced at deploy time
- Non-sensitive config (table names, bucket names) are env vars set by CDK

---

## 6. Hands-On Exercises

### Exercise 1: Initialize the Project (Do This First)
**Task:** Initialize a CDK TypeScript project in your repo. Set up the folder structure matching the architecture pattern. Create the environment config file.

**Hints:**
- Use `cdk init app --language typescript`
- You'll need to restructure after init (CDK generates a flat structure)
- Install: `@aws-cdk/aws-connect-alpha` if available, otherwise use L1 constructs

### Exercise 2: Build the TaggedStack Construct
**Task:** Create a base stack class that automatically applies all mandatory tags to every resource in the stack. All your stacks will extend this.

**Hints:**
- Look at `cdk.Tags.of(this).add()`
- The construct should accept the environment config and apply tags
- Bonus: Add a stack name prefix based on project + environment

### Exercise 3: Build the ConnectLambda Construct
**Task:** Create a reusable construct that creates a Lambda function with all the Connect-specific defaults: timeout, memory, X-Ray tracing, structured logging, proper IAM role.

**Hints:**
- Extend `NodejsFunction` or create a construct that wraps it
- Default timeout: 30 seconds
- Default memory: 256 MB
- X-Ray tracing: Active (for prod), PassThrough (for dev)
- Log retention: from config
- Bundling: esbuild with tree-shaking

### Exercise 4: Deploy a Hello World Stack
**Task:** Create a simple stack with one Lambda function using your `ConnectLambda` construct, deploy it to your AWS account, and verify in the console that:
- The function exists with correct name
- Tags are all present
- Timeout and memory are correct
- CloudWatch log group has correct retention

### Exercise 5: Set Up CI/CD Foundation
**Task:** Create a GitHub Actions workflow that:
- Runs `cdk synth` on every PR (validates the template)
- Runs `cdk diff` and posts the output as a PR comment
- Deploys to dev on merge to `dev` branch

**Hints:**
- Use OIDC for AWS authentication (never put AWS keys in GitHub secrets directly)
- `cdk synth` catches most configuration errors without deploying

---

## 7. Common Mistakes & Anti-Patterns

### Anti-Pattern 1: The "Everything in One Stack" Mistake
**What happens:** All resources in one massive CloudFormation stack. 200+ resources. Deployment takes 45 minutes. One failed resource rolls back everything.

**The Fix:** Split by service boundary. 6-8 focused stacks of 20-40 resources each. Independent deployments. Faster rollbacks.

### Anti-Pattern 2: Console Cowboys
**What happens:** Developer edits a Connect flow in the console "just to test." Forgets to update CDK. Next CDK deploy overwrites their changes. Features disappear in production.

**The Fix:** Console is for viewing and testing only. All changes go through code. CDK drift detection as a scheduled check.

### Anti-Pattern 3: Hardcoded ARNs
**What happens:** Lambda function has `arn:aws:dynamodb:us-east-1:123456:table/my-table` hardcoded. Works in dev. Breaks in prod because account ID is different.

**The Fix:** Everything is an environment variable set by CDK. `process.env.POLICIES_TABLE_NAME`, never a hardcoded ARN.

### Anti-Pattern 4: No Tagging
**What happens:** 6 months in, finance asks "how much does the AI chatbot cost?" You can't answer because nothing is tagged. You spend 3 days manually mapping resources to projects.

**The Fix:** Tags are mandatory from day 1. Applied at the stack level. Cost allocation tags enabled in AWS Billing.

### Anti-Pattern 5: Flat Lambda Structure
**What happens:** All Lambda code in `src/handlers/`. 30 files in one directory. No tests. Shared code is copy-pasted between handlers.

**The Fix:** One folder per function. Tests co-located. Shared code in `src/shared/` imported explicitly.

### Anti-Pattern 6: No Environment Separation for Lex
**What happens:** Dev team tests utterances on the same Lex bot alias that production uses. A bad utterance set gets published. Production bot starts misclassifying intents.

**The Fix:** Lex bot aliases for environment separation. `dev` alias → draft version (for testing). `prod` alias → pinned version (only updated via CI/CD).

---

## 8. Interview/Client Review Questions

After completing this module, you should be able to answer these confidently:

1. **"How would you structure a new Amazon Connect project from scratch?"**
   → Walk through the monorepo pattern, explain stack boundaries, naming conventions.

2. **"CDK vs SAM vs Terraform for a Connect project — what do you recommend and why?"**
   → Depends on the client's existing tooling. Default recommendation is CDK with TypeScript. Explain why.

3. **"How do you handle environment separation when Connect instances are expensive?"**
   → Hybrid approach: separate instances for prod, shared instance for dev/staging with naming prefixes. Lex aliases for bot environment separation.

4. **"How do you prevent developers from making changes directly in the AWS console?"**
   → CI/CD pipeline, IAM restrictions on production accounts, CDK drift detection, team discipline.

5. **"What's your tagging strategy for a contact center project?"**
   → Mandatory tags (Project, Environment, Service, Owner, ManagedBy, CostCenter). Applied at stack level. Cost allocation enabled.

6. **"How do you handle a situation where the client already has a messy Connect setup?"**
   → Audit, document, migrate incrementally. One flow at a time. Don't try to fix everything at once.

7. **"What's the deployment order for a Connect + Lex + Lambda project?"**
   → Data → Lambda → Lex → Connect → Bedrock → Pipeline. Each layer depends on the one before it.

8. **"How do you manage Connect flow definitions in code?"**
   → JSON definitions stored in repo, deployed via CDK or Connect APIs. Console is for viewing/testing only.

9. **"A developer says 'CDK is too slow, let me just update this Lambda in the console.' What do you do?"**
   → Understand their pain point (CDK deploy is slow). Fix the real problem: use `--hotswap` for dev, or `cdk watch`. Never allow console changes as a workaround.

10. **"How do you ensure every resource in the project follows naming conventions?"**
    → Constructs enforce naming. The `ConnectLambda` construct, `TaggedStack` base class — naming is baked into the tooling, not left to human discipline.

---

## What's Next

Once you've:
- ✅ Set up the project with proper folder structure
- ✅ Created the base constructs (TaggedStack, ConnectLambda)
- ✅ Deployed a hello-world stack successfully
- ✅ Verified tags, naming, and configuration in the AWS console
- ✅ Can answer the review questions above

Tell me you're ready, and I'll deliver **Module 0.2 — Amazon Connect Architecture Deep Dive**.
