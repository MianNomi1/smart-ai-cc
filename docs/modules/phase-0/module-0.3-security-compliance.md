# Module 0.3 — Security & Compliance for AI Contact Centers

## Why This Module Matters

A contact center handles the most sensitive data a business has — customer identities, financial information, health records, payment details, and recorded conversations. One security mistake and you're on the news.

In AI-powered contact centers, the risk multiplies. You're now sending customer data to AI models, storing transcripts in vector databases, and generating content based on private information. Every hop is an attack surface.

A specialist doesn't bolt on security at the end. Security is baked into every decision from day one. This module teaches you how.

---

## 1. Deep Concepts

### 1.1 The Security Surface of an AI Contact Center

Every arrow in this diagram is a place where data flows — and a place where data can leak:

```
Customer (voice/chat)
    │
    ▼
Amazon Connect ──────── S3 (recordings, transcripts)
    │                        │
    ├── Lex Bot              ├── Bedrock KB (vector store)
    │    │                   │        │
    │    └── Lambda ─────────┤        └── RDS (pgvector)
    │         │              │
    │         ├── DynamoDB   │
    │         ├── Secrets Mgr│
    │         └── External API
    │
    ├── Contact Lens ──── S3 (analysis output)
    │
    └── EventBridge ──── Lambda (post-call pipeline)
                              │
                              ├── Bedrock (summarization)
                              └── SES (email generation)
```

**Data at risk at each point:**

| Component | Data Exposed | Risk Level |
|-----------|-------------|------------|
| Connect call recording | Full audio of conversation (SSN, credit card, health info) | Critical |
| Contact Lens transcript | Text version of everything said | Critical |
| Lex session | Customer utterances, slot values (policy numbers, dates) | High |
| Lambda logs | Whatever you log — potentially PII if careless | High |
| DynamoDB | Customer records, policy details | High |
| Bedrock prompts | Customer context injected into prompts | High |
| Bedrock responses | AI-generated content that may echo PII | Medium |
| S3 documents | Policy documents for RAG (may contain PII) | Medium |
| EventBridge events | Contact metadata, attributes | Medium |

### 1.2 IAM — The Foundation of Everything

IAM (Identity and Access Management) controls WHO can do WHAT to WHICH resources. In a contact center project, you have multiple services talking to each other, each needing specific permissions.

**The Principle: Least Privilege**

Every Lambda function, every service, every role gets ONLY the permissions it needs. Nothing more.

**Bad example:**
```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```
This gives a Lambda function access to everything in your AWS account. If the function is compromised, the attacker owns everything.

**Good example:**
```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:Query"
  ],
  "Resource": "arn:aws:dynamodb:us-east-1:929057627672:table/smartinsure-dev-data-policies"
}
```
This Lambda can only read from one specific table. Even if compromised, damage is contained.

### 1.3 IAM Patterns for Each Service Pair

#### Connect → Lambda
Connect invokes Lambda functions from contact flows. The Lambda function needs:
- An execution role with permissions to access whatever it needs (DynamoDB, S3, etc.)
- Connect needs `lambda:InvokeFunction` permission on that specific function
- The Lambda resource-based policy must allow the Connect instance to invoke it

**CDK handles this automatically** when you use `connectInstance.grantInvoke(lambdaFunction)` or add a resource policy.

#### Lambda → DynamoDB
```
Lambda execution role needs:
  - dynamodb:GetItem (for lookups)
  - dynamodb:PutItem (for writes)
  - dynamodb:Query (for queries)
  - dynamodb:UpdateItem (for updates)
  
Scoped to specific table ARN(s) — not "Resource: *"
```

In CDK: `table.grantReadData(fn)` or `table.grantReadWriteData(fn)` — these generate least-privilege policies automatically. This is why CDK is superior for security — you don't hand-write policies.

#### Lambda → Bedrock
```
Lambda execution role needs:
  - bedrock:InvokeModel (to call Claude/Titan)
  - bedrock:Retrieve (to query knowledge base)
  
Scoped to specific model ARN and/or knowledge base ARN
```

#### Lambda → Secrets Manager
```
Lambda execution role needs:
  - secretsmanager:GetSecretValue
  
Scoped to the specific secret ARN(s) the function needs
```

#### Connect → Lex
```
Connect service role needs:
  - lex:RecognizeText
  - lex:RecognizeUtterance
  - lex:DeleteSession
  - lex:PutSession
  
Scoped to the specific bot alias ARN
```

#### Contact Lens → S3
Contact Lens writes analysis output to S3. This is configured at the instance level. The S3 bucket policy must allow the Connect service principal to write.

### 1.4 Encryption — Data at Rest and in Transit

**In Transit (data moving between services):**

| Path | Encryption | Your Action |
|------|-----------|-------------|
| Customer → Connect (voice) | TLS (automatic) | None — Connect handles it |
| Connect → Lambda | TLS (automatic) | None — AWS internal |
| Lambda → DynamoDB | TLS (automatic) | None — AWS SDK uses HTTPS |
| Lambda → Bedrock | TLS (automatic) | None — AWS SDK uses HTTPS |
| Lambda → External API | HTTPS (you must enforce) | Always use HTTPS. Never HTTP |

**At Rest (data stored):**

| Storage | Default Encryption | Best Practice |
|---------|-------------------|---------------|
| S3 (recordings) | SSE-S3 | Use SSE-KMS with customer-managed key for compliance |
| S3 (transcripts) | SSE-S3 | SSE-KMS with customer-managed key |
| DynamoDB | AWS-owned key | Use customer-managed KMS key for PII tables |
| CloudWatch Logs | None by default | Enable encryption with KMS key |
| Lex conversation logs | None by default | Enable and encrypt with KMS |
| RDS (pgvector) | Optional | Enable encryption at creation (can't add later!) |

**Customer-Managed KMS Key vs AWS-Managed Key:**

- **AWS-managed:** AWS creates and manages the key. You can't control rotation, deletion, or access policies. Good enough for non-regulated workloads
- **Customer-managed:** You create the key, control the policy, set rotation schedule, can audit usage via CloudTrail. Required for HIPAA/PCI/financial compliance

**For SmartInsure:** Use customer-managed KMS keys for everything that stores PII (recordings, transcripts, customer tables). Use AWS-managed for non-sensitive resources (deployment artifacts, CDK assets).

### 1.5 PII Handling in AI Contact Centers

PII (Personally Identifiable Information) flows through every layer of your system. Here's where it shows up and what to do:

#### In Call Recordings
- Customers speak their SSN, credit card numbers, policy numbers
- **Mitigation:** Enable Connect's PII redaction for recordings. Contact Lens can detect and redact sensitive data from transcripts
- **Best practice:** Don't store recordings longer than required. Set S3 lifecycle policies

#### In Transcripts
- Contact Lens transcripts contain everything said
- **Mitigation:** Enable PII redaction in Contact Lens. Redacted transcripts replace "My SSN is 123-45-6789" with "My SSN is [SSN]"
- **Note:** You can keep BOTH redacted and unredacted versions. Redacted for general access, unredacted in a restricted bucket for compliance investigations

#### In Lambda Logs
- If you log `event.Details.Parameters` or Lex slot values, you're logging PII
- **Mitigation:** Never log raw customer input. Log references (policy ID) not values (SSN). The structured logger from Module 0.1 helps — but you must be disciplined about WHAT you log

```typescript
// BAD — logs PII
logger.info("Customer data", { ssn: customer.ssn, creditCard: customer.cc });

// GOOD — logs references only
logger.info("Customer identified", { customerId: customer.id, policyId: customer.policyId });
```

#### In Bedrock Prompts
- When you inject customer data into a Bedrock prompt for summarization or response generation, that data is sent to the model
- **AWS guarantee:** Bedrock does NOT use your data for model training. Your prompts are not shared. But you should still minimize PII in prompts
- **Mitigation:** Use Bedrock Guardrails with PII filters. Send only what the model needs, not the entire customer record

#### In Vector Database (RAG)
- If your knowledge base documents contain customer-specific PII, that PII is embedded and stored in the vector database
- **Best practice:** Knowledge bases should contain POLICY documents (general product info), not CUSTOMER data. Customer-specific answers come from DynamoDB, not RAG

### 1.6 HIPAA and Financial Compliance

**HIPAA (Health Insurance Portability and Accountability Act):**

If SmartInsure handles health insurance:
- Amazon Connect IS HIPAA-eligible (you must sign a BAA with AWS)
- Lambda, DynamoDB, S3, Bedrock are all HIPAA-eligible
- You MUST encrypt all PHI at rest with customer-managed KMS keys
- You MUST enable CloudTrail for all API calls
- You MUST restrict access to PHI to authorized roles only
- Call recordings containing PHI must be retained per HIPAA retention requirements (6 years)

**PCI DSS (Payment Card Industry):**

If customers provide credit card numbers over the phone:
- Do NOT store credit card numbers in DynamoDB or anywhere
- Use Connect's "Store Customer Input" with encryption for sensitive DTMF
- Consider tokenization — replace CC numbers with tokens immediately
- PCI DSS compliance requires Connect to be configured in specific ways — AWS has a PCI guide

**SOC 2:**
- Amazon Connect is SOC 2 compliant
- Your responsibility: proper access controls, audit logging, change management
- Tags help demonstrate which resources are in scope for SOC 2 audit

### 1.7 Secrets Management

**Never hardcode secrets.** No API keys in code. No passwords in environment variables. No tokens in config files.

**The pattern:**

```
Secret stored in → AWS Secrets Manager
                        │
Lambda reads at  → Runtime (cached for duration of execution)
                        │
Used for         → External API calls, database connections, etc.
```

**Types of secrets in a contact center project:**

| Secret | Where It Goes | How It's Accessed |
|--------|--------------|-------------------|
| External CRM API key | Secrets Manager | Lambda reads at runtime |
| Database password (RDS) | Secrets Manager with rotation | Lambda reads via SDK |
| Bedrock custom model endpoint | SSM Parameter Store (not sensitive) | Environment variable or SSM |
| Connect instance ID | SSM Parameter Store | CDK reads at deploy time |

**Secrets Manager vs SSM Parameter Store:**

| Feature | Secrets Manager | SSM Parameter Store |
|---------|----------------|-------------------|
| Cost | $0.40/secret/month + $0.05/10K API calls | Free for standard, $0.05/advanced |
| Auto-rotation | Built-in Lambda rotation | Manual |
| Cross-account | Supported | Supported |
| Use for | Passwords, API keys, tokens | Config values, non-sensitive settings |

**Rule of thumb:** If it's a password or API key → Secrets Manager. If it's a configuration value → SSM Parameter Store.

---

## 2. Architecture & Design Patterns

### 2.1 The "Security Boundary" Pattern

Organize IAM roles by security boundary, not by function:

```
┌─────────────────────────────────┐
│  Connect Boundary               │
│  - ConnectServiceRole           │
│  - Permissions: Lex, Lambda,    │
│    S3 (recordings), CloudWatch  │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Real-Time Boundary             │
│  - LexHookLambdaRole            │
│  - Permissions: DynamoDB (read),│
│    Bedrock (invoke), Secrets Mgr│
│  - 8-second timeout constraint  │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Post-Call Boundary             │
│  - PipelineLambdaRole           │
│  - Permissions: S3 (transcripts)│
│    Bedrock (invoke), DynamoDB   │
│    (write), SES (send email)    │
│  - No time constraint           │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  Admin Boundary                 │
│  - AdminRole (human users)      │
│  - Permissions: Connect admin,  │
│    CloudWatch, read-only on     │
│    production resources         │
└─────────────────────────────────┘
```

**Why separate roles:**
- If the Lex hook Lambda is compromised, it can't send emails (that's the pipeline role)
- If the pipeline Lambda is compromised, it can't read live customer data from Connect
- Blast radius is contained within each boundary

### 2.2 The "Encrypt Everything" Pattern — CDK Implementation

```typescript
import * as kms from "aws-cdk-lib/aws-kms";

// One KMS key per data classification
const piiKey = new kms.Key(this, "PiiEncryptionKey", {
  alias: `${projectName}-${env}-pii-key`,
  description: "Encrypts all PII data (recordings, transcripts, customer tables)",
  enableKeyRotation: true,  // Annual automatic rotation
  removalPolicy: RemovalPolicy.RETAIN,  // Never delete encryption keys
});

// DynamoDB with encryption
const policiesTable = new dynamodb.Table(this, "PoliciesTable", {
  encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
  encryptionKey: piiKey,
  // ... other props
});

// S3 with encryption
const recordingsBucket = new s3.Bucket(this, "RecordingsBucket", {
  encryption: s3.BucketEncryption.KMS,
  encryptionKey: piiKey,
  // ... other props
});

// CloudWatch Logs with encryption
const logGroup = new logs.LogGroup(this, "LambdaLogs", {
  encryptionKey: piiKey,
  // ... other props
});
```

**Key rotation:** Enable automatic rotation. AWS rotates the key material annually but keeps old key material so existing data can still be decrypted. Zero downtime.

### 2.3 The "Audit Everything" Pattern

```
CloudTrail (API calls)
    │
    ├── All Connect API calls logged
    ├── All Lambda invocations logged
    ├── All DynamoDB operations logged
    ├── All S3 access logged
    ├── All Bedrock invocations logged
    └── All KMS key usage logged
            │
            ▼
    S3 Bucket (audit logs)
        │
        └── Lifecycle: Archive to Glacier after 90 days
            Retain for 7 years (compliance)
```

In CDK:
```typescript
const trail = new cloudtrail.Trail(this, "AuditTrail", {
  trailName: `${projectName}-${env}-audit`,
  bucket: auditBucket,
  enableFileValidation: true,  // Detect tampered logs
  isMultiRegionTrail: false,   // Single region for now
  includeGlobalServiceEvents: true,
});

trail.addEventSelector(cloudtrail.DataResourceType.S3_OBJECT, [
  `${recordingsBucket.bucketArn}/`,
]);
```

---

## 3. Real-World Scenarios

### Scenario 1: "Auditor Asks: Who Accessed Customer Recordings?"

**Situation:** Compliance auditor asks you to show who accessed a specific customer's call recording in the last 30 days.

**Your Response:**
1. S3 access logs show every GET request to the recordings bucket (who, when, which file)
2. CloudTrail shows the API call details (IAM role/user, source IP, timestamp)
3. Connect's built-in audit log shows who played recordings in the Connect console

**What you need configured for this to work:**
- S3 server access logging enabled on the recordings bucket
- CloudTrail with S3 data events enabled
- Connect CloudTrail integration enabled

**If you DON'T have this:** You can't answer the auditor's question. This is a compliance failure. Set it up from day one.

### Scenario 2: "Customer Says 'Don't Record My Call'"

**Situation:** A customer says "I don't want this call recorded" during the call. How do you handle this?

**Your Approach:**
1. In the contact flow, after the customer says this (detected by Lex or keyword detection), invoke a Lambda function
2. Lambda calls Connect's `UpdateContactRecordingBehavior` API to stop recording
3. Set a contact attribute `recordingStopped=true` so the agent knows
4. Contact Lens will also stop analysis since there's no audio to analyze

**CDK consideration:** The Lambda that stops recording needs `connect:UpdateContactRecordingBehavior` permission on the Connect instance.

### Scenario 3: "Developer Accidentally Logged PII"

**Situation:** Code review reveals a Lambda function has been logging `event.Details.ContactData.CustomerEndpoint.Address` (the customer's phone number) to CloudWatch Logs for 3 months.

**Your Response:**
1. **Immediate:** Fix the code. Remove PII from logs. Deploy
2. **Containment:** Those log entries exist in CloudWatch. You can't selectively delete individual log entries
3. **Options:**
   - Delete the entire log group (loses all logs, not ideal)
   - Wait for log retention to expire (if retention is set to 7 days, they're gone in a week)
   - If under GDPR: this may need to be reported as a data breach if EU customer data is involved
4. **Prevention:** Add a log sanitizer to the shared logger that strips phone number patterns before logging. Add a PR checklist item: "Does this log PII?"

---

## 4. Reference Implementation

### 4.1 KMS Key Construct
```typescript
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

interface PiiKeyProps {
  projectName: string;
  envName: string;
}

class PiiEncryptionKey extends Construct {
  public readonly key: kms.Key;

  constructor(scope: Construct, id: string, props: PiiKeyProps) {
    super(scope, id);

    this.key = new kms.Key(this, "Key", {
      alias: `${props.projectName}-${props.envName}-pii-key`,
      description: "Encrypts PII data across the contact center",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            sid: "AllowRootAccountFullAccess",
            effect: iam.Effect.ALLOW,
            principals: [new iam.AccountRootPrincipal()],
            actions: ["kms:*"],
            resources: ["*"],
          }),
        ],
      }),
    });
  }

  grantEncryptDecrypt(grantee: iam.IGrantable): void {
    this.key.grantEncryptDecrypt(grantee);
  }
}
```

### 4.2 Secure Lambda with Secrets Access
```typescript
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

// In your stack:
const crmApiSecret = new secretsmanager.Secret(this, "CrmApiKey", {
  secretName: `${projectName}-${env}-crm-api-key`,
  description: "API key for external CRM integration",
});

const crmLookupFn = new ConnectLambda(this, "CrmLookup", {
  config: this.config,
  service: "connect",
  name: "crm-lookup",
  entry: "src/connect/crm-lookup/index.ts",
  environment: {
    CRM_SECRET_ARN: crmApiSecret.secretArn,
  },
});

// Grant ONLY this Lambda access to this secret
crmApiSecret.grantRead(crmLookupFn.function);
```

### 4.3 Sanitized Logger
```typescript
const PII_PATTERNS: RegExp[] = [
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,           // SSN
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // Credit card
  /\b\+?1?[-.]?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g, // Phone
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
];

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    let sanitized = value;
    for (const pattern of PII_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
    return sanitized;
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = sanitize(v);
    }
    return result;
  }
  return value;
}
```

---

## 5. Standards & Best Practices

### 5.1 IAM Standards
- Every Lambda function gets its OWN execution role (CDK does this by default)
- Never use `Action: "*"` or `Resource: "*"` in any policy
- Use CDK grant methods (`table.grantReadData(fn)`) instead of manual policy statements
- Review IAM policies in code review — they're as important as the code itself

### 5.2 Encryption Standards
- All S3 buckets: SSE-KMS with customer-managed key for PII, SSE-S3 for non-PII
- All DynamoDB tables with PII: Customer-managed KMS key
- All CloudWatch Log Groups: KMS encryption
- RDS: Encryption enabled at creation (you cannot enable it later)
- All external API calls: HTTPS only, reject HTTP

### 5.3 Logging Standards
- Never log raw customer input (phone numbers, SSNs, names)
- Log identifiers only (customerId, policyId, contactId)
- Use the sanitized logger for defense-in-depth
- Log retention: 7 days dev, 14 days staging, 90 days prod
- Encrypt log groups with KMS in production

### 5.4 Access Control Standards
- Production AWS account: No direct console access for developers
- Use SSO with time-limited sessions
- Break-glass procedure documented for emergency access
- All production changes via CI/CD pipeline only
- Connect admin access restricted to team leads

### 5.5 Data Retention Standards
| Data | Dev Retention | Prod Retention | Reasoning |
|------|-------------|----------------|-----------|
| Call recordings | 7 days | Per regulation (1-7 years) | Legal/compliance |
| Transcripts | 7 days | Same as recordings | Same lifecycle |
| Lambda logs | 7 days | 90 days | Debugging window |
| CloudTrail logs | 30 days | 7 years | Audit trail |
| DynamoDB data | Auto-cleanup | Per business requirement | Data governance |
| Bedrock logs | 7 days | 30 days | Prompt debugging |

---

## 6. Hands-On Exercises

### Exercise 1: Audit Your Current IAM Setup
Go to IAM in the AWS console. Find:
- What roles exist for your Connect instance?
- What policies are attached?
- Are any policies overly broad (`*` actions or resources)?

Document what you find and identify what needs tightening.

### Exercise 2: Create a KMS Key via CDK
Add a KMS key to your data stack that:
- Has automatic rotation enabled
- Has an alias following your naming convention
- Is used to encrypt your DynamoDB tables
- Has a removal policy of RETAIN

Deploy it. Verify in the KMS console that the key exists and rotation is enabled.

### Exercise 3: Enable S3 Bucket Encryption
Update your S3 buckets (recordings, documents) to use KMS encryption with your new key. Deploy. Upload a test file. Verify in S3 that the object shows KMS encryption.

### Exercise 4: Secure Your Lambda Logs
Encrypt your Lambda function's CloudWatch Log Group with KMS. Verify in CloudWatch that the log group shows KMS encryption.

### Exercise 5: Build a PII Sanitizer
Add the PII sanitization patterns to your shared logger. Test with strings containing fake SSNs, phone numbers, and emails. Verify they're replaced with `[REDACTED]` in the log output.

### Exercise 6: Enable CloudTrail
Create a CloudTrail trail via CDK that:
- Logs all management events
- Logs S3 data events for your recordings bucket
- Stores logs in a dedicated, encrypted S3 bucket
- Has log file validation enabled

---

## 7. Common Mistakes & Anti-Patterns

### Anti-Pattern 1: The "God Role"
**What happens:** One IAM role used by all Lambda functions. Has permissions to everything. One compromised function = full account compromise.

**The Fix:** One role per function. CDK does this by default — don't fight it by sharing roles.

### Anti-Pattern 2: Logging PII "For Debugging"
**What happens:** Developer adds `console.log(JSON.stringify(event))` in a Lambda handler "temporarily for debugging." It logs everything — customer phone number, slot values, policy numbers. "Temporary" logging stays for 6 months.

**The Fix:** Never log raw events. Log specific fields. Use the sanitized logger as a safety net. Code review catches `console.log(event)`.

### Anti-Pattern 3: Unencrypted S3 Buckets
**What happens:** S3 bucket created without encryption. Call recordings are stored in plaintext. Audit reveals non-compliance.

**The Fix:** CDK constructs enforce encryption by default. The `TaggedStack` base class or a custom S3 construct should require encryption — make it impossible to create an unencrypted bucket.

### Anti-Pattern 4: Secrets in Environment Variables
**What happens:** API key stored as a Lambda environment variable. Visible in the console. Visible in CloudFormation template. Anyone with Lambda read access can see it.

**The Fix:** Secrets Manager. Lambda reads the secret at runtime. The environment variable stores the secret ARN (the reference), not the secret value.

### Anti-Pattern 5: No Data Retention Policy
**What happens:** Call recordings accumulate for 2 years. Nobody set up lifecycle rules. Storage costs grow. Compliance asks "why do you have 2-year-old recordings?" and there's no good answer.

**The Fix:** S3 lifecycle rules from day one. Transition to IA after 90 days, Glacier after 1 year, delete after retention period. Document the policy. Get legal/compliance sign-off.

### Anti-Pattern 6: Using Bedrock Without Guardrails
**What happens:** AI generates a response that includes a customer's SSN because it was in the prompt context. Or AI gives financial advice it shouldn't. Or AI reveals information about another customer.

**The Fix:** Bedrock Guardrails with PII filtering, topic denial, and content filtering. Always review what goes INTO the prompt and what comes OUT of the model.

---

## 8. Interview/Client Review Questions

1. **"How do you handle PII in an AI-powered contact center?"**
   → Multiple layers: Contact Lens redaction for transcripts, KMS encryption at rest, IAM for access control, sanitized logging, Bedrock Guardrails for AI responses. Defense-in-depth — no single layer is enough.

2. **"Walk me through your IAM strategy for a Connect + Lex + Lambda + Bedrock project."**
   → Security boundaries (Connect, Real-Time, Post-Call, Admin). Each Lambda gets its own role. CDK grant methods for least privilege. No wildcard permissions.

3. **"A customer asks if their data is used to train AI models. What do you tell them?"**
   → AWS Bedrock does not use customer data to train models. This is in the AWS service terms. Data stays within the account. We can provide documentation from AWS confirming this.

4. **"How do you encrypt data at rest across all services?"**
   → Customer-managed KMS key for PII data (S3, DynamoDB, CloudWatch Logs, RDS). Key rotation enabled. Key policy restricts access. Non-PII uses AWS-managed encryption.

5. **"Your Lambda function needs an API key for an external CRM. How do you manage it?"**
   → Secrets Manager. Lambda reads at runtime using the SDK. Secret ARN passed via environment variable. IAM policy grants only that Lambda access to that secret. Rotation enabled.

6. **"An auditor asks for all access logs to customer recordings in the last 90 days. Can you provide this?"**
   → Yes, if configured from day one: S3 server access logs + CloudTrail data events. Both stored in an encrypted audit bucket with 7-year retention.

7. **"What's the difference between encryption with AWS-managed keys vs customer-managed keys?"**
   → AWS-managed: convenient, no management overhead, but you can't control the key policy or rotation schedule. Customer-managed: full control, required for many compliance frameworks, enables cross-account access patterns.

8. **"A developer accidentally logs PII. What's your incident response?"**
   → Fix code immediately. Assess exposure window (how long was it logging?). Check if log group is encrypted (limits exposure). If GDPR-covered data: assess if breach notification is required. Set log retention to minimize exposure. Add PII sanitizer to prevent recurrence.

9. **"How do you ensure only authorized personnel can listen to call recordings?"**
   → S3 bucket policy + IAM roles. Only specific roles can GetObject on the recordings bucket. CloudTrail audits every access. Connect's built-in permissions control console playback.

10. **"What compliance frameworks does Amazon Connect support?"**
    → HIPAA (with BAA), PCI DSS, SOC 1/2/3, ISO 27001, FedRAMP, GDPR. But AWS compliance only covers the infrastructure — your application logic, data handling, and access controls are YOUR responsibility.

---

## What's Next

Once you've:
- ✅ Audited your current IAM setup
- ✅ Created and deployed a KMS key
- ✅ Encrypted your S3 buckets and DynamoDB tables
- ✅ Added PII sanitization to your logger
- ✅ Set up CloudTrail
- ✅ Can answer the review questions

**Phase 0 is complete.** Tell me you're ready and we move to **Phase 1: Mastering Amazon Lex v2**.
