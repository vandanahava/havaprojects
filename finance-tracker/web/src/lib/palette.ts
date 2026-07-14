/** Validated categorical palette (fixed slot order — never cycled).
 *  Series beyond 8 fold into "Other" using the muted gray. */
export const CATEGORICAL = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
] as const;

export const OTHER_GRAY = "#898781";

/** Sequential blue ramp (magnitude). */
export const SEQ_BLUE = {
  100: "#cde2fb", 250: "#86b6ef", 400: "#3987e5", 450: "#2a78d6",
  500: "#256abf", 550: "#1c5cab", 700: "#0d366b",
} as const;

export const POS = "#0ca30c";
export const POS_TEXT = "#006300";
export const NEG = "#ec835a";
export const NEG_TEXT = "#b23c2e";
export const WARN = "#fab219";
export const GRID = "#e1e0d9";
export const MUTED = "#898781";

export function seriesColor(i: number): string {
  return i < CATEGORICAL.length ? CATEGORICAL[i] : OTHER_GRAY;
}
