/** The StowNest box mark.
 *
 *  Inline SVG rather than an image asset: it scales to any size without a
 *  retina variant, and it takes its colour from `currentColor`, so the one
 *  component serves the rail, the sign-in card, and anywhere else a mark is
 *  needed without a second file per size or theme.
 *
 *  The mark keeps its own green regardless of the interface accent — a brand
 *  mark that changes colour when the UI accent does isn't a brand mark. The
 *  colour is set by `.rail__mark` in app.css, not here.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round"
      role="img" aria-label="StowNest">
      {/* Cube silhouette */}
      <path d="M12 2.4 20.6 7.2 20.6 16.8 12 21.6 3.4 16.8 3.4 7.2 Z" />
      {/* Top-face edges meeting at the front corner */}
      <path d="M3.4 7.2 12 12 20.6 7.2" />
      {/* Front vertical seam */}
      <path d="M12 12 12 21.6" />
      {/* Tape running over the lid, with its short turned-down end */}
      <path d="M7.7 4.8 16.3 9.6 16.3 13.1" />
    </svg>
  );
}
