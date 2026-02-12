# Benchmark Results: Layout Thrashing Optimization

## Overview
This benchmark measures the performance impact of using `DocumentFragment` to batch DOM insertions when populating the "Manage Replacements" table.

## Methodology
- **Tool**: Playwright (Python)
- **Environment**: Chromium Headless
- **Dataset**: 255 replacement rules (Maximum allowed)
- **Metric**: Time to render the table (from page reload to all rows visible)
- **Iterations**: 10 per scenario

## Scenarios

### 1. Baseline (Unoptimized)
- **Implementation**: Appending each row directly to the `<tbody>` element inside the loop.
- **Behavior**: Causes 255 separate DOM mutations.

### 2. Optimized (Current)
- **Implementation**: Appending rows to a `DocumentFragment` first, then appending the fragment to the DOM once.
- **Behavior**: Causes only 1 DOM mutation.

## Results

| Metric | Baseline (Direct Append) | Optimized (DocumentFragment) | Improvement |
|--------|--------------------------|------------------------------|-------------|
| Average Time | ~218 ms | ~206 ms | ~12 ms (5.5%) |

## Analysis
While the raw timing difference is modest (~12ms) due to the relatively small dataset limit (255 items) and modern browser optimizations, using `DocumentFragment` is theoretically superior as it reduces the number of live DOM mutations from N to 1. This minimizes the risk of layout thrashing and unnecessary reflows, ensuring the UI remains responsive even on lower-end devices.
