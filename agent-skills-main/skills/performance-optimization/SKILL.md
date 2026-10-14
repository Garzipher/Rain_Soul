
After any performance-related change:

- [ ] Before and after measurements exist (specific numbers)
- [ ] The result was re-measured the same way as the baseline (same command, same conditions)
- [ ] The improvement exceeds run-to-run variance, not just the mean
- [ ] Changes that didn't beat the baseline were reverted, not kept as neutral
- [ ] Attempts are logged, kept and reverted alike, so a dead idea isn't re-run
- [ ] The specific bottleneck is identified and addressed
- [ ] Core Web Vitals are within "Good" thresholds
- [ ] Bundle size hasn't increased significantly
- [ ] No N+1 queries in new data fetching code
- [ ] Any new index is justified by a query plan before and after, and its write cost was considered
- [ ] Any new cache states what it keys on and how it goes stale
- [ ] The measured user-facing metric has a synthetic budget or field monitor that can detect regression
- [ ] Existing tests still pass (optimization didn't break behavior)
