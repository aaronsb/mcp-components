# Writing a component page

A component page is the claim behind a package, written so someone who has never seen the servers it came from can judge it.

```markdown
# <name>

**Claim.** One paragraph. What the agent does differently when this is present.

**Without it.** What was observed going wrong. Concrete, from a real session where possible.

**Evidence.** Where it runs, since when, and how confident that makes you.
Tiers: `observed` (seen in one server), `repeated` (independently arrived at in two or more), `tested` (the claim has a failing test without the component).

**Adopt.** The two or three calls a server makes to use the package.

**Not for.** The cases where the component hurts or does not apply.
```

Keep the page under a screen. The ADRs in the source servers hold the long form and the page links to them.
