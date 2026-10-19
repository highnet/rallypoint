/**
 * Every pull request opened on UTON OS, one square each: 1,328 opened,
 * 1,256 merged. 83 columns × 16 rows is exactly 1,328.
 */
const OPENED = 1328;
const MERGED = 1256;
const CELL = 10;
const SIZE = 7;

function squares(cols: number, from: number, to: number) {
  let d = "";
  for (let i = from; i < to; i += 1) {
    const x = (i % cols) * CELL;
    const y = Math.floor(i / cols) * CELL;
    d += `M${x} ${y}h${SIZE}v${SIZE}h-${SIZE}z`;
  }
  return d;
}

function outlines(cols: number, from: number, to: number) {
  let d = "";
  for (let i = from; i < to; i += 1) {
    const x = (i % cols) * CELL + 0.75;
    const y = Math.floor(i / cols) * CELL + 0.75;
    const s = SIZE - 1.5;
    d += `M${x} ${y}h${s}v${s}h-${s}z`;
  }
  return d;
}

function Grid({ cols, className, titleId }: { cols: number; className: string; titleId: string }) {
  const rows = Math.ceil(OPENED / cols);
  return (
    <svg
      aria-labelledby={titleId}
      className={`tally-svg ${className}`}
      role="img"
      viewBox={`0 0 ${cols * CELL - (CELL - SIZE)} ${rows * CELL - (CELL - SIZE)}`}
    >
      <title id={titleId}>
        1,328 pull requests opened on UTON OS, one square each; 1,256 filled squares were merged.
      </title>
      <path className="tally-merged" d={squares(cols, 0, MERGED)} />
      <path className="tally-open" d={outlines(cols, MERGED, OPENED)} />
    </svg>
  );
}

export function PrTally() {
  return (
    <figure className="tally">
      {/* 83 × 16 is exactly 1,328; phones get a taller 32-column block. */}
      <Grid className="tally-wide" cols={83} titleId="tally-title" />
      <Grid className="tally-narrow" cols={32} titleId="tally-title-narrow" />
      <figcaption className="tally-legend">
        <span>
          <span aria-hidden="true" className="tally-key tally-key-merged" />
          1,256 merged
        </span>
        <span>
          <span aria-hidden="true" className="tally-key tally-key-open" />
          opened, not merged
        </span>
        <span>One square per pull request · 1,328 opened in eight weeks</span>
      </figcaption>
    </figure>
  );
}
