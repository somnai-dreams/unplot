/** Public entry point for the TypeScript port. */
export { extract, extractFromPage, type AxisSpec, type ExtractOpts } from "./extract.ts";
export { labeled, toData } from "./curveset.ts";
export type {
  AxisCalibration, Curve, CurveQA, CurveSet, CurveSetQA, CurveStyle, Dash, Ingest, Method, OrderBy, Source,
} from "./curveset.ts";
export { free, lobe, monotone, smooth, type ShapePrior, type Violation } from "./priors.ts";
export { loadVectorPage, type RawPath, type VectorPage, type Word } from "./io/vector.ts";
export { CalibrationError } from "./axes/calibrate.ts";
export { DEFAN_DEFAULT, DEFAN_POLYLINE, type Candidate } from "./separate.ts";
export type { Pt } from "./curves/vectorpaths.ts";
