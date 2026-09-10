# Walkthrough screenshots

> Kept in `docs/` rather than beside the images, because everything under `public/` is SERVED.
> A file at `/walkthrough/README.md` telling a reader which fields were blurred is a small
> favour to anyone curious about what was hidden, and there is no reason to offer it.

These are the images on `/pricing`. They are the first thing a prospect sees of the product, and
until a file lands here its slot on the page renders a named placeholder saying which file it
wants — so a half-supplied page says so rather than looking finished.

## Files expected

| File | Orientation | Shows |
|---|---|---|
| `estimate-sheet.webp` | portrait A4 | A priced estimate, item by item |
| `tax-invoice.webp` | portrait A4 | A GST tax invoice on the agency letterhead |
| `guarantee-certificate.webp` | portrait A4 | The guarantee certificate |
| `inspection-report.webp` | portrait A4 | External + internal inspection |
| `multi-job-estimate.webp` | portrait A4 | Several transformers on one sheet |
| `job-register.webp` | **landscape** | The MR register / job list screen |

Adding or renaming one means editing `SHOTS` in `src/components/legal/Walkthrough.tsx` — the list
there is what the page renders, and a file dropped here that nothing names will not appear.

## Format and size

- **WebP**, quality ~82. PNG is acceptable if WebP is inconvenient, but a text-heavy A4 page is
  typically 3–4x larger as PNG.
- **1200 px on the long edge.** The page displays these about 400 px wide in a two-column grid,
  so 1200 px covers a 2x display with room to spare. Larger is wasted bytes.
- **Portrait A4 is 1200 × 1697.** Landscape is 1697 × 1200. The placeholders use those ratios, so
  a differently-shaped image will make the grid jump.
- **Under 250 KB each.** Six of them is then well under 1.5 MB for the page, which matters because
  this loads before anyone has decided to care.

## Blurring

Blur, do not crop — a cropped document stops looking like the document. What should go:

- the DISCOM's and the agency's GSTIN and PAN
- bank account and IFSC
- transformer serial numbers
- the rupee figures, if you would rather not show your rates

**Leave the structure legible.** The point is that a contractor recognises the form of their own
division's paperwork; a page of grey boxes proves nothing. Column headings, item descriptions,
the letterhead layout and the signature block are what does the work.

Use an opaque blur or a solid block, not a low-opacity overlay — text under a light blur is often
still readable when the image is zoomed.
