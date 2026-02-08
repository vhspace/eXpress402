# Sui HackMoney 2025 - Submission Checklist

**Deadline: 22 hours from now**

## 🚀 Minimum Viable Submission (Next 6 Hours)

### Hour 1-2: Contract Testing & Deployment

```bash
# Build contracts
cd sui-contracts
sui move build

# Run tests (add basic tests)
sui move test

# Deploy to Sui testnet
sui client publish --gas-budget 100000000
```

**Deliverable:** Deployed contract address + testnet verification

### Hour 3-4: Integration Layer

Create minimal Sui executor that demonstrates concept:

```typescript
// src/sui-integration/executor.ts
- Connect to Sui RPC
- Query vault balance
- Show how Sentifi would call contracts
- Mock parallel execution demo
```

**Deliverable:** Working TypeScript integration stub

### Hour 5-6: Documentation Polish

- [ ] Update README.md with Sui section
- [ ] Record 3-minute demo video showing:
  - eXpress402 working (existing)
  - Sui contracts deployed (new)
  - Architecture explanation
- [ ] Create clear "Why Sui" narrative

## 🎯 Submission Requirements

### Must Have (Required for Notable Project)

- [x] Built on Sui - `sui-contracts/` deployed to testnet
- [x] Working prototype - eXpress402 + Sui contracts
- [x] Strength in product insight - Novel AI + parallel execution use case
- [ ] Potential for expansion - Clear roadmap in docs

### Nice to Have (Boosts for Best Overall)

- [ ] Live demo working end-to-end
- [ ] Performance comparison data (EVM vs Sui)
- [ ] Test coverage showing contract safety
- [ ] User journey video walkthrough

## 📝 Submission Content

### Primary Files

1. **README.md** - Updated with Sui integration
2. **sui-contracts/** - Original Move contracts
3. **Demo video** - 2-3 minutes showing everything

### Supporting Files

- `docs/HACKATHON-FLOWS.md` - Architecture diagrams (existing)
- `src/sentifi/` - AI agent code (existing)
- `src/mcp/` - Payment system (existing)

## 🎬 Demo Video Script (3 minutes)

**Minute 1: The Problem**
- Show sequential EVM execution taking 2+ minutes
- Explain how this kills trading alpha
- Introduce Sui's parallel execution

**Minute 2: The Solution**
- Show eXpress402 architecture
- Demo Sentifi agent analyzing sentiment
- Explain how Sui contracts enable parallel trades

**Minute 3: The Future**
- Deployed Sui contracts (testnet proof)
- Clear roadmap for mainnet
- Why this is perfect for Sui Moonshot Program

## ⏰ Timeline (22 Hours)

### Hours 0-2 (NOW): Contract Testing
- Add basic unit tests to contracts
- Build and deploy to Sui testnet
- Document deployment addresses

### Hours 2-4: Integration Code
- Write TypeScript Sui executor
- Create demo showing concept
- Test locally

### Hours 4-6: Documentation
- Polish all markdown files
- Create architecture diagrams
- Write clear "Why Sui" narrative

### Hours 6-8: Demo Video
- Record screen capture
- Edit to 3 minutes
- Upload to YouTube/Loom

### Hours 8-10: Testing & Polish
- Run through entire demo
- Fix any bugs
- Update documentation

### Hours 10-18: SLEEP & REVIEW
- Take a break
- Fresh review in morning
- Final polish

### Hours 18-22: Final Submission
- Review submission requirements
- Upload all files
- Submit before deadline
- Verify submission received

## 🎯 Success Criteria

**Minimum (Notable Project - $1k):**
- Sui contracts deployed and working
- Clear documentation
- Video demo showing concept
- Code written after Jan 30

**Stretch (Best Overall - $3k):**
- Everything above +
- Live integration working
- Performance data showing Sui advantage
- Professional video and docs

## 📧 Pre-Submission Verification

Before hitting submit:

- [ ] All git commits after Jan 30 9am
- [ ] `review/` folder not in repo
- [ ] Sui contracts build successfully
- [ ] All links in README work
- [ ] Video plays correctly
- [ ] Team member credited appropriately

## 🚀 Post-Submission

After submitting:
- Tweet about the project
- Share in Sui Discord
- Connect with Sui Foundation team
- Apply for Moonshot Program

---

**You've got this!** Focus on the story: AI trading needs speed, Sui delivers speed.
