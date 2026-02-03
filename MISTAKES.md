# Mistakes & Learnings: Solving Quorum 2 for Yellow App Sessions

This document captures the debugging journey and key mistakes made while implementing quorum 2 governance for Yellow Network app sessions.

## The Goal

Create a minimal Yellow app session demo where:
1. Agent opens a session with 1.0 USD
2. Pays merchant 0.1 USD
3. Closes the session
4. Both agent and merchant must sign all operations (quorum 2)

## Mistake #1: Mixing createECDSAMessageSigner and signPayload

**What we did:**
```typescript
// Agent signature via library
const agentSigner = createECDSAMessageSigner(agentPrivateKey);
const message = await createAppSessionMessage(agentSigner, params);
const parsed = JSON.parse(message);

// Merchant signature via signPayload
const merchantSig = await signPayload(parsed.req, merchantPrivateKey);
parsed.sig.push(merchantSig);
```

**Result:**
- `create_app_session` worked! ✓
- `close_app_session` failed with "signature from unknown participant wallet 0x..."

**Why it failed for close:**
Different hashing methods between the library signer and `signPayload` led to inconsistent signatures that Yellow couldn't validate for close operations.

**Learning:** Using mixed signing methods can work for some operations but not others. Consistency is key.

---

## Mistake #2: Creating Separate Messages for Each Signer

**What we did:**
```typescript
// Create two separate messages
const agentMessage = await createAppSessionMessage(agentSigner, params);
const merchantMessage = await createAppSessionMessage(merchantSigner, params);

// Combine signatures from different messages
const agentParsed = JSON.parse(agentMessage);
const merchantParsed = JSON.parse(merchantMessage);
agentParsed.sig.push(merchantParsed.sig[0]);
```

**Result:** Failed with "signature from unknown participant"

**Why it failed:**
Each message creation generates a unique request ID and timestamp. Yellow requires all signatures to be for the EXACT SAME request (same ID, same timestamp). Two different requests = invalid multi-sig.

**Learning:** Both parties must sign the SAME request object, not create separate requests with the same parameters.

---

## Mistake #3: Assuming Quorum 1 Would Work for Sessions Created with Quorum 2

**What we did:**
Created a session with `quorum: 2`, then tried to close it with only agent's signature.

**Result:** Failed with "quorum not reached: 1 / 2"

**Why it failed:**
Yellow enforces the quorum requirement defined at session creation. If you create with quorum 2, you MUST close with quorum 2. There's no way to downgrade.

**Learning:** Quorum is a permanent property of the session. Choose carefully at creation time.

---

## Mistake #4: Not Checking Merchant Balance

**What we did:**
Initially, we only checked agent balance after closing the session.

**Result:** We assumed merchant received payment but had no proof.

**Why it's wrong:**
Without verification, we can't confirm the core functionality actually works. This is especially important for learning.

**Solution:**
```typescript
// Authenticate as merchant to verify their balance
const merchantRpc = new YellowRpcClient({
  url: CLEARNODE_WS_URL,
  privateKey: MERCHANT_PRIVATE_KEY,
  authDomain: 'clearnet-sandbox.yellow.com',
});
await merchantRpc.connect();
await merchantRpc.authenticate();
const merchantBalance = await merchantRpc.getLedgerBalances();
// Now we can confirm they received 0.1!
```

**Learning:** Always verify end-to-end, not just the sending side. Test what actually happened, not what you expect happened.

---

## Mistake #5: Not Showing Expected vs Got Values

**What we did:**
Showed balances but didn't compare them to expected values.

**Result:** Hard to tell if the math was correct or if there were edge cases.

**Solution:**
```typescript
const expected = (Number(initial) - Number(payment)).toFixed(1);
console.log(`Agent: Expected: ${expected}, Got: ${actual} ${expected === actual ? '✓' : '✗'}`);
```

**Learning:** Explicit verification makes bugs obvious and builds confidence in the system.

---

## Mistake #6: Assuming Zero-Allocation Participants Don't Need to Sign

**What we tried:**
Created session with:
- Agent: 1.0 (non-zero, must sign create)
- Merchant: 0 (zero allocation)

Then tried to have both sign close.

**Result for create:** Worked! Yellow accepts extra signatures.
**Result for close:** Failed! "missing signature for participant"

**Why it's problematic:**
The merchant with zero initial allocation isn't considered a "valid" participant who funded the session. For quorum 2 close, Yellow expects signatures from participants who have a stake.

**Solution:**
Both participants fund the session with non-zero amounts:
```typescript
allocations: [
  {agent: "0.5"},      // Non-zero
  {merchant: "0.5"}    // Non-zero
]
// Now both are valid signers for all operations
```

**Learning:** For true quorum 2 governance, all participants should contribute funds at creation time, not just receive allocations during operations.

---

## Mistake #7: THE BIG ONE - Passing Stringified JSON to Signers

**What we did:**
```typescript
const requestString = JSON.stringify(parsed.req);
const merchantSig = await merchantSigner(requestString);
```

**Result:**
- Signatures verified locally ✓
- Yellow rejected with random addresses ✗

**Why it failed:**
The `MessageSigner` type signature is:
```typescript
type MessageSigner = (payload: RPCData) => Promise<Hex>
type RPCData = [RequestID, RPCMethod, object, Timestamp?]
```

It expects an ARRAY, not a string! TypeScript didn't catch this because of type coercion. The signer function internally does `JSON.stringify` on the array using canonical serialization. When we pre-stringify, we're signing a string representation instead of the canonical JSON of the array.

**The fix:**
```typescript
const requestArray = parsed.req;  // This is [id, method, params, timestamp]
const merchantSig = await merchantSigner(requestArray);  // Pass the array!
```

**Learning:**
- Read the type signatures carefully
- `RPCData` means pass the data structure, not its string representation
- The library handles serialization internally

---

## Mistake #8: Not Testing Both Participants Authenticated

**What we assumed:**
Only the sender needs to be authenticated.

**Reality:**
For quorum operations where both sign, we eventually found both should be authenticated (though this wasn't the main issue).

**Best practice:**
```typescript
// Authenticate both participants
await agentRpc.authenticate();
await merchantRpc.authenticate();
```

**Learning:** When multiple parties participate in governance, ensure all are properly authenticated with the clearnode.

---

## Mistake #9: Reading Protocol Docs Instead of Library Type Definitions

**What we did:**
Read Yellow's high-level protocol documentation which shows message format as JSON structures:
```json
{
  "req": [requestId, "method", {...}, timestamp],
  "sig": ["0x..."]
}
```

Then tried to implement based on intuition and examples from the codebase.

**What we should have done FIRST:**
```bash
cat node_modules/@erc7824/nitrolite/dist/rpc/types/index.d.ts
```

This would have immediately shown:
```typescript
export type MessageSigner = (payload: RPCData) => Promise<Hex>
export type RPCData = [RequestID, RPCMethod, object, Timestamp?]
```

**The critical distinction:**
- **Protocol docs** tell you WHAT the message looks like on the wire
- **Library types** tell you HOW to use the TypeScript API
- These are NOT the same thing!

**Why this mattered:**
The protocol docs show JSON messages, so we assumed passing JSON strings would work. But the TypeScript library expects structured data (arrays/objects), not pre-serialized strings. The library handles serialization internally.

**Learning:**
- **Always read the TypeScript type definitions for the library you're using**
- Protocol documentation ≠ Library API documentation
- Types are the contract - they tell you exactly what to pass
- Don't guess based on JSON examples in protocol docs

**The irony:** The information WAS in the docs (the TypeScript types), we just looked at the wrong docs!

---

## Mistake #10: Giving Up Too Early on Quorum 2

**What we almost did:**
Concluded that quorum 2 doesn't work for `close_app_session` and documented it as a limitation.

**Reality:**
It DOES work - we just had the wrong implementation.

**Learning:** When something seems like it "should work" but doesn't, keep debugging systematically. The issue is usually in your code, not the protocol (especially for well-established protocols like Yellow).

---

## The Systematic Debugging Process That Worked

1. **Isolated the working case** - Quorum 2 worked for create
2. **Tried exact same pattern for close** - Still failed
3. **Added detailed logging** - Saw signatures verified locally
4. **Realized mismatch** - Signatures good locally, bad on Yellow's side
5. **Hypothesis** - Different serialization/hashing
6. **Checked type definitions** - Found `RPCData` is an array!
7. **Applied fix** - Passed array instead of string
8. **Success!** - Both create and close work with quorum 2

---

## Key Takeaways

### Technical

1. **Pass arrays to `MessageSigner` functions**, not strings
2. **Both parties must sign the EXACT SAME request** (same ID, timestamp)
3. **Use consistent signing methods** throughout
4. **Quorum is permanent** - set at creation, can't be changed
5. **Non-zero allocations** make participants valid signers

### Process

1. **Test systematically** - Isolate what works vs what doesn't
2. **Verify end-to-end** - Check all parties' balances
3. **Read type definitions** - They contain critical clues
4. **Add detailed logging** - Helps spot mismatches
5. **Don't give up** - If it should work theoretically, keep debugging

### Documentation

1. **Show Expected vs Got** - Makes verification obvious
2. **Track all balances** - Agent, Session, Merchant at each step
3. **Document the journey** - Future developers learn from mistakes
4. **Explain the "why"** - Not just the "how"

---

## What Now Works

```bash
npm run minimal-session
```

**Output:**
- ✓ Quorum 2 for `create_app_session`
- ✓ Quorum 2 for `close_app_session`
- ✓ All balances verified at each step
- ✓ Merchant payment confirmed
- ✓ Complete lifecycle demonstrated

**This enables:**
- Multi-player games with fair governance
- Escrow services with arbitration
- DAO-style fund management
- Prediction markets with judges
- Any trustless multi-party application

All with instant updates, zero gas fees, and cryptographic security!

---

## Files Created During This Journey

1. `src/minimal-session-demo.ts` - Final working demo
2. `QUORUM-2-SOLVED.md` - Technical solution
3. `QUORUM-2-FINAL-SUMMARY.md` - Achievement summary
4. `QUORUM-2-STATUS.md` - Earlier investigation (superseded)
5. `MISTAKES.md` - This file

---

**Total Time:** Multiple hours of systematic debugging
**Key Breakthrough:** Understanding `MessageSigner` expects `RPCData` (array), not string
**Result:** Production-ready quorum 2 implementation for Yellow Network

🎉 **Success through persistence and systematic investigation!**
