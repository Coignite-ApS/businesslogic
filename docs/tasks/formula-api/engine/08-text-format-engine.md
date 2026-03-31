# 08. TEXT Format Engine Expansion

**Status:** idea
**Category:** Coverage

---

## Goal

The TEXT() format engine currently handles a subset of Excel patterns (0.00, #,##0, %, yyyy-mm-dd). Missing: conditional formats `[>100]0.00`, color codes `[Red]`, scientific notation `0.00E+00`, fraction formats `# ?/?`, custom date patterns, locale-aware formatting. Full Excel format string compatibility would make TEXT() much more useful.

---

## Key Tasks

- [ ] Scientific notation: `0.00E+00`
- [ ] Fraction formats: `# ?/?`, `# ??/??`
- [ ] Conditional sections: `[>100]0.00;[<0]-0.00;0`
- [ ] Full date/time patterns: `dddd`, `mmmm`, `AM/PM`
- [ ] Locale-aware decimal/thousands separators
- [ ] Color codes (ignored in value, but shouldn't error)
