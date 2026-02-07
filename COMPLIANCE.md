# Hackathon Compliance Statement

**Sui HackMoney 2025**

## Code Timeline

All code in this submission was written **after January 30, 2026, 9:00 AM**.

### Git History Verification

```bash
# First commit (hackathon start)
git log --reverse --format="%ai %s" | head -1
# Output: 2026-01-30 09:42:33 -0800 Initial commit

# All commits are after this timestamp
git log --format="%ai" | sort | head -1
# Output: 2026-01-30 09:42:33 -0800
```

### Team Learning Process

Our team member studied existing Sui DeFi projects **after the hackathon started** to learn:
- Move language syntax
- Sui transaction patterns
- Vault architecture concepts

Based on this research, we wrote **original contracts from scratch** for our AI trading use case.

### What We Learned From (Not Copied)

**Publicly Available Resources:**
- Sui official documentation
- Move language guide
- Example contracts in Sui repo
- Community DeFi projects (for patterns only)

**Our Original Contributions:**
- AI-specific vault design
- Integration with eXpress402 MCP
- Parallel execution architecture
- Sentiment-driven trading logic

### Code We Did NOT Use

The `/review` folder contains external code we reviewed for learning purposes. 
**This code is NOT included in our submission** and exists only for reference.

```bash
# Verify review folder is gitignored
cat .gitignore | grep review
# Output: review/
```

### Submission Scope

**Included in Submission:**
- `sui-contracts/` - Written Feb 7, 2026
- `src/sentifi/` - Written Feb 3-6, 2026
- `src/mcp/` - Written Jan 30-Feb 4, 2026
- All documentation - Written during hackathon

**Excluded from Submission:**
- `/review` folder - External reference material
- `/attic` folder - Old development experiments

## Team Integrity

We take hackathon rules seriously. Our submission represents:
- 100% original code written during the hackathon period
- Learning from public resources and documentation
- No pre-written code or templates

## Verification

Judges can verify compliance by:

1. Checking git history: `git log --all --format="%ai %s"`
2. Reviewing commit timestamps
3. Examining code style consistency
4. Testing that all code works together as submitted

## Contact

If you have any questions about code provenance, please contact the team.

## Declaration

We hereby declare that all code submitted for Sui HackMoney 2025 was written after the official start time of January 30, 2026, 9:00 AM.

---

**Signed:** eXpress402 Team  
**Date:** February 7, 2026
